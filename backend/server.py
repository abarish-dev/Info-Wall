from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import requests
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime

from airlines import resolve_airline


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]


ADSB_BASE = "https://api.adsb.lol/v2"
MILES_PER_NM = 1.15078

# Tiny in-memory cache so a brief upstream rate-limit (429) or hiccup degrades
# to the last good result instead of surfacing an error in the app.
_flight_cache: dict = {}
_FLIGHT_CACHE_TTL = 120  # seconds a cached result is considered fresh


@api_router.get("/flights/nearby")
async def flights_nearby(lat: float, lon: float, radius: float = 25):
    """Live aircraft within `radius` miles of (lat, lon) via the public
    adsb.lol feed. Resolves each callsign to an airline name + logo URL.
    Proxied server-side to avoid mobile/web CORS restrictions."""
    import time as _time

    nm = max(1, min(250, round(radius / MILES_PER_NM)))
    url = f"{ADSB_BASE}/lat/{lat}/lon/{lon}/dist/{nm}"
    cache_key = f"{round(lat, 2)}:{round(lon, 2)}:{nm}"
    try:
        resp = requests.get(
            url, timeout=8, headers={"User-Agent": "InfoWall/1.0"}
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("adsb.lol fetch failed: %s", exc)
        cached = _flight_cache.get(cache_key)
        if cached and _time.time() - cached["ts"] < _FLIGHT_CACHE_TTL:
            # Serve the last good result rather than erroring in the app.
            return {**cached["payload"], "stale": True}
        # No usable cache — degrade to an empty list (200) so the app shows a
        # calm "no aircraft" state instead of a hard error.
        return {
            "count": 0,
            "flights": [],
            "center": {"lat": lat, "lon": lon},
            "radiusMiles": radius,
            "degraded": True,
        }

    aircraft = data.get("ac") or []
    flights = []
    for a in aircraft:
        callsign = (a.get("flight") or "").strip()
        if not callsign:
            continue
        alt = a.get("alt_baro")
        if not isinstance(alt, (int, float)):
            alt = None  # e.g. "ground"
        info = resolve_airline(callsign)
        iata = info["iata"] if info else None
        flights.append(
            {
                "hex": a.get("hex"),
                "callsign": callsign,
                "registration": a.get("r"),
                "type": a.get("t"),
                "altitude": alt,
                "speed": a.get("gs"),
                "lat": a.get("lat"),
                "lon": a.get("lon"),
                "distance": a.get("dst"),
                "direction": a.get("dir"),
                "airline": info["name"] if info else None,
                "iata": iata,
                "logo": (
                    f"https://www.gstatic.com/flights/airline_logos/70px/{iata}.png"
                    if iata
                    else None
                ),
            }
        )

    flights.sort(
        key=lambda f: f["distance"] if f["distance"] is not None else 9999
    )
    payload = {
        "count": len(flights),
        "flights": flights[:15],
        "center": {"lat": lat, "lon": lon},
        "radiusMiles": radius,
    }
    _flight_cache[cache_key] = {"ts": _time.time(), "payload": payload}
    return payload

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
