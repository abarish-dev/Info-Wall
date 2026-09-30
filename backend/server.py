from fastapi import FastAPI, APIRouter, HTTPException
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import logging
import requests
from pathlib import Path

from airlines import resolve_airline


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}


ADSB_BASE = "https://api.adsb.lol/v2"
MILES_PER_NM = 1.15078

# Tiny in-memory cache so a brief upstream rate-limit (429) or hiccup degrades
# to the last good result instead of surfacing an error in the app.
_flight_cache: dict = {}
_FLIGHT_CACHE_TTL = 120  # seconds a cached result is considered fresh


@api_router.get("/flights/nearby")
def flights_nearby(lat: float, lon: float, radius: float = 25):
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
def tickers_verify(symbols: str):
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
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    try:
        d = _dt.strptime(iso[:10], "%Y-%m-%d").date()
        today = _dt.now(ZoneInfo("America/New_York")).date()
        return (d - today).days
    except Exception:  # noqa: BLE001
        return None


def _iso_to_eastern_date(iso: str) -> str:
    """ESPN event times are UTC (e.g. 2026-09-30T00:05Z). Convert to the US
    Eastern calendar date so an evening ET game isn't shown a day late."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    try:
        dt = _dt.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return iso[:10]
        return dt.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:  # noqa: BLE001
        return iso[:10]


def _iso_to_eastern_time(iso: str):
    """ESPN event times are UTC. Return the ET clock like '7:05p' (or '12p' /
    '7p' on the hour), or None if the time isn't a real scheduled kickoff
    (ESPN uses midnight ET / 'TBD' as a placeholder before the time is set)."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    try:
        dt = _dt.fromisoformat(iso.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            return None
        et = dt.astimezone(ZoneInfo("America/New_York"))
        # ESPN placeholder for an unscheduled time is midnight ET — skip it.
        if et.hour == 0 and et.minute == 0:
            return None
        h12 = et.hour % 12 or 12
        ampm = "a" if et.hour < 12 else "p"
        if et.minute == 0:
            return f"{h12}{ampm}"
        return f"{h12}:{et.minute:02d}{ampm}"
    except Exception:  # noqa: BLE001
        return None



def _hours_since(iso: str):
    """Hours elapsed since an ESPN UTC event start time (negative if future)."""
    from datetime import datetime as _dt, timezone as _tz

    try:
        g = _dt.fromisoformat(iso.replace("Z", "+00:00"))
        if g.tzinfo is None:
            g = g.replace(tzinfo=_tz.utc)
        return (_dt.now(_tz.utc) - g).total_seconds() / 3600.0
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
def tv_search(q: str):
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
        "id": None,
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
            id=show.get("id"),
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
def tv_status(names: str):
    """Release status for a pipe-separated list of show names."""
    results = []
    for raw in names.split("|"):
        nm = raw.strip()
        if nm:
            results.append(_tv_status_one(nm))
    return {"results": results}


# ---------------------------------------------------------------------------
# Live stock quotes (Yahoo Finance chart, keyless) — price + daily change.
# ---------------------------------------------------------------------------
_quote_cache: dict = {}
_QUOTE_TTL = 60  # seconds


def _quote_one(sym: str) -> dict:
    import time as _time

    cached = _quote_cache.get(sym)
    if cached and _time.time() - cached["ts"] < _QUOTE_TTL:
        return cached["data"]

    data = {
        "symbol": sym,
        "price": None,
        "prevClose": None,
        "change": None,
        "changePct": None,
        "currency": None,
    }
    try:
        r = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
            params={"interval": "1d", "range": "1d"},
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=8,
        )
        r.raise_for_status()
        meta = r.json()["chart"]["result"][0]["meta"]
        price = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        change = pct = None
        if price is not None and prev:
            change = round(price - prev, 2)
            pct = round((price - prev) / prev * 100, 2)
        data.update(
            price=price,
            prevClose=prev,
            change=change,
            changePct=pct,
            currency=meta.get("currency"),
        )
        _quote_cache[sym] = {"ts": _time.time(), "data": data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("quote failed %s: %s", sym, exc)
    return data


@api_router.get("/tickers/quotes")
def tickers_quotes(symbols: str):
    """Live price + daily change for a comma-separated list of symbols."""
    seen = set()
    results = []
    for raw in symbols.split(","):
        sym = raw.strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        results.append(_quote_one(sym))
    return {"results": results}


# ---------------------------------------------------------------------------
# TV episodes (TVmaze) — upcoming + recent episodes and season info for one show.
# ---------------------------------------------------------------------------
@api_router.get("/tv/episodes")
def tv_episodes(id: int):  # noqa: A002
    from datetime import date as _date, datetime as _dt

    try:
        r = requests.get(
            f"https://api.tvmaze.com/shows/{id}",
            params={"embed": "episodes"},
            timeout=8,
        )
        r.raise_for_status()
        show = r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("tvmaze episodes failed %s: %s", id, exc)
        raise HTTPException(status_code=404, detail="Show not found")

    eps = ((show.get("_embedded") or {}).get("episodes")) or []
    today = _date.today()

    def _row(e):
        return {
            "season": e.get("season"),
            "number": e.get("number"),
            "name": e.get("name"),
            "airdate": e.get("airdate"),
        }

    upcoming, past = [], []
    for e in eps:
        ad = e.get("airdate")
        try:
            d = _dt.strptime(ad[:10], "%Y-%m-%d").date() if ad else None
        except Exception:  # noqa: BLE001
            d = None
        if d and d >= today:
            upcoming.append(_row(e))
        else:
            past.append(_row(e))

    seasons = max((e.get("season") or 0) for e in eps) if eps else 0
    net = show.get("network") or {}
    web = show.get("webChannel") or {}
    watch_name = web.get("name") or net.get("name")
    watch_url = (
        show.get("officialSite")
        or web.get("officialSite")
        or net.get("officialSite")
    )
    return {
        "name": show.get("name"),
        "status": show.get("status"),
        "network": watch_name,
        "seasons": seasons,
        "totalEpisodes": len(eps),
        "watchName": watch_name,
        "watchUrl": watch_url,
        "upcoming": upcoming[:8],
        "recent": list(reversed(past))[:4],
    }


# ---------------------------------------------------------------------------
# Team game highlights (ESPN public site API, keyless) — next/live game.
# ---------------------------------------------------------------------------
_LEAGUE_PATH = {
    "NFL": ("football", "nfl"),
    "NBA": ("basketball", "nba"),
    "MLB": ("baseball", "mlb"),
    "NHL": ("hockey", "nhl"),
}
_team_cache: dict = {}
_TEAM_TTL = 120
_sb_cache: dict = {}


def _to_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _scoreboard_map(sport: str, lg: str) -> dict:
    """abbr -> live/final game info from the league scoreboard (60s cache)."""
    import time as _time

    key = f"{sport}/{lg}"
    cached = _sb_cache.get(key)
    if cached and _time.time() - cached["ts"] < 60:
        return cached["data"]
    m: dict = {}
    try:
        r = requests.get(
            f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{lg}/scoreboard",
            timeout=8,
        )
        r.raise_for_status()
        for e in r.json().get("events", []):
            comp = (e.get("competitions") or [{}])[0]
            stype = (comp.get("status") or {}).get("type") or {}
            state = stype.get("state")
            detail = stype.get("shortDetail") or ""
            comps = comp.get("competitors") or []
            for c in comps:
                team = c.get("team") or {}
                ab = team.get("abbreviation")
                if not ab:
                    continue
                others = [x for x in comps if x is not c]
                oc = others[0] if others else {}
                m[ab.upper()] = {
                    "state": state,
                    "detail": detail,
                    "score": _to_int(c.get("score")),
                    "opp": (oc.get("team") or {}).get("abbreviation"),
                    "oppScore": _to_int(oc.get("score")),
                    "home": c.get("homeAway") == "home",
                    "name": team.get("displayName"),
                    "logo": team.get("logo"),
                    "date": e.get("date"),
                }
        _sb_cache[key] = {"ts": _time.time(), "data": m}
    except Exception as exc:  # noqa: BLE001
        logger.warning("espn scoreboard failed %s/%s: %s", sport, lg, exc)
    return m


def _next_event_from_schedule(sport: str, lg: str, abbr: str):
    """Find a team's current/next game from the schedule endpoint, which — unlike
    the regular-season `nextEvent` field — includes POSTSEASON games (MLB/NBA/NHL
    playoffs, NFL playoffs, Super Bowl, World Series). Returns the ESPN event
    dict for a live game, the soonest upcoming game, or a final within ~14h."""
    try:
        r = requests.get(
            f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{lg}/teams/{abbr.lower()}/schedule",
            timeout=8,
        )
        r.raise_for_status()
        events = r.json().get("events") or []  # chronological
        best = None
        for e in events:
            comp = (e.get("competitions") or [{}])[0]
            state = ((comp.get("status") or {}).get("type") or {}).get("state")
            if state == "in":
                return e  # a live game always wins
            if best is None:
                hrs = _hours_since(e.get("date")) if e.get("date") else None
                # First game that hasn't finished more than ~14h ago = current/next.
                if hrs is None or hrs <= 14:
                    best = e
        return best
    except Exception as exc:  # noqa: BLE001
        logger.warning("espn schedule failed %s/%s %s: %s", sport, lg, abbr, exc)
        return None


def _team_status_one(code: str) -> dict:
    import time as _time

    data = {
        "team": code,
        "name": None,
        "logo": None,
        "highlight": "none",  # live | today | soon | upcoming | recent | offseason | none
        "label": None,
        "opponent": None,
        "date": None,
        "score": None,
        "oppScore": None,
        "record": None,
    }
    if ":" not in code:
        return data
    league, abbr = code.split(":", 1)
    sport_lg = _LEAGUE_PATH.get(league)
    if not sport_lg:
        return data
    sport, lg = sport_lg

    # Live/just-finished games come from the scoreboard (has scores + clock).
    g = _scoreboard_map(sport, lg).get(abbr.upper())
    if g and g["state"] == "in":
        opp = g["opp"]
        vs = "vs" if g["home"] else "@"
        score_str = (
            f"{g['score']}-{g['oppScore']}"
            if g["score"] is not None and g["oppScore"] is not None
            else ""
        )
        data.update(
            name=g.get("name"),
            logo=g.get("logo"),
            opponent=opp,
            score=g["score"],
            oppScore=g["oppScore"],
            date=g.get("date"),
        )
        bits = " ".join(x for x in [f"{vs} {opp}", score_str, g["detail"]] if x)
        data.update(highlight="live", label=f"🔴 {bits}".strip())
        return data  # not cached — refreshes with the 60s scoreboard cache

    if g and g["state"] == "post":
        # Only a genuinely completed game within the last ~14h counts as a
        # "recent" score. A day-old game — or a Postponed/Suspended game (which
        # ESPN reports as state=post with a 0-0 score) — must NOT show; fall
        # through to the next-scheduled-game logic instead.
        detail = g.get("detail") or ""
        hrs = _hours_since(g.get("date")) if g.get("date") else None
        has = g["score"] is not None and g["oppScore"] is not None
        if "final" in detail.lower() and has and hrs is not None and 0 <= hrs <= 14:
            opp = g["opp"]
            vs = "vs" if g["home"] else "@"
            score_str = f"{g['score']}-{g['oppScore']}"
            data.update(
                name=g.get("name"),
                logo=g.get("logo"),
                opponent=opp,
                score=g["score"],
                oppScore=g["oppScore"],
                date=g.get("date"),
                highlight="recent",
                label=f"Final {score_str} {vs} {opp}".strip(),
            )
            return data

    cached = _team_cache.get(code)
    if cached and _time.time() - cached["ts"] < _TEAM_TTL:
        return cached["data"]

    try:
        r = requests.get(
            f"https://site.api.espn.com/apis/site/v2/sports/{sport}/{lg}/teams/{abbr.lower()}",
            timeout=8,
        )
        r.raise_for_status()
        t = r.json().get("team", {})
        logos = t.get("logos") or []
        data["name"] = t.get("displayName")
        data["logo"] = logos[0]["href"] if logos else None
        rec_items = (t.get("record") or {}).get("items") or []
        data["record"] = rec_items[0].get("summary") if rec_items else None

        ne = t.get("nextEvent") or []
        # The team-endpoint nextEvent is often missing during the postseason gap,
        # or points at a already-finished game ESPN hasn't rolled past yet. In
        # either case consult the schedule endpoint (covers regular + POSTSEASON:
        # playoffs, World Series, Super Bowl) to find the real current/next game.
        e = ne[0] if ne else None
        if e is not None:
            _c = (e.get("competitions") or [{}])[0]
            _st = ((_c.get("status") or {}).get("type") or {}).get("state")
            _h = _hours_since(e.get("date")) if e.get("date") else None
            if _st == "post" and (_h is None or _h > 14):
                e = None  # stale final — look for the next scheduled game instead
        if e is None:
            e = _next_event_from_schedule(sport, lg, abbr)
        if e:
            comp = (e.get("competitions") or [{}])[0]
            status = (comp.get("status") or {}).get("type") or {}
            state = status.get("state")  # pre | in | post
            short = status.get("shortDetail") or ""
            date = e.get("date")
            data["date"] = date
            # ESPN dates are UTC — use the Eastern calendar date for display
            # and day-diff so evening ET games aren't shown a day late.
            local_date = _iso_to_eastern_date(date) if date else None

            # Resolve opponent + home/away + scores relative to our team.
            opp, vs = None, "vs"
            my_score = opp_score = None
            my_id = t.get("id")
            for c in comp.get("competitors") or []:
                is_us = str((c.get("team") or {}).get("id")) == str(my_id)
                sc = c.get("score")
                try:
                    sc = int(sc) if sc is not None and str(sc) != "" else None
                except (ValueError, TypeError):
                    sc = None
                if is_us:
                    vs = "@" if c.get("homeAway") == "away" else "vs"
                    my_score = sc
                else:
                    opp = (c.get("team") or {}).get("abbreviation") or (
                        c.get("team") or {}
                    ).get("shortDisplayName")
                    opp_score = sc
            data["opponent"] = opp
            data["score"] = my_score
            data["oppScore"] = opp_score
            matchup = f"{vs} {opp}" if opp else ""
            has_scores = my_score is not None and opp_score is not None
            score_str = f"{my_score}-{opp_score}" if has_scores else ""
            days = _days_from_today(local_date) if local_date else None
            hrs = _hours_since(date) if date else None

            # A finished game only counts as a "recent" score for a short window
            # (~14h). After that ESPN often still returns it as nextEvent until
            # the next game is scheduled — showing a day-old "Final 0-0" is the
            # stale info we must drop.
            recent_final = (
                state == "post"
                and has_scores
                and hrs is not None
                and 0 <= hrs <= 14
            )

            if state == "in":
                bits = " ".join(x for x in [score_str, short] if x)
                data.update(highlight="live", label=f"🔴 {opp} {bits}".strip())
            elif recent_final:
                data.update(
                    highlight="recent", label=f"Final {score_str} {matchup}".strip()
                )
            else:
                # No current game to score: either a genuinely upcoming game, or
                # a stale finished game. Never expose a (0-0) score here.
                data["score"] = None
                data["oppScore"] = None
                upcoming_ok = state != "post" and days is not None and days >= 0
                time_str = _iso_to_eastern_time(date) if date else None
                mt = f"{time_str} {matchup}".strip() if time_str else matchup
                if upcoming_ok and days == 0:
                    data.update(highlight="today", label=f"Today {mt}".strip())
                elif upcoming_ok and 0 < days <= 7:
                    data.update(
                        highlight="soon",
                        label=f"{_fmt_date(local_date)} {mt}".strip(),
                    )
                elif upcoming_ok:
                    data.update(
                        highlight="upcoming",
                        label=f"{_fmt_date(local_date)} {mt}".strip(),
                    )
                else:
                    data.update(highlight="offseason", label="No games scheduled")
        else:
            data.update(highlight="offseason", label="No games scheduled")

        _team_cache[code] = {"ts": _time.time(), "data": data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("espn team status failed %s: %s", code, exc)
    return data


@api_router.get("/teams/status")
def teams_status(teams: str):
    """Next/live game highlight for a pipe-separated list of LEAGUE:ABBR codes."""
    results = []
    for raw in teams.split("|"):
        code = raw.strip().upper()
        if code:
            results.append(_team_status_one(code))
    return {"results": results}


# ---------------------------------------------------------------------------
# Current weather (Open-Meteo, keyless) — for on-device weather display.
# ---------------------------------------------------------------------------
_WMO = {
    0: "Clear", 1: "Mostly Clear", 2: "Partly Cloudy", 3: "Cloudy",
    45: "Fog", 48: "Rime Fog", 51: "Drizzle", 53: "Drizzle", 55: "Drizzle",
    61: "Rain", 63: "Rain", 65: "Heavy Rain", 66: "Freezing Rain",
    67: "Freezing Rain", 71: "Snow", 73: "Snow", 75: "Heavy Snow",
    77: "Snow", 80: "Showers", 81: "Showers", 82: "Heavy Showers",
    85: "Snow Showers", 86: "Snow Showers", 95: "Thunderstorm",
    96: "Thunderstorm", 99: "Thunderstorm",
}
_weather_cache: dict = {}


def _wx_openmeteo(lat: float, lon: float) -> dict:
    r = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "current": "temperature_2m,weather_code",
            "daily": "temperature_2m_max,temperature_2m_min",
            "temperature_unit": "fahrenheit",
            "timezone": "auto",
        },
        timeout=8,
    )
    r.raise_for_status()
    j = r.json()
    cur = j.get("current") or {}
    daily = j.get("daily") or {}
    code = cur.get("weather_code")
    return {
        "temp": round(cur["temperature_2m"]) if cur.get("temperature_2m") is not None else None,
        "code": code,
        "text": _WMO.get(code, "Clear"),
        "hi": round(daily["temperature_2m_max"][0]) if daily.get("temperature_2m_max") else None,
        "lo": round(daily["temperature_2m_min"][0]) if daily.get("temperature_2m_min") else None,
    }


def _wx_wttr(lat: float, lon: float) -> dict:
    # Fallback provider (different infra/IP limits than Open-Meteo).
    r = requests.get(
        f"https://wttr.in/{lat},{lon}",
        params={"format": "j1"},
        headers={"User-Agent": "curl/8"},
        timeout=8,
    )
    r.raise_for_status()
    j = r.json()
    cur = (j.get("current_condition") or [{}])[0]
    wk = (j.get("weather") or [{}])[0]
    desc = ((cur.get("weatherDesc") or [{}])[0]).get("value")

    def _i(v):
        try:
            return int(round(float(v)))
        except (TypeError, ValueError):
            return None

    return {
        "temp": _i(cur.get("temp_F")),
        "code": None,
        "text": desc or "Clear",
        "hi": _i(wk.get("maxtempF")),
        "lo": _i(wk.get("mintempF")),
    }


@api_router.get("/weather/current")
def weather_current(lat: float, lon: float):
    """Current temp + condition + daily hi/lo (Fahrenheit).

    Prefers Open-Meteo (tracks phone weather apps closely). Falls back to
    wttr.in only when Open-Meteo is unavailable, and caches that fallback for
    just a few minutes so we retry the accurate source quickly instead of
    getting "stuck" on the fallback's reading. On total failure, serves the
    last good value so the panel still shows something.
    """
    import time as _time

    key = f"{round(lat, 2)}:{round(lon, 2)}"
    cached = _weather_cache.get(key)
    now = _time.time()
    if cached and now - cached["ts"] < cached.get("ttl", 600):
        return cached["data"]

    # Primary source (accurate) cached 10 min; fallback cached only 4 min.
    for fn, ttl in ((_wx_openmeteo, 600), (_wx_wttr, 240)):
        try:
            d = fn(lat, lon)
            if d and d.get("temp") is not None:
                _weather_cache[key] = {"ts": now, "data": d, "ttl": ttl}
                return d
        except Exception as exc:  # noqa: BLE001
            logger.warning("weather source %s failed: %s", fn.__name__, exc)
    # All sources failed — serve last good value (stale) if we have one.
    if cached:
        return cached["data"]
    return {"temp": None, "code": None, "text": None, "hi": None, "lo": None}


# ---------------------------------------------------------------------------
# Compact device endpoint — the ESP32 panel calls this so it can render live
# scores (and detect a score to flash) without the phone. Small field names
# keep the JSON tiny for on-device parsing.
# ---------------------------------------------------------------------------
@api_router.get("/device/scores")
def device_scores(teams: str):
    def _ascii(s):
        return (s or "").replace("🔴", "LIVE ").encode("ascii", "ignore").decode().strip()

    out = []
    for raw in teams.split("|"):
        code = raw.strip().upper()
        if not code:
            continue
        s = _team_status_one(code)
        out.append(
            {
                "c": code,
                "s": s.get("score"),
                "o": s.get("oppScore"),
                "h": s.get("highlight"),
                "l": _ascii(s.get("label")),
                "r": s.get("record"),
            }
        )
    return {"t": out}


@api_router.get("/device/time")
async def device_time():
    # Current UTC epoch seconds — the panel sets its RTC from this when NTP
    # (UDP 123) is blocked on the local network. The firmware applies the
    # US-Eastern timezone locally.
    import time as _time
    return {"epoch": int(_time.time())}



@api_router.get("/device/quotes")
def device_quotes(symbols: str):
    seen, out = set(), []
    for raw in symbols.split(","):
        sym = raw.strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        q = _quote_one(sym)
        out.append({"s": sym, "p": q.get("price"), "c": q.get("changePct")})
    return {"q": out}


@api_router.get("/device/planes")
def device_planes(lat: float, lon: float, radius: float = 25):
    import re as _re

    def _iata(callsign):
        # ICAO airline callsigns are 3 letters + a flight number (DAL123, UAL45).
        m = _re.match(r"^([A-Z]{3})\d", (callsign or "").strip().upper())
        return m.group(1) if m else None

    data = flights_nearby(lat, lon, radius)  # reuse + cache
    out = [
        {
            "f": f["callsign"],
            "al": f.get("airline"),
            "ia": _iata(f["callsign"]),
            "d": round(f["distance"] * 1.15078, 1) if f.get("distance") is not None else None,
        }
        for f in data.get("flights", [])[:6]
    ]
    return {"p": out}


@api_router.get("/device/tv")
def device_tv(names: str):
    def _ascii(s):
        return (s or "").encode("ascii", "ignore").decode().strip()

    out = []
    for raw in names.split("|"):
        nm = raw.strip()
        if not nm:
            continue
        s = _tv_status_one(nm)
        out.append({"n": nm, "h": s.get("highlight"), "l": _ascii(s.get("label"))})
    return {"v": out}


# ---------------------------------------------------------------------------
# Folly Beach tides — NOAA CO-OPS station 8665424 (Folly Creek, Hwy 171
# bridge). Returns the next couple of high/low tide events + local water temp
# (from the nearest reporting station, Charleston 8665530). Compact fields.
# ---------------------------------------------------------------------------
_folly_cache: dict = {}
_lake_cache: dict = {}

FOLLY_STATION = "8665424"          # Folly Creek, Hwy 171 bridge (tide preds)
FOLLY_TEMP_STATION = "8665530"     # Charleston — nearest water-temp station
COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"


def _fmt_clock(hhmm: str) -> str:
    # "09:08" -> "9:08a" / "15:02" -> "3:02p"
    h, m = int(hhmm[:2]), int(hhmm[3:5])
    ap = "a" if h < 12 else "p"
    h12 = h % 12 or 12
    return f"{h12}:{m:02d}{ap}"


def _folly_water_temp() -> int | None:
    try:
        r = requests.get(
            COOPS,
            params={
                "product": "water_temperature",
                "application": "InfoWall",
                "station": FOLLY_TEMP_STATION,
                "date": "latest",
                "units": "english",
                "time_zone": "lst_ldt",
                "format": "json",
            },
            timeout=8,
        )
        r.raise_for_status()
        data = r.json().get("data") or []
        if data and data[0].get("v"):
            return int(round(float(data[0]["v"])))
    except Exception as exc:  # noqa: BLE001
        logger.warning("folly water temp failed: %s", exc)
    return None


@api_router.get("/device/folly")
def device_folly():
    """Next high/low tides at Folly Creek (Hwy 171 bridge) + water temp."""
    import time as _time
    import datetime as _dt
    from zoneinfo import ZoneInfo

    cached = _folly_cache.get("d")
    if cached and _time.time() - cached["ts"] < 1800:
        return cached["data"]

    et = ZoneInfo("America/New_York")
    now = _dt.datetime.now(et)
    events: list[dict] = []
    try:
        r = requests.get(
            COOPS,
            params={
                "product": "predictions",
                "application": "InfoWall",
                "begin_date": now.strftime("%Y%m%d"),
                "end_date": (now + _dt.timedelta(days=2)).strftime("%Y%m%d"),
                "datum": "MLLW",
                "station": FOLLY_STATION,
                "time_zone": "lst_ldt",
                "units": "english",
                "interval": "hilo",
                "format": "json",
            },
            timeout=8,
        )
        r.raise_for_status()
        for p in r.json().get("predictions", []):
            # p["t"] like "2026-09-27 09:08" (station local time = Eastern)
            t = _dt.datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=et)
            if t <= now:
                continue
            events.append(
                {
                    "y": p["type"],  # "H" | "L"
                    "t": _fmt_clock(p["t"][11:16]),
                    "v": round(float(p["v"]), 1),
                }
            )
            if len(events) >= 2:
                break
    except Exception as exc:  # noqa: BLE001
        logger.warning("folly tides failed: %s", exc)
        if cached:
            return cached["data"]

    # Tide direction now: if the NEXT event is a high tide the water is still
    # coming in (rising/flood); if it's a low tide it's going out (ebb).
    direction = None
    if events:
        direction = "in" if events[0]["y"] == "H" else "out"

    out = {"e": events, "w": _folly_water_temp(), "dir": direction}
    # Only cache a result that actually has tide data; caching an empty result
    # (transient upstream failure on a cold cache) would blank the module for
    # the whole TTL. Without data, return but let the next request retry.
    if events:
        _folly_cache["d"] = {"ts": _time.time(), "data": out}
    return out


# ---------------------------------------------------------------------------
# Lake Norman — Duke Energy lake-level feed (official) for the current level vs
# full pond, plus water temp from the USGS gauge at Cowans Ford (the Lake
# Norman dam). Duke publishes no temperature, so USGS fills that in.
# ---------------------------------------------------------------------------
DUKE_LEVELS = "https://api.hydro-derived.duke-energy.app/lakes/current-level"
USGS_IV = "https://waterservices.usgs.gov/nwis/iv/"
LKN_TEMP_SITE = "0214264790"  # Catawba R above NC-73 at Cowans Ford (LKN dam)


def _lake_water_temp() -> int | None:
    try:
        r = requests.get(
            USGS_IV,
            params={
                "format": "json",
                "sites": LKN_TEMP_SITE,
                "parameterCd": "00010",  # water temperature, °C
                "siteStatus": "active",
            },
            timeout=8,
        )
        r.raise_for_status()
        ts = r.json()["value"]["timeSeries"]
        for series in ts:
            vals = series["values"][0]["value"]
            if vals:
                c = float(vals[-1]["value"])
                return int(round(c * 9 / 5 + 32))
    except Exception as exc:  # noqa: BLE001
        logger.warning("lake water temp failed: %s", exc)
    return None


@api_router.get("/device/lake")
def device_lake():
    """Lake Norman level (Duke Energy) vs full pond + water temp (USGS)."""
    import time as _time

    cached = _lake_cache.get("d")
    if cached and _time.time() - cached["ts"] < 3600:
        return cached["data"]

    lvl = tgt = full = None
    try:
        r = requests.get(DUKE_LEVELS, timeout=8)
        r.raise_for_status()
        for lk in r.json():
            if "NORMAN" in (lk.get("LakeName") or "").upper():
                lvl = round(float(lk["Actual"]), 1)
                tgt = round(float(lk["Target"]), 1)
                full = round(float(lk["Max"]), 1)
                break
    except Exception as exc:  # noqa: BLE001
        logger.warning("lake level failed: %s", exc)
        if cached:
            return cached["data"]

    # USGS water temp is intermittently empty. Keep the last known-good reading
    # (sticky) so a transient miss doesn't blank the WATER line on the panel.
    w = _lake_water_temp()
    if w is None:
        w = _lake_cache.get("w")
    else:
        _lake_cache["w"] = w

    out = {"lvl": lvl, "tgt": tgt, "full": full, "w": w}
    # Don't cache a failed cold-cache fetch (would blank the module for the TTL).
    if lvl is not None:
        # If we still have no water temp, expire sooner (~5 min) so it retries
        # instead of serving a blank temp for the full hour.
        ts = _time.time() if w is not None else _time.time() - 3300
        _lake_cache["d"] = {"ts": ts, "data": out}
    return out

# Include the router in the main app
app.include_router(api_router)


# Health check for deployment/uptime probes (no /api prefix), matching Aura.
@app.get("/health")
async def health():
    return {"status": "ok"}

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
