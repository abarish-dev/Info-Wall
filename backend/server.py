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


# ---------------------------------------------------------------------------
# Ticker verification (Yahoo Finance search, keyless) — used to BLOCK invalid
# stock/ETF symbols before they reach the matrix.
# ---------------------------------------------------------------------------
_ticker_cache: dict = {}
_TICKER_TTL = 86400  # symbols rarely change; cache a day


def _verify_ticker(sym: str) -> dict:
    import time as _time

    cached = _ticker_cache.get(sym)
    if cached and _time.time() - cached["ts"] < _TICKER_TTL:
        return cached["data"]

    data = {
        "symbol": sym,
        "valid": None,  # None = couldn't verify (network); True/False = definitive
        "name": None,
        "exchange": None,
        "type": None,
    }
    try:
        r = requests.get(
            "https://query1.finance.yahoo.com/v1/finance/search",
            params={"q": sym, "quotesCount": 6, "newsCount": 0},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        r.raise_for_status()
        quotes = r.json().get("quotes", [])
        match = next(
            (q for q in quotes if (q.get("symbol") or "").upper() == sym), None
        )
        if match:
            data.update(
                valid=True,
                name=match.get("shortname") or match.get("longname"),
                exchange=match.get("exchDisp"),
                type=match.get("typeDisp") or match.get("quoteType"),
            )
        else:
            data["valid"] = False
        # Only cache definitive results (don't cache transient errors).
        _ticker_cache[sym] = {"ts": _time.time(), "data": data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("ticker verify failed %s: %s", sym, exc)
    return data


@api_router.get("/tickers/verify")
async def tickers_verify(symbols: str):
    """Verify a comma-separated list of symbols. Returns per-symbol validity
    plus the company/fund name for valid ones."""
    seen = set()
    results = []
    for raw in symbols.split(","):
        sym = raw.strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        results.append(_verify_ticker(sym))
    return {"results": results}


# ---------------------------------------------------------------------------
# TV show search + release status (TVmaze, keyless) — powers the show picker
# and the "new episode" highlights.
# ---------------------------------------------------------------------------
_tv_cache: dict = {}
_TV_TTL = 3600  # 1 hour


def _fmt_date(iso: str) -> str:
    from datetime import datetime as _dt

    try:
        return _dt.strptime(iso[:10], "%Y-%m-%d").strftime("%b %-d")
    except Exception:  # noqa: BLE001
        return iso[:10]


def _days_from_today(iso: str):
    from datetime import date as _date, datetime as _dt

    try:
        d = _dt.strptime(iso[:10], "%Y-%m-%d").date()
        return (d - _date.today()).days
    except Exception:  # noqa: BLE001
        return None


def _simplify_show(show: dict) -> dict:
    img = (show.get("image") or {}).get("medium")
    ext = show.get("externals") or {}
    imdb = ext.get("imdb")
    premiered = show.get("premiered") or ""
    network = (show.get("network") or show.get("webChannel") or {}) or {}
    return {
        "id": show.get("id"),
        "name": show.get("name"),
        "status": show.get("status"),
        "premiered": premiered,
        "year": premiered[:4] if premiered else None,
        "network": network.get("name"),
        "genres": show.get("genres") or [],
        "image": img,
        "imdb": f"https://www.imdb.com/title/{imdb}" if imdb else None,
    }


@api_router.get("/tv/search")
async def tv_search(q: str):
    """Autocomplete-style show search. Returns up to 10 simplified matches."""
    try:
        r = requests.get(
            "https://api.tvmaze.com/search/shows",
            params={"q": q},
            timeout=8,
        )
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("tvmaze search failed: %s", exc)
        return {"results": []}
    results = [_simplify_show(row["show"]) for row in rows[:10] if row.get("show")]
    return {"results": results}


def _tv_status_one(name: str) -> dict:
    import time as _time

    key = name.lower()
    cached = _tv_cache.get(key)
    if cached and _time.time() - cached["ts"] < _TV_TTL:
        return cached["data"]

    data = {
        "name": name,
        "matchedName": None,
        "status": None,
        "highlight": "none",  # new | soon | returning | between | ended | none
        "label": None,
        "nextAirdate": None,
        "image": None,
        "imdb": None,
    }
    try:
        r = requests.get(
            "https://api.tvmaze.com/singlesearch/shows",
            params={"q": name, "embed[]": ["nextepisode", "previousepisode"]},
            timeout=8,
        )
        if r.status_code == 404:
            data["highlight"] = "unknown"
            _tv_cache[key] = {"ts": _time.time(), "data": data}
            return data
        r.raise_for_status()
        show = r.json()
        emb = show.get("_embedded") or {}
        nxt = emb.get("nextepisode") or {}
        prv = emb.get("previousepisode") or {}
        status = show.get("status")
        img = (show.get("image") or {}).get("medium")
        imdb = (show.get("externals") or {}).get("imdb")

        highlight, label, airdate = "none", None, None
        if nxt.get("airdate"):
            dd = _days_from_today(nxt["airdate"])
            airdate = nxt["airdate"]
            if dd == 0:
                highlight, label = "new", "New episode today!"
            elif dd is not None and 0 < dd <= 7:
                highlight, label = "soon", f"New episode {_fmt_date(nxt['airdate'])}"
            elif dd is not None and dd > 7:
                highlight, label = "returning", f"Returns {_fmt_date(nxt['airdate'])}"
        elif prv.get("airdate"):
            dd = _days_from_today(prv["airdate"])
            if dd is not None and -3 <= dd <= 0:
                highlight, label, airdate = "new", "New episode out now", prv["airdate"]
            elif status == "Ended":
                highlight, label = "ended", "Series ended"
            else:
                highlight, label = "between", "Between seasons"
        else:
            if status == "Ended":
                highlight, label = "ended", "Series ended"
            elif status == "Running":
                highlight, label = "between", "Between seasons"

        data.update(
            matchedName=show.get("name"),
            status=status,
            highlight=highlight,
            label=label,
            nextAirdate=airdate,
            image=img,
            imdb=f"https://www.imdb.com/title/{imdb}" if imdb else None,
        )
        _tv_cache[key] = {"ts": _time.time(), "data": data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("tvmaze status failed %s: %s", name, exc)
    return data


@api_router.get("/tv/status")
async def tv_status(names: str):
    """Release status for a pipe-separated list of show names."""
    results = []
    for raw in names.split("|"):
        nm = raw.strip()
        if nm:
            results.append(_tv_status_one(nm))
    return {"results": results}

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
