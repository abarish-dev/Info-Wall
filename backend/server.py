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
                "track": a.get("track"),
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
_TV_TTL = 6 * 3600  # 6 hours: schedules rarely change


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


# ---------------------------------------------------------------------------
# US-first air dates. TVmaze lists a show under its ORIGIN network, so a UK
# show (e.g. All Creatures Great and Small, Channel 5) reports UK dates that
# PBS airs months later. Order of preference:
#   1. the matched show is US-origin (US network, or a streamer with a US /
#      global web channel) -> use TVmaze as-is;
#   2. an exact-title, running, US-origin TVmaze show exists -> use that one;
#   3. a per-show override below with a still-relevant US date -> use it;
#   4. otherwise the TVmaze origin dates (old behaviour).
# Overrides expire on their own: an entry is ignored once its last projected
# US episode is >3 days past, or as soon as rule 1/2 finds real US data.
# ---------------------------------------------------------------------------
_US_AIRING_OVERRIDES = {
    # TVmaze id -> list of US season runs (dates/times are US Eastern).
    42836: [  # All Creatures Great and Small (2020) - Channel 5 UK -> PBS MASTERPIECE
        {"season": 7, "premiere": "2027-01-17", "time": "21:00",
         "network": "PBS", "weekly": True, "episodes": None},  # None -> TVmaze season count
    ],
}
_TV_RECENT_DAYS = 3


def _is_us_origin(show: dict) -> bool:
    net = show.get("network") or {}
    if net:
        return ((net.get("country") or {}).get("code")) == "US"
    web = show.get("webChannel") or {}
    if web:
        cc = (web.get("country") or {}).get("code")
        return cc in (None, "US")  # Apple TV / Netflix / Paramount+ are global
    return False


def _norm_title(t: str) -> str:
    import re as _re
    return _re.sub(r"[^a-z0-9]+", " ", (t or "").lower().replace("&", "and")).strip()


def _attach_episodes(show: dict) -> dict:
    """Fill show['_embedded'] with next/previous episodes via the show's links.
    TVmaze's ?embed[]= variant is often very slow on a cache miss (10s+), while
    plain show and episode fetches answer in well under a second."""
    emb = show.setdefault("_embedded", {})
    links = show.get("_links") or {}
    for key in ("nextepisode", "previousepisode"):
        if emb.get(key) is not None:
            continue
        href = (links.get(key) or {}).get("href")
        if not href:
            continue
        try:
            rr = requests.get(href, timeout=4)
            if rr.ok:
                emb[key] = rr.json()
        except requests.exceptions.RequestException:
            pass
    return show


def _us_alternative(name: str, exclude_id) -> dict | None:
    """Exact-title, running, US-origin TVmaze show other than the match."""
    try:
        r = requests.get("https://api.tvmaze.com/search/shows",
                         params={"q": name}, timeout=8)
        r.raise_for_status()
        want = _norm_title(name)
        for row in r.json() or []:
            sh = row.get("show") or {}
            if (sh.get("id") != exclude_id and _norm_title(sh.get("name")) == want
                    and sh.get("status") == "Running" and _is_us_origin(sh)):
                rr = requests.get(f"https://api.tvmaze.com/shows/{sh['id']}",
                                  timeout=8)
                rr.raise_for_status()
                return _attach_episodes(rr.json())
    except Exception as exc:  # noqa: BLE001
        logger.warning("tvmaze US alternative failed %s: %s", name, exc)
    return None


def _season_episode_count(show_id: int, season: int) -> int | None:
    try:
        r = requests.get(f"https://api.tvmaze.com/shows/{show_id}/episodes", timeout=8)
        r.raise_for_status()
        n = sum(1 for e in r.json() or []
                if e.get("season") == season and e.get("type", "regular") == "regular")
        return n or None
    except Exception:  # noqa: BLE001
        return None


def _us_override_dates(show_id, today=None):
    """Projected US episode dates (ISO) for the active override run, or None."""
    from datetime import date as _date, timedelta as _td, datetime as _dt
    from zoneinfo import ZoneInfo

    runs = _US_AIRING_OVERRIDES.get(show_id)
    if not runs:
        return None
    today = today or _dt.now(ZoneInfo("America/New_York")).date()
    for run in runs:
        first = _date.fromisoformat(run["premiere"])
        n = run.get("episodes") or (_season_episode_count(show_id, run["season"])
                                    if run.get("weekly") else 1) or 1
        dates = [first + _td(weeks=i) for i in range(n if run.get("weekly") else 1)]
        if (today - dates[-1]).days <= _TV_RECENT_DAYS:  # not expired yet
            return {"dates": [d.isoformat() for d in dates], "run": run}
    return None


def _label_for(next_iso, prev_iso, status):
    """(highlight, label, airdate) from next/previous episode dates."""
    if next_iso:
        dd = _days_from_today(next_iso)
        if dd == 0:
            return "new", "New episode today!", next_iso
        if dd is not None and 0 < dd <= 7:
            return "soon", f"New episode {_fmt_date(next_iso)}", next_iso
        if dd is not None and dd > 7:
            return "returning", f"Returns {_fmt_date(next_iso)}", next_iso
    if prev_iso:
        dd = _days_from_today(prev_iso)
        if dd is not None and -_TV_RECENT_DAYS <= dd <= 0:
            return "new", "New episode out now", prev_iso
    if status == "Ended":
        return "ended", "Series ended", None
    if prev_iso or status == "Running":
        return "between", "Between seasons", None
    return "none", None, None


_tv_snap: dict | None = None


def _tv_snapshot() -> dict:
    """Last-known TV dates baked into the deploy (tv_snapshot.json), used only
    when TVmaze is too slow to answer."""
    global _tv_snap
    if _tv_snap is None:
        try:
            import json as _j
            _tv_snap = _j.loads((Path(__file__).parent / "tv_snapshot.json").read_text())
        except Exception:  # noqa: BLE001
            _tv_snap = {}
    return _tv_snap


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
        "source": None,   # tvmaze | tvmaze-us-alt | us-override
        "usNetwork": None,
        "usAirtime": None,
    }
    try:
        # TVmaze is sometimes very slow on the first hit (10s+) and fast right
        # after, so use short timeouts and retry instead of one long wait.
        r = None
        last_exc = None
        for _attempt, _to in enumerate((7, 4)):
            try:
                r = requests.get(
                    "https://api.tvmaze.com/singlesearch/shows",
                    params={"q": name},
                    timeout=_to,
                )
                break
            except requests.exceptions.RequestException as exc:  # noqa: PERF203
                last_exc = exc
        if r is None:
            raise last_exc
        if r.status_code == 404:
            data["highlight"] = "unknown"
            _tv_cache[key] = {"ts": _time.time(), "data": data}
            return data
        r.raise_for_status()
        show = r.json()
        source = "tvmaze"
        if not _is_us_origin(show):
            alt = _us_alternative(name, show.get("id"))
            if alt:
                show, source = alt, "tvmaze-us-alt"
        _attach_episodes(show)
        emb = show.get("_embedded") or {}
        nxt = (emb.get("nextepisode") or {}).get("airdate")
        prv = (emb.get("previousepisode") or {}).get("airdate")
        status = show.get("status")
        img = (show.get("image") or {}).get("medium")
        imdb = (show.get("externals") or {}).get("imdb")

        ov = None if source != "tvmaze" or _is_us_origin(show) else _us_override_dates(show.get("id"))
        if ov:
            source = "us-override"
            dates = ov["dates"]
            past = [d for d in dates if (_days_from_today(d) or 0) < 0]
            future = [d for d in dates if (_days_from_today(d) or 0) >= 0]
            nxt = future[0] if future else None
            prv = past[-1] if past else None
            data.update(usNetwork=ov["run"]["network"], usAirtime=ov["run"].get("time"))
            status = "Running"
        highlight, label, airdate = _label_for(nxt, prv, status)

        data.update(
            matchedName=show.get("name"),
            id=show.get("id"),
            status=status,
            highlight=highlight,
            label=label,
            nextAirdate=airdate,
            rawNext=nxt,
            rawPrev=prv,
            image=img,
            imdb=f"https://www.imdb.com/title/{imdb}" if imdb else None,
            source=source,
        )
        _tv_cache[key] = {"ts": _time.time(), "data": data}
    except Exception as exc:  # noqa: BLE001
        logger.warning("tvmaze status failed %s: %s", name, exc)
        if cached:  # serve the last good answer rather than blank fields
            return cached["data"]
        snap = _tv_snapshot().get(key)
        if snap:  # baked last-known dates: recompute the label for today
            hl, lb, ad = _label_for(snap.get("rawNext"), snap.get("rawPrev"), snap.get("status"))
            data.update(snap)
            data.update(highlight=hl, label=lb, nextAirdate=ad, source="snapshot")
            return data
        data["failed"] = True
    return data


def _tv_status_many(nms):
    """Look up several shows at once so a cold cache stays fast."""
    if len(nms) <= 1:
        return [_tv_status_one(n) for n in nms]
    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=min(8, len(nms))) as ex:
        return list(ex.map(_tv_status_one, nms))


@api_router.get("/tv/status")
def tv_status(names: str):
    """Release status for a pipe-separated list of show names."""
    nms = [r.strip() for r in names.split("|") if r.strip()]
    return {"results": _tv_status_many(nms)}


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

# ESPN is inconsistent about some team codes: the NHL Mammoth are "UTAH" in
# the team list / team page but "UTA" on scoreboards, schedules and nextEvent.
# Canonicalize per league so the panel text matches its logo key ("vs UTAH").
# NBA Jazz stay "UTAH" and are untouched. (Firmware logo aliases for LAK/TBL/
# NJD/SJS/WAS etc. live separately; those are for logo lookup only.)
_ABBR_CANON = {"NHL": {"UTA": "UTAH"}}


def _canon_abbr(league: str, ab) -> str:
    ab = (ab or "").upper()
    return _ABBR_CANON.get((league or "").upper(), {}).get(ab, ab)


def _scoreboard_for(sport: str, lg: str, league: str, abbr: str):
    """Lookup a team on today's scoreboard, accepting ESPN's raw abbrs that map
    to our canonical form (e.g. UTA -> UTAH for a followed NHL:UTAH)."""
    m = _scoreboard_map(sport, lg)
    ab = (abbr or "").upper()
    if ab in m:
        return m[ab]
    for raw, can in _ABBR_CANON.get((league or "").upper(), {}).items():
        if can == ab and raw in m:
            return m[raw]
    return None

_team_cache: dict = {}
_TEAM_TTL = 120
# ESPN's site.api.espn.com is Akamai-blocked from datacenter IPs (Vercel gets
# 403 Forbidden on every call), while site.web.api.espn.com serves the same
# JSON and isn't. Send a browser User-Agent too, same as the Aura backend.
_ESPN_BASE = "https://site.web.api.espn.com/apis/site/v2/sports"
_ESPN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}
_sb_cache: dict = {}


def _to_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def _live_detail(sport: str, status: dict) -> str:
    """Compact, ASCII game-state for a LIVE game, sized for the panel's ~16-char
    team row. Built from ESPN's status object (period/clock/type) with the
    shortDetail text as fallback.
      MLB:      T6 / B6 / M5 (middle) / E5 (end), DLY
      NHL:      P2 4:12, INT1 (intermission), OT 3:10, 2OT, SO
      NFL/NBA:  Q3 4:12, HALF, END Q1, OT 2:00
    """
    import re

    st = status or {}
    t = st.get("type") or {}
    short = (t.get("shortDetail") or "").strip()
    name = (t.get("name") or "").upper()
    low = short.lower()
    try:
        per = int(st.get("period") or 0)
    except (TypeError, ValueError):
        per = 0
    clock = (st.get("displayClock") or "").strip()
    if clock in ("0:00", "0.0", "00:00"):
        clock = ""

    if "DELAY" in name or "delay" in low:
        return "DLY"
    if "SUSPEND" in name or "suspend" in low:
        return "SUSP"

    if sport == "baseball":
        m = re.match(r"^(top|bot|bottom|mid|middle|end)\w*\s+(?:of\s+)?(?:the\s+)?(\d+)", low)
        if m:
            return {"t": "T", "b": "B", "m": "M", "e": "E"}[m.group(1)[0]] + m.group(2)
        return short.replace(" - ", " ")[:8]

    if sport == "hockey":
        if "SHOOTOUT" in name or "shootout" in low or re.search(r"\bso\b", low):
            return "SO"
        reg = 3
        if per > reg:
            n = per - reg
            pl = "OT" if n == 1 else f"{n}OT"
        else:
            pl = f"P{per}" if per else ""
        if "END" in name or low.startswith("end") or "intermission" in low:
            return f"INT{per}" if 0 < per < reg else f"END {pl}".strip()
        return f"{pl} {clock}".strip() or short.replace(" - ", " ")

    if sport in ("football", "basketball"):
        if "HALFTIME" in name or "halftime" in low:
            return "HALF"
        reg = 4
        if per > reg:
            n = per - reg
            pl = "OT" if n == 1 else f"{n}OT"
        else:
            pl = f"Q{per}" if per else ""
        if "END" in name or low.startswith("end"):
            return f"END {pl}".strip()
        return f"{pl} {clock}".strip() or short.replace(" - ", " ")

    return short.replace(" - ", " ")


def _live_label(vs: str, opp, score_str: str, det: str, limit: int = 16) -> str:
    """Live team label that always fits `limit` chars: drops the "@"/"vs",
    then the opponent, before ever truncating."""
    opp = opp or ""
    cands = [
        f"{vs} {opp} {score_str} {det}",
        f"{opp} {score_str} {det}",
        f"{score_str} {det}",
        f"{score_str}",
    ]
    for c in cands:
        c = " ".join(c.split())
        if c and len(c) <= limit:
            return c
    return " ".join(cands[-1].split())[:limit] or "LIVE"


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
            f"{_ESPN_BASE}/{sport}/{lg}/scoreboard",
            headers=_ESPN_HEADERS,
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
                    "cdet": _live_detail(sport, comp.get("status") or {}) if state == "in" else "",
                    "score": _to_int(c.get("score")),
                    "opp": (oc.get("team") or {}).get("abbreviation"),
                    "oppScore": _to_int(oc.get("score")),
                    "oppRec": ((oc.get("records") or [{}])[0] or {}).get("summary"),
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
            f"{_ESPN_BASE}/{sport}/{lg}/teams/{abbr.lower()}/schedule",
            headers=_ESPN_HEADERS,
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


_record_cache: dict = {}


def _team_record(code: str, sport: str, lg: str, abbr: str):
    """W-L record for the live path (which skips the team endpoint), so the
    panel's "NYY 93-68" header doesn't go blank during a game. Cached 1h."""
    import time as _time

    prev = (_team_cache.get(code) or {}).get("data") or {}
    if prev.get("record"):
        return prev["record"]
    hit = _record_cache.get(code)
    if hit and _time.time() - hit["ts"] < 3600:
        return hit["rec"]
    rec = None
    try:
        r = requests.get(f"{_ESPN_BASE}/{sport}/{lg}/teams/{abbr.lower()}",
                         headers=_ESPN_HEADERS, timeout=5)
        r.raise_for_status()
        items = ((r.json().get("team") or {}).get("record") or {}).get("items") or []
        rec = items[0].get("summary") if items else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("espn record failed %s: %s", code, exc)
    _record_cache[code] = {"ts": _time.time(), "rec": rec}
    return rec


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
    abbr = _canon_abbr(league, abbr)  # NHL:UTA -> look up as UTAH
    code = f"{league}:{abbr}"
    data["team"] = code

    # Live/just-finished games come from the scoreboard (has scores + clock).
    g = _scoreboard_for(sport, lg, league, abbr)
    if g and g["state"] == "in":
        opp = _canon_abbr(league, g["opp"])
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
        # ASCII only: the app forwards this label to the panel over BLE, and
        # the panel's 5x7 font draws a UTF-8 emoji as 4 garbage glyphs. The
        # app pill and the panel already show their own red "live" marker.
        # `label` is what the app pushes to the panel, so it must fit the
        # ~16-char team row ("@ TB 0-1 E5"); `labelLong` is the readable form
        # for the app's own UI ("@ TB 0-1 End 5th").
        # Keep the team's record from the last non-live lookup if we have one.
        cdet = g.get("cdet") or ""
        data.update(highlight="live", oppRecord=g.get("oppRec"),
                    label=_live_label(vs, opp, score_str, cdet),
                    labelLong=bits.strip(), vs=vs, detail=g["detail"], cdet=cdet,
                    record=_team_record(code, sport, lg, abbr))
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
            opp = _canon_abbr(league, g["opp"])
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
                vs=vs,
                detail=detail,
                oppRecord=g.get("oppRec"),
            )
            return data

    cached = _team_cache.get(code)
    if cached and _time.time() - cached["ts"] < _TEAM_TTL:
        return cached["data"]

    try:
        r = requests.get(
            f"{_ESPN_BASE}/{sport}/{lg}/teams/{abbr.lower()}",
            headers=_ESPN_HEADERS,
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
                    opp = _canon_abbr(
                        league,
                        (c.get("team") or {}).get("abbreviation")
                        or (c.get("team") or {}).get("shortDisplayName"),
                    )
                    opp_score = sc
            data["opponent"] = opp
            data["vs"] = vs
            data["detail"] = short
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
                cdet = _live_detail(sport, comp.get("status") or {})
                data.update(highlight="live", cdet=cdet,
                            label=_live_label(vs, opp, score_str, cdet),
                            labelLong=f"{matchup} {bits}".strip())
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
        # ESPN hiccup: serve the last good answer (if any) rather than a blank
        # label, which the panel would show as an empty line.
        if cached and cached.get("data", {}).get("label"):
            return cached["data"]
    return data


# ---------------------------------------------------------------------------
# Postseason context (MLB/NBA/NHL/NFL playoffs). ESPN marks playoff games with
# a note headline like "ALDS - Game 2"; the team's postseason schedule lists
# every game of the round, so the series score is counted from its finals.
# ---------------------------------------------------------------------------
_ps_cache: dict = {}
_PS_TTL = 600
_ROUND_ABBR = {
    "world series": "WS", "stanley cup final": "SCF", "nba finals": "FINALS",
    "super bowl": "SB", "wild card": "WC", "divisional round": "DIV",
    "conference championship": "CONF", "afc championship": "AFC",
    "nfc championship": "NFC", "first round": "R1", "second round": "R2",
}


def _round_abbr(name: str) -> str:
    n = " ".join((name or "").split())
    if not n:
        return ""
    if len(n) <= 5 and " " not in n:
        return n.upper()
    low = n.lower()
    for k, v in _ROUND_ABBR.items():
        if low == k or low.endswith(" " + k):
            pre = n[: len(n) - len(k)].strip()
            # "East First Round" -> "E R1", "Western Conference Final" -> generic below
            if pre and pre.isupper() and len(pre) <= 3:   # "AFC Wild Card" -> "AFC WC"
                return f"{pre} {v}"
            return (pre[:1].upper() + " " + v).strip() if pre and len(v) <= 3 else v
    words = [w for w in n.replace("-", " ").split() if w[:1].isalpha()]
    return "".join(w[0] for w in words).upper()[:5]


def _ps_schedule(sport: str, lg: str, abbr: str) -> list:
    import time as _time

    key = f"{sport}/{lg}/{abbr.lower()}"
    hit = _ps_cache.get(key)
    if hit and _time.time() - hit["ts"] < _PS_TTL:
        return hit["ev"]
    ev: list = []
    try:
        r = requests.get(
            f"{_ESPN_BASE}/{sport}/{lg}/teams/{abbr.lower()}/schedule",
            params={"seasontype": 3},
            headers=_ESPN_HEADERS,
            timeout=6,
        )
        r.raise_for_status()
        ev = r.json().get("events") or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("espn postseason schedule failed %s: %s", key, exc)
        if hit:
            return hit["ev"]
    _ps_cache[key] = {"ts": _time.time(), "ev": ev}
    return ev


def _postseason_info(code: str, s: dict):
    """{"round","game","ps","w","l","series"} when the team's current/next game
    is a postseason game, else None."""
    import re as _re

    if ":" not in code or not s.get("date"):
        return None
    league, abbr = code.split(":", 1)
    if league not in _LEAGUE_PATH:
        return None
    sport, lg = _LEAGUE_PATH[league]
    events = _ps_schedule(sport, lg, abbr)
    if not events:
        return None

    def head(e):
        comp = (e.get("competitions") or [{}])[0]
        for n in comp.get("notes") or []:
            if n.get("headline"):
                return n["headline"]
        return ""

    def parts(h):
        m = _re.match(r"^(.*?)\s*-\s*Game\s+(\d+)", h or "", _re.I)
        if m:
            return m.group(1).strip(), int(m.group(2))
        return (h or "").strip(), None

    cur = next((e for e in events if e.get("date") == s["date"]), None)
    if cur is None:
        return None
    rnd_name, game = parts(head(cur))
    rnd = _round_abbr(rnd_name)
    me = abbr.upper()
    w = l = 0
    games_in_round = 0
    for e in events:
        rn, _g = parts(head(e))
        if rn != rnd_name:
            continue
        games_in_round += 1
        comp = (e.get("competitions") or [{}])[0]
        if ((comp.get("status") or {}).get("type") or {}).get("state") != "post":
            continue
        mine = other = None
        for c in comp.get("competitors") or []:
            sc = c.get("score")
            if isinstance(sc, dict):
                sc = sc.get("value", sc.get("displayValue"))
            try:
                sc = float(sc)
            except (TypeError, ValueError):
                sc = None
            if ((c.get("team") or {}).get("abbreviation") or "").upper() == me:
                mine = sc
            else:
                other = sc
        if mine is None or other is None:
            continue
        if mine > other:
            w += 1
        elif mine < other:
            l += 1
    opp = (s.get("opponent") or "").upper()
    series = ""
    if games_in_round > 1:
        need = games_in_round // 2 + 1
        if w >= need:
            series = f"{me} wins {w}-{l}"
        elif l >= need:
            series = f"{opp} wins {l}-{w}" if opp else f"Lost {w}-{l}"
        elif w == l:
            series = f"Tied {w}-{l}" if w else ""
        elif w > l:
            series = f"{me} leads {w}-{l}"
        else:
            series = f"{opp} leads {l}-{w}" if opp else f"Trail {w}-{l}"
    ps = f"{rnd} G{game}" if rnd and game else rnd
    return {"round": rnd, "game": game, "ps": ps, "w": w, "l": l,
            "series": series, "multi": games_in_round > 1}


def _apply_postseason(code: str, s: dict) -> dict:
    """Postseason: series W-L in the record slots, round + game in the labels
    ("G2 Mon 8p @ TB", "ALDS G2 TOMORROW"). Returns a new dict."""
    s = dict(s)
    try:
        ps = _postseason_info(code, s)
    except Exception as exc:  # noqa: BLE001
        logger.warning("postseason info failed %s: %s", code, exc)
        ps = None
    if not ps:
        return s
    s["postseason"] = True
    s["round"] = ps["round"]
    s["game"] = ps["game"]
    s["seriesText"] = ps["series"]
    s["seasonRecord"] = s.get("record")
    if ps["multi"]:
        s["record"] = f"{ps['w']}-{ps['l']}"
        s["oppRecord"] = f"{ps['l']}-{ps['w']}"
        s["seriesRecord"] = s["record"]
    s["ps"] = ps["ps"]
    lab = s.get("label") or ""
    if lab and s.get("highlight") in ("today", "soon", "upcoming") and ps["game"]:
        for c in (f"{ps['ps']} {lab}", f"G{ps['game']} {lab}"):
            if len(c) <= 16:
                s["label"] = c
                break
    return s


@api_router.get("/teams/status")
def teams_status(teams: str):
    """Next/live game highlight for a pipe-separated list of LEAGUE:ABBR codes."""
    results = []
    for raw in teams.split("|"):
        code = raw.strip().upper()
        if code:
            st = _apply_postseason(code, _team_status_one(code))
            st.update(_game_fields(code, st))
            results.append(st)
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
            "daily": "temperature_2m_max,temperature_2m_min,weather_code",
            "temperature_unit": "fahrenheit",
            "timezone": "auto",
            "forecast_days": 4,
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
        "fc": _forecast_days(daily),
    }


def _wx_icon(code) -> str:
    """WMO weather code -> one of the panel's six flat icons."""
    if code is None:
        return "cloud"
    c = int(code)
    if c in (0, 1):
        return "sun"
    if c == 2:
        return "partly"
    if c in (3, 45, 48):
        return "cloud"
    if c in (71, 73, 75, 77, 85, 86):
        return "snow"
    if c >= 95:
        return "storm"
    if 51 <= c <= 67 or 80 <= c <= 82:
        return "rain"
    return "cloud"


def _forecast_days(daily: dict, n: int = 3) -> list:
    """Next `n` days AFTER today (today's hi/lo is already on the weather
    page): [{"d": "Mon", "i": "sun", "h": 81, "l": 57}, ...]."""
    from datetime import date as _date

    out = []
    days = daily.get("time") or []
    for k in range(1, min(len(days), n + 1)):
        try:
            hi = daily["temperature_2m_max"][k]
            lo = daily["temperature_2m_min"][k]
            out.append({
                "d": _date.fromisoformat(days[k]).strftime("%a"),
                "i": _wx_icon((daily.get("weather_code") or [None] * (k + 1))[k]),
                "h": round(hi) if hi is not None else None,
                "l": round(lo) if lo is not None else None,
            })
        except Exception:  # noqa: BLE001
            continue
    return out


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
    return {"temp": None, "code": None, "text": None, "hi": None, "lo": None, "fc": []}


# ---------------------------------------------------------------------------
# Compact device endpoint — the ESP32 panel calls this so it can render live
# scores (and detect a score to flash) without the phone. Small field names
# keep the JSON tiny for on-device parsing.
# ---------------------------------------------------------------------------
def _compact_team_label(s: dict, limit: int = 16) -> str:
    """A short (<= `limit` chars, ASCII) status line for the panel's team rows,
    which sit beside a 24px logo and only have ~16 characters of width.
    Examples: "3-2 Top 5th", "W 5-3 vs BOS", "7:05p vs BOS", "Sat 7:05p @ BOS",
    "Oct 19 vs BOS", "Offseason"."""
    from datetime import datetime as _dt

    hl = s.get("highlight")
    opp = s.get("opponent") or ""
    vs = s.get("vs") or "vs"
    mt = f"{vs} {opp}" if opp else ""
    my, op = s.get("score"), s.get("oppScore")
    date = s.get("date")

    def fit(*cands):
        for c in cands:
            c = " ".join((c or "").split())
            if c and len(c) <= limit:
                return c
        c = " ".join((cands[-1] or "").split())
        return c[:limit].rstrip()

    if hl == "live":
        sc = f"{my}-{op}" if my is not None and op is not None else ""
        if s.get("cdet") is not None:
            return _live_label(vs, opp, sc, s.get("cdet") or "", limit)
        det = (s.get("detail") or "").replace(" - ", " ")
        return fit(f"{sc} {det}", f"{sc} {mt}", sc or "LIVE")
    if hl == "recent":
        sc = f"{my}-{op}" if my is not None and op is not None else ""
        wl = ""
        if my is not None and op is not None:
            wl = "W" if my > op else ("L" if my < op else "T")
        return fit(f"{wl} {sc} {mt}", f"{wl} {sc}", "Final")
    if hl in ("today", "soon", "upcoming") and date:
        t = _iso_to_eastern_time(date) or ""
        local = _iso_to_eastern_date(date)
        try:
            d = _dt.strptime(local, "%Y-%m-%d")
        except Exception:  # noqa: BLE001
            d = None
        g = s.get("game") if s.get("ps") else None
        gp = f"G{g} " if g else ""
        if hl == "today":
            return fit(f"{gp}{t} {mt}", f"{t} {mt}", f"Today {mt}", mt)
        dow = d.strftime("%a") if d else ""
        md = d.strftime("%b %-d") if d else ""
        if hl == "soon":
            return fit(f"{gp}{dow} {t} {mt}", f"{dow} {t} {mt}", f"{dow} {mt}", f"{dow} {t}")
        return fit(f"{gp}{md} {t} {mt}", f"{md} {t} {mt}", f"{md} {mt}", md)
    if hl == "offseason":
        return "Offseason"
    return "No game sched"


def _game_fields(code: str, s: dict) -> dict:
    """Extra fields for the one-team-per-page game card (firmware 1.1.2+):
    home/away, opponent record, a readable status line, and the next game's
    day + time (ET). Opponent record comes from the scoreboard when the game is
    live/final, otherwise from the opponent's team endpoint (cached 1h)."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    hl = s.get("highlight")
    opp = s.get("opponent")
    league = code.split(":", 1)[0] if ":" in code else ""
    out = {"home": None, "oppRecord": s.get("oppRecord"), "statusText": "",
           "nextDay": "", "nextTime": ""}
    if s.get("vs"):
        out["home"] = s["vs"] == "vs"
    if opp and not out["oppRecord"] and league in _LEAGUE_PATH:
        sp, lg = _LEAGUE_PATH[league]
        out["oppRecord"] = _team_record(f"{league}:{opp.upper()}", sp, lg, opp)
    det = " ".join((s.get("detail") or "").replace(" - ", " ").split())
    if hl == "live":
        import re as _re
        m = _re.match(r"^(\d+:\d+(?:\.\d)?) (.+)$", det)   # "18:38 2nd" -> "2nd 18:38"
        if m:
            det = f"{m.group(2)} {m.group(1)}"
        out["statusText"] = det[:21] or "LIVE"
    elif hl == "recent":
        low = det.lower()
        out["statusText"] = ("FINAL/" + det.split("/", 1)[1].upper()) if "/" in det and "final" in low else "FINAL"
    date = s.get("date")
    if hl in ("today", "soon", "upcoming") and date:
        try:
            et = _dt.fromisoformat(date.replace("Z", "+00:00")).astimezone(ZoneInfo("America/New_York"))
            days = _days_from_today(et.strftime("%Y-%m-%d"))
            out["nextDay"] = "TODAY" if days == 0 else ("TOMORROW" if days == 1 else et.strftime("%a %b %-d").upper())
            if not (et.hour == 0 and et.minute == 0):   # ESPN's "time TBD" placeholder
                out["nextTime"] = f"{et.hour % 12 or 12}:{et.minute:02d} {'AM' if et.hour < 12 else 'PM'}"
            else:
                out["nextTime"] = "TBD"
        except Exception:  # noqa: BLE001
            pass
    ps = s.get("ps")
    if ps:
        # Postseason: round + game on the card ("ALDS G2 Bot 8th",
        # "ALDS G2 TOMORROW", "FINAL TB leads 1-0"); the firmware's lines fit
        # ~20 chars, so fall back to the plain text when it would overflow.
        def pre(a, b):
            c = f"{a} {b}".strip()
            return c if len(c) <= 20 else b
        if hl == "live":
            out["statusText"] = pre(ps, out["statusText"])
        elif hl == "recent":
            ser = (s.get("seriesText") or "").upper()
            out["statusText"] = pre(out["statusText"], ser) if ser else pre(ps, out["statusText"])
            if ser and len(f"{out['statusText']}") > 20:
                out["statusText"] = ser
        elif out["nextDay"]:
            out["nextDay"] = pre(ps, out["nextDay"])
    return out


_WIN_ALIAS = {"NHL:CAR": "CANES", "NHL:NJ": "DEVILS", "NHL:NJD": "DEVILS", "MLB:NYY": "YANKEES"}


def _win_name(code: str, s: dict) -> str:
    """Short team name for the on-panel 'X WIN!' flash (<=10 chars, ASCII)."""
    if code in _WIN_ALIAS:
        return _WIN_ALIAS[code]
    nm = (s.get("name") or "").encode("ascii", "ignore").decode().strip()
    words = nm.split()
    if words:
        last = words[-1].upper()
        if last == "SOX" and len(words) >= 2:
            last = f"{words[-2].upper()} SOX"
        if 0 < len(last) <= 10:
            return last
    return code.split(":")[-1].upper()


@api_router.get("/device/scores")
def device_scores(teams: str):
    def _ascii(s):
        return (s or "").replace("🔴", "LIVE ").encode("ascii", "ignore").decode().strip()

    out = []
    for raw in teams.split("|"):
        code = raw.strip().upper()
        if not code:
            continue
        s = _apply_postseason(code, _team_status_one(code))
        out.append(
            {
                "c": code,
                "s": s.get("score"),
                "o": s.get("oppScore"),
                "h": s.get("highlight"),
                "l": _ascii(s.get("label")) or _ascii(_compact_team_label(s)),
                "r": s.get("record"),
                # Compact (<=16 char) line for the logo layout (firmware 1.1+).
                "k": _ascii(_compact_team_label(s)),
            }
        )
        # One-team-per-page card fields (firmware 1.1.2+; older firmware's
        # filter / parser ignores them).
        gf = _game_fields(code, s)
        out[-1].update({
            "op": s.get("opponent") or "",
            "ha": "" if gf["home"] is None else ("h" if gf["home"] else "a"),
            "or": gf["oppRecord"] or "",
            "st": _ascii(gf["statusText"]),
            "nd": gf["nextDay"],
            "nt": gf["nextTime"],
            "wn": _win_name(code, s),
        })
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


# Regional carriers fly under a mainline brand; show that brand's logo on the
# panel (e.g. PSA / Piedmont / Envoy -> American). Keys are ICAO prefixes.
_BRAND_LOGO = {
    # PSA (JIA), Piedmont (PDT) and Envoy (ENY) now have their own logos
    # on the panel, so only regionals without one fall back to the mainline.
    "ASH": "AAL",
    "EDV": "DAL", "CPZ": "DAL", "GJS": "UAL", "UCA": "UAL", "AWI": "UAL",
    "QXE": "ASA",
    "JZA": "ACA", "ROU": "ACA",  # Air Canada Jazz / Rouge
    "NJE": "EJA", "XOJ": "VJT",  # NetJets Europe, XOJET (VistaJet US)
}

# ---------------------------------------------------------------------------
# Republic (RPA) flies as United Express, Delta Connection and American Eagle.
# Neither the ADS-B feed nor adsbdb names the marketing carrier (adsbdb gives
# Republic's own RW#### number), so it is GUESSED from the route: each airport
# lists the mainline carriers that run a hub/focus city there; the guess is the
# carrier common to every end of the route that is a hub for anyone. Shared
# hubs and conflicting ends (e.g. IAH-PHL = UA vs AA) give no guess, and the
# panel keeps the Republic logo/name. Keys of _RPA_PARTNER are the logo keys.
# ---------------------------------------------------------------------------
_RPA_PARTNER = {
    "UAL": "United Express",
    "DAL": "Delta Connect",   # 13 chars: the panel's name column fits ~15
    "AAL": "American Eagle",
}
_HUB_CARRIERS = {
    # United
    "EWR": {"UAL"}, "IAD": {"UAL"}, "DEN": {"UAL"}, "IAH": {"UAL"},
    "SFO": {"UAL"}, "CLE": {"UAL"},
    # Delta
    "ATL": {"DAL"}, "DTW": {"DAL"}, "MSP": {"DAL"}, "LGA": {"DAL"},
    "BOS": {"DAL"}, "SLC": {"DAL"}, "SEA": {"DAL"},
    # American (DCA: American's hub; Delta also flies there, see tests/notes)
    "CLT": {"AAL"}, "PHL": {"AAL"}, "DFW": {"AAL"}, "MIA": {"AAL"},
    "DCA": {"AAL"}, "PHX": {"AAL"},
    # Shared: no single owner, so these never decide a guess by themselves
    "ORD": {"UAL", "AAL"}, "JFK": {"DAL", "AAL"},
    "LAX": {"UAL", "DAL", "AAL"},
}


def _rpa_partner(frm, to):
    """(logo_key, display_name) for a Republic flight, or None if unsure."""
    cands = None
    for ap in (frm, to):
        hub = _HUB_CARRIERS.get((ap or "").upper())
        if hub:
            cands = set(hub) if cands is None else cands & hub
    if cands and len(cands) == 1:
        k = next(iter(cands))
        return k, _RPA_PARTNER[k]
    return None


# ---------------------------------------------------------------------------
# FlightAware AeroAPI (env FLIGHTAWARE_API_KEY, Personal tier).
# Pricing: GET /flights/{ident} = $0.005 per result set (15 records); we always
# send max_pages=1, so every call costs exactly $0.005. Personal tier: $5/month
# free, 10 result sets/minute. A local limiter keeps us at <= 8 calls/min so
# the panel never trips FlightAware's 429, plus a 300/day cap per instance;
# anything over budget falls back to the free sources. Used ONLY for the
# pinned flight (/device/flight); overhead planes stay on free adsbdb.
# ---------------------------------------------------------------------------
AEROAPI_BASE = "https://aeroapi.flightaware.com/aeroapi"
_AERO_PER_MIN = 8
_aero_calls: list = []          # timestamps of recent calls (rate limiter)
_aero_cache: dict = {}          # ident -> {ts, ttl, data}
_aero_lock = __import__("threading").Lock()


_AERO_PER_DAY = 300            # daily safety cap per instance (~$1.50)
_aero_day = {"d": None, "n": 0}


def _aero_budget_ok() -> bool:
    import time as _time
    from datetime import datetime
    from zoneinfo import ZoneInfo
    now = _time.time()
    today = datetime.now(ZoneInfo("America/New_York")).date()
    with _aero_lock:
        if _aero_day["d"] != today:
            _aero_day["d"], _aero_day["n"] = today, 0
        if _aero_day["n"] >= _AERO_PER_DAY:
            return False
        while _aero_calls and now - _aero_calls[0] > 60:
            _aero_calls.pop(0)
        if len(_aero_calls) >= _AERO_PER_MIN:
            return False
        _aero_calls.append(now)
        _aero_day["n"] += 1
        return True


def _aero_ts(v):
    from datetime import datetime
    if not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except Exception:  # noqa: BLE001
        return None


def _et_clock(ts):
    if ts is None:
        return None
    from datetime import datetime
    from zoneinfo import ZoneInfo
    t = datetime.fromtimestamp(ts, ZoneInfo("America/New_York"))
    return f"{t.hour % 12 or 12}:{t.minute:02d}"


def _aero_flights(ident: str):
    """Raw AeroAPI flights list for an ident (ICAO or IATA). Returns
    list (possibly empty = unknown ident) or None on error/no key/over budget.
    Cached: hits until the chosen leg should have landed (2-12h), misses 6h,
    errors 5 min."""
    import os
    import time as _time
    key = os.environ.get("FLIGHTAWARE_API_KEY")
    if not key:
        return None
    hit = _aero_cache.get(ident)
    if hit and _time.time() - hit["ts"] < hit["ttl"]:
        return hit["data"]
    if not _aero_budget_ok():
        return hit["data"] if hit else None  # stale beats nothing
    data, ttl = None, 300
    try:
        r = requests.get(f"{AEROAPI_BASE}/flights/{ident}", params={"max_pages": 1},
                         headers={"x-apikey": key}, timeout=4)
        if r.status_code == 200:
            data = r.json().get("flights") or []
            ttl = 6 * 3600 if not data else _aero_ttl(data)
        elif r.status_code in (400, 404):
            data, ttl = [], 6 * 3600
        else:
            logger.info("aeroapi %s -> HTTP %s", ident, r.status_code)
    except Exception as exc:  # noqa: BLE001
        logger.info("aeroapi %s failed: %s", ident, exc)
    if data is None and hit:
        return hit["data"]
    ent = {"ts": _time.time(), "ttl": ttl, "data": data}
    _aero_cache[ident] = ent
    for f in (data or [])[:1]:  # share between AA3293 / AAL3293
        for alt in (f.get("ident_icao"), f.get("ident_iata")):
            if alt and alt != ident:
                _aero_cache[alt] = ent
    return data


def _aero_ttl(flights) -> int:
    """Keep a callsign's answer until its current leg should be on the ground
    (+20 min), clamped to 2..12h. Overhead planes are almost always mid-leg."""
    import time as _time
    leg = _aero_pick_leg(flights)
    end = None
    if leg:
        end = _aero_ts(leg.get("estimated_on") or leg.get("scheduled_on")
                       or leg.get("estimated_in") or leg.get("scheduled_in"))
    if end is None:
        return 6 * 3600
    return int(max(2 * 3600, min(12 * 3600, end - _time.time() + 1200)))


def _aero_pick_leg(flights):
    """The leg that matters now: airborne > next departure (within 18h) >
    most recently landed (within 3h)."""
    import time as _time
    now = _time.time()
    live = [f for f in flights if f.get("actual_off") and not f.get("actual_on")
            and not f.get("cancelled")]
    if live:
        return max(live, key=lambda f: _aero_ts(f["actual_off"]) or 0)
    nxt = [f for f in flights if not f.get("actual_off") and not f.get("cancelled")
           and (_aero_ts(f.get("estimated_out") or f.get("scheduled_out")) or 0) > now - 3 * 3600
           and (_aero_ts(f.get("scheduled_out")) or 0) < now + 18 * 3600]
    if nxt:
        return min(nxt, key=lambda f: _aero_ts(f.get("estimated_out") or f.get("scheduled_out")) or 0)
    done = [f for f in flights if f.get("actual_on")
            and now - (_aero_ts(f["actual_on"]) or 0) < 3 * 3600]
    if done:
        return max(done, key=lambda f: _aero_ts(f["actual_on"]) or 0)
    canc = [f for f in flights if f.get("cancelled")
            and abs((_aero_ts(f.get("scheduled_out")) or 0) - now) < 12 * 3600]
    return canc[0] if canc else None


def _ap(a):
    a = a or {}
    return a.get("code_iata") or a.get("code_lid") or a.get("code_icao") or a.get("code")


_route_cache: dict = {}
_ROUTE_TTL = 6 * 3600


def _route_for(callsign: str) -> dict:
    """Origin/destination + IATA flight number for a callsign via the free,
    keyless adsbdb.com API (no AeroAPI: overhead planes stay free). Cached (hits and misses) for 6h; short timeout so a
    slow lookup can never hold up the panel's 12s request budget."""
    import time as _time

    cs = (callsign or "").strip().upper()
    if not cs:
        return {}
    hit = _route_cache.get(cs)
    if hit and _time.time() - hit["ts"] < hit.get("ttl", _ROUTE_TTL):
        return hit["data"]
    out: dict = {}
    ttl = 600  # transient failure (timeout / 5xx / 429): retry in 10 min
    try:
        r = requests.get(
            f"https://api.adsbdb.com/v0/callsign/{cs}",
            timeout=3,
            headers={"User-Agent": "InfoWall/1.0"},
        )
        if r.status_code in (200, 404):
            ttl = _ROUTE_TTL  # a real answer (route or "unknown callsign")
        if r.status_code == 200:
            fr = ((r.json() or {}).get("response") or {}).get("flightroute") or {}
            if isinstance(fr, dict):
                out = {
                    "fn": fr.get("callsign_iata"),
                    "fr": (fr.get("origin") or {}).get("iata_code"),
                    "to": (fr.get("destination") or {}).get("iata_code"),
                    "frc": (fr.get("origin") or {}).get("municipality"),
                    "toc": (fr.get("destination") or {}).get("municipality"),
                    "_ll": ((fr.get("origin") or {}).get("latitude"),
                            (fr.get("origin") or {}).get("longitude"),
                            (fr.get("destination") or {}).get("latitude"),
                            (fr.get("destination") or {}).get("longitude")),
                }
    except Exception as exc:  # noqa: BLE001
        logger.info("adsbdb route lookup failed %s: %s", cs, exc)
    _route_cache[cs] = {"ts": _time.time(), "data": out, "ttl": ttl}
    return out


def _route_fits(rt: dict, f: dict) -> bool:
    """Free position-fit check for an overhead plane's adsbdb route (same idea
    as the pinned fallback's _plausible_leg). Low (<10k ft or on the ground)
    must be within 40 mi of either airport. Otherwise the position must be
    near the great-circle path (detour <= 15%) and, when > 40 mi from the
    destination, the track within 50 deg of the bearing to it."""
    ll = rt.get("_ll") or (None,) * 4
    lat, lon = f.get("lat"), f.get("lon")
    if None in ll or lat is None or lon is None or not (rt.get("fr") and rt.get("to")):
        return False
    flat, flon, tlat, tlon = ll
    alt = f.get("altitude")
    if alt is None or alt < 10000:  # low: must be near one end, path alone isn't enough
        return min(_gc_mi(lat, lon, flat, flon), _gc_mi(lat, lon, tlat, tlon)) <= 40
    fr, to, _, _ = _plausible_leg([(rt["fr"], flat, flon, rt["to"], tlat, tlon)],
                                  lat, lon, f.get("track"))
    return bool(fr)


@api_router.get("/device/planes")
def device_planes(lat: float, lon: float, radius: float = 25):
    """Compact nearby-aircraft list for the panel.

    Original fields (kept for older firmware): f callsign, al airline name,
    ia ICAO airline prefix, d distance (mi).
    Added for the logo flight card: alt (ft), spd (mph), typ (aircraft type),
    trk (track deg), lg (logo key, brand for regionals) and, for airline
    flights, fn (IATA flight no.), fr/to (origin/dest IATA)."""
    import re as _re

    def _iata(callsign):
        # ICAO airline callsigns are 3 letters + a flight number (DAL123, UAL45).
        m = _re.match(r"^([A-Z]{3})\d", (callsign or "").strip().upper())
        return m.group(1) if m else None

    def _num(v, scale=1.0):
        return round(v * scale) if isinstance(v, (int, float)) else None

    data = flights_nearby(lat, lon, radius)  # reuse + cache
    flights = data.get("flights", [])[:6]
    # Route lookups for every airline flight, in parallel (each is cached 6h
    # and capped at 3s), so the panel can show a route on any plane's card,
    # not just the nearest one.
    from concurrent.futures import ThreadPoolExecutor

    want = [f["callsign"] for f in flights if _iata(f["callsign"])]
    routes: dict = {}
    if want:
        with ThreadPoolExecutor(max_workers=min(6, len(want))) as ex:
            for cs, rt in zip(want, ex.map(_route_for, want)):
                routes[cs] = rt
    out = []
    for f in flights:
        ia = _iata(f["callsign"])
        row = {
            "f": f["callsign"],
            "al": f.get("airline"),
            "ia": ia,
            "d": round(f["distance"] * 1.15078, 1) if f.get("distance") is not None else None,
            "alt": _num(f.get("altitude")),
            "spd": _num(f.get("speed"), 1.15078),
            "typ": f.get("type"),
            "trk": _num(f.get("track")),
            "lg": _BRAND_LOGO.get(ia, ia) if ia else None,
        }
        if ia:
            rt = routes.get(f["callsign"]) or {}
            if rt and not _route_fits(rt, f):
                rt = {"fn": rt.get("fn")}  # stale adsbdb route: keep fn only
            for k in ("fn", "fr", "to"):
                if rt.get(k):
                    row[k] = rt[k]
            if ia == "RPA":
                pm = _rpa_partner(rt.get("fr"), rt.get("to"))
                if pm:
                    row["lg"], row["al"] = pm
        out.append(row)
    return {"p": out}


# ---------------------------------------------------------------------------
# Markets page: S&P 500 / Dow / Nasdaq with % change, open/closed status and a
# tiny intraday sparkline, from Yahoo's keyless chart API (60s cache).
# ---------------------------------------------------------------------------
_MARKETS = [("^GSPC", "S&P 500"), ("^DJI", "Dow"), ("^IXIC", "Nasdaq")]
# Pre-market (4:00-9:30 ET weekdays) the cash indexes still show the prior
# close, so show the index futures instead (vs. their prior settle).
_FUTURES = [("ES=F", "S&P fut"), ("YM=F", "Dow fut"), ("NQ=F", "Nsdq fut")]


def _is_premarket(et) -> bool:
    return et.weekday() < 5 and (4 <= et.hour < 9 or (et.hour == 9 and et.minute < 30))
_markets_cache: dict = {}
_SPARK_W = 34   # sparkline columns on the panel
_SPARK_H = 14   # sparkline height in pixels (values 0..H-1, 0 = bottom)


def _market_one(sym: str, name: str) -> dict:
    r = requests.get(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}",
        params={"range": "1d", "interval": "5m"},
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=6,
    )
    r.raise_for_status()
    res = r.json()["chart"]["result"][0]
    meta = res.get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    pct = round((price - prev) / prev * 100, 2) if price is not None and prev else None
    reg = (meta.get("currentTradingPeriod") or {}).get("regular") or {}
    start, end = reg.get("start"), reg.get("end")
    ts = res.get("timestamp") or []
    closes = ((res.get("indicators") or {}).get("quote") or [{}])[0].get("close") or []
    # Bucket the session (start..end) into _SPARK_W columns; columns after
    # "now" stay empty so the line fills in left-to-right through the day.
    cols: list = [None] * _SPARK_W
    if start and end and end > start:
        for t, c in zip(ts, closes):
            if c is None or t < start or t > end:
                continue
            i = min(_SPARK_W - 1, int((t - start) / (end - start) * _SPARK_W))
            cols[i] = c
    vals = [c for c in cols if c is not None]
    spark, base = [], None
    if vals:
        lo = min(vals + ([prev] if prev else []))
        hi = max(vals + ([prev] if prev else []))
        span = (hi - lo) or 1.0

        def _y(v):
            return int(round((v - lo) / span * (_SPARK_H - 1)))

        spark = [(_y(c) if c is not None else -1) for c in cols]
        while spark and spark[-1] == -1:
            spark.pop()
        base = _y(prev) if prev else None
    return {"n": name, "v": round(price, 2) if price is not None else None,
            "c": pct, "sp": spark, "b": base, "_reg": (start, end)}


def _markets_weekend_closed(now=None) -> bool:
    """True on Saturday/Sunday in US Eastern (no trading at all)."""
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    et = now.astimezone(ZoneInfo("America/New_York")) if now else _dt.now(ZoneInfo("America/New_York"))
    return et.weekday() >= 5


@api_router.get("/device/markets")
def device_markets():
    """Compact payload for the panel's optional Markets page.
    {"st": "Open"|"Pre-mkt"|"After hrs"|"Closed",
     "m": [{"n": "S&P 500", "v": 7720.12, "c": 0.7, "sp": [0..13 | -1], "b": 6}]}"""
    import time as _time
    from concurrent.futures import ThreadPoolExecutor

    now = _time.time()
    if _markets_weekend_closed():
        # US markets are shut all day Sat/Sun (Eastern). An empty list makes
        # the panel (any firmware) drop the Markets page from the rotation.
        return {"st": "Closed", "m": []}
    cached = _markets_cache.get("d")
    if cached and now - cached["ts"] < 60:
        return cached["data"]
    from datetime import datetime as _dt
    from zoneinfo import ZoneInfo

    et = _dt.now(ZoneInfo("America/New_York"))
    pre = _is_premarket(et)
    syms = _FUTURES if pre else _MARKETS
    out, reg = [], (None, None)
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = [ex.submit(_market_one, s, n) for s, n in syms]
        for (sym, name), f in zip(syms, futs):
            try:
                m = f.result()
                reg = m.pop("_reg") or reg
                out.append(m)
            except Exception as exc:  # noqa: BLE001
                logger.warning("markets %s failed: %s", sym, exc)
    start, end = reg
    if pre:
        st = "Pre-mkt"
    elif start and end and start <= now < end:
        st = "Open"
    elif et.weekday() < 5 and 16 <= et.hour < 20:
        st = "After hrs"
    else:
        st = "Closed"
    data = {"st": st, "m": out}
    if out:
        _markets_cache["d"] = {"ts": now, "data": data}
    elif cached:
        return cached["data"]
    return data


# ---------------------------------------------------------------------------
# Pinned flight verification (/device/flight)
# Keyless sources:
#   - adsbdb.com: is the flight number real? airline name, IATA<->ICAO.
#     Its stored route is ONE route per flight number and is often wrong for
#     the day, so it is only a *candidate* leg.
#   - vrs-standing-data.adsb.lol: multi-leg route list for the callsign (more
#     candidate legs, with airport coordinates).
#   - api.adsb.lol/v2/callsign: live ADS-B position.
# A route is shown only when the plane is airborne AND its position + track fit
# a candidate leg (near the great-circle path, heading toward the destination).
# (adsb.lol /api/0/routeset was tested 2026-10-19: returns 201 with an empty
# body, so it is not used.)
# Hook: FlightAware AeroAPI (env FLIGHTAWARE_API_KEY) could later supply the
# day's real origin/dest, scheduled/estimated times and delays. Not used yet
# (the account currently returns 500 on every call); see _flight_aeroapi().
# ---------------------------------------------------------------------------
_flight_live_cache: dict = {}
_flight_meta_cache: dict = {}
_FLIGHT_LIVE_TTL = 60
_FLIGHT_META_TTL = 6 * 3600
_LKN = (35.55, -80.95)  # Lake Norman


def _gc_mi(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dp, dl = p2 - p1, math.radians(b_lon - a_lon)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3958.8 * 2 * math.asin(min(1.0, math.sqrt(h)))


def _bearing(a_lat, a_lon, b_lat, b_lon):
    import math
    p1, p2 = math.radians(a_lat), math.radians(b_lat)
    dl = math.radians(b_lon - a_lon)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _flight_meta(ident: str) -> dict:
    """{ok, fn, cs, al, legs:[(fr,frlat,frlon,to,tolat,tolon)]} cached 6h."""
    import time as _time
    hit = _flight_meta_cache.get(ident)
    if hit and _time.time() - hit["ts"] < hit["ttl"]:
        return hit["data"]
    out: dict = {"ok": None}
    ttl = 300
    try:
        r = requests.get(f"https://api.adsbdb.com/v0/callsign/{ident}", timeout=3,
                         headers={"User-Agent": "InfoWall/1.0"})
        if r.status_code == 404 or (r.status_code == 200 and not isinstance(
                ((r.json() or {}).get("response") or {}).get("flightroute"), dict)):
            out, ttl = {"ok": False}, _FLIGHT_META_TTL
        elif r.status_code == 200:
            fr = r.json()["response"]["flightroute"]
            al = fr.get("airline") or {}
            o, d = fr.get("origin") or {}, fr.get("destination") or {}
            out = {"ok": True, "fn": fr.get("callsign_iata") or ident,
                   "cs": fr.get("callsign_icao") or ident,
                   "al": al.get("name"), "ia": al.get("icao"), "legs": []}
            if o.get("latitude") is not None and d.get("latitude") is not None:
                out["legs"].append((o.get("iata_code"), o["latitude"], o["longitude"],
                                    d.get("iata_code"), d["latitude"], d["longitude"]))
            ttl = _FLIGHT_META_TTL
    except Exception as exc:  # noqa: BLE001
        logger.info("adsbdb flight lookup failed %s: %s", ident, exc)
    if out.get("ok"):
        try:
            cs = out["cs"]
            r = requests.get(f"https://vrs-standing-data.adsb.lol/routes/{cs[:2]}/{cs}.json",
                             timeout=3, headers={"User-Agent": "InfoWall/1.0"})
            if r.status_code == 200:
                aps = [a for a in (r.json().get("_airports") or []) if a.get("lat") is not None]
                for a, b in zip(aps, aps[1:]):
                    leg = (a.get("iata"), a["lat"], a["lon"], b.get("iata"), b["lat"], b["lon"])
                    if leg not in out["legs"]:
                        out["legs"].append(leg)
        except Exception as exc:  # noqa: BLE001
            logger.info("vrs route lookup failed %s: %s", out.get("cs"), exc)
    _flight_meta_cache[ident] = {"ts": _time.time(), "data": out, "ttl": ttl}
    return out


def _flight_live(cs: str):
    """Best live ADS-B hit for an ICAO callsign (cached 60s). None = lookup error."""
    import time as _time
    hit = _flight_live_cache.get(cs)
    if hit and _time.time() - hit["ts"] < _FLIGHT_LIVE_TTL:
        return hit["data"]
    try:
        r = requests.get(f"https://api.adsb.lol/v2/callsign/{cs}", timeout=4,
                         headers={"User-Agent": "InfoWall/1.0"})
        r.raise_for_status()
        acs = [a for a in (r.json().get("ac") or []) if a.get("lat") is not None]
        acs.sort(key=lambda a: a.get("seen_pos", 99))
        data = acs[0] if acs else {}
    except Exception as exc:  # noqa: BLE001
        logger.info("adsb.lol callsign lookup failed %s: %s", cs, exc)
        return None
    _flight_live_cache[cs] = {"ts": _time.time(), "data": data}
    return data


def _plausible_leg(legs, lat, lon, trk):
    best = None
    for leg in legs:
        fr, flat, flon, to, tlat, tlon = leg
        total = _gc_mi(flat, flon, tlat, tlon)
        if total < 30:
            continue
        via = _gc_mi(flat, flon, lat, lon) + _gc_mi(lat, lon, tlat, tlon)
        ratio = via / total
        if ratio > 1.15:
            continue
        if isinstance(trk, (int, float)) and _gc_mi(lat, lon, tlat, tlon) > 40:
            diff = abs((_bearing(lat, lon, tlat, tlon) - trk + 540) % 360 - 180)
            if diff > 50:
                continue
        if best is None or ratio < best[0]:
            best = (ratio, fr, to, tlat, tlon)
    return best[1:] if best else (None, None, None, None)


def _flight_aeroapi(ident: str):
    """Pinned flight from FlightAware: {ok, fn, al, fr, to, frc, toc, cs, st,
    so, eo, ao, si, ei, ai, ddl, adl, cx, status} (times = ET clock strings,
    delays = whole minutes), {"ok": False} for unknown idents, None on error."""
    fl = _aero_flights(ident)
    if fl is None:
        return None
    if not fl:
        return {"ok": False}
    leg = _aero_pick_leg(fl)
    if not leg:  # real flight number, nothing today
        f0 = fl[0]
        return {"ok": True, "fn": f0.get("ident_iata") or ident,
                "cs": f0.get("ident_icao") or ident, "none": True}
    o, d = leg.get("origin") or {}, leg.get("destination") or {}
    out = {"ok": True, "fn": leg.get("ident_iata") or leg.get("ident") or ident,
           "cs": leg.get("ident_icao") or leg.get("ident") or ident,
           "op": leg.get("operator_icao") or leg.get("operator"),
           "fr": _ap(o), "to": _ap(d), "frc": o.get("city"), "toc": d.get("city"),
           "status": leg.get("status"), "cx": bool(leg.get("cancelled")),
           "dv": bool(leg.get("diverted"))}
    for k, f in (("so", "scheduled_out"), ("eo", "estimated_out"), ("ao", "actual_out"),
                 ("si", "scheduled_in"), ("ei", "estimated_in"), ("ai", "actual_in")):
        v = _et_clock(_aero_ts(leg.get(f)))
        if v:
            out[k] = v
    for k, f in (("ddl", "departure_delay"), ("adl", "arrival_delay")):
        if isinstance(leg.get(f), (int, float)):
            out[k] = round(leg[f] / 60)
    return out


def _device_flight_fa(q: str, fa: dict) -> dict:
    """/device/flight payload from FlightAware's leg + adsb.lol live position.
    Same fields firmware 1.1.14 reads (ok fn al air alt gs mi fr to dmi eta),
    plus so/eo/si/ei/ao/ai (ET), ddl/adl (delay min), st (status), cx/dv."""
    if not fa.get("ok"):
        return {"ok": False, "msg": "Flight not found"}
    cs = fa.get("cs") or q
    info = resolve_airline(cs) or {}
    al = info.get("name")
    if not al:
        al = (_flight_meta(q) or {}).get("al")
    out = {"ok": True, "fn": fa.get("fn") or q, "al": al, "air": False, "src": "fa"}
    for k in ("fr", "to", "so", "eo", "ao", "si", "ei", "ai", "ddl", "adl"):
        if fa.get(k) is not None:
            out[k] = fa[k]
    if fa.get("status"):
        out["st"] = fa["status"]
    if fa.get("cx"):
        out["cx"] = True
    if fa.get("dv"):
        out["dv"] = True
    live = _flight_live(cs)
    if live:
        ab = live.get("alt_baro")
        if isinstance(ab, (int, float)) and ab > 0:
            out["air"] = True
            out["alt"] = int(round(ab, -2))
            if isinstance(live.get("gs"), (int, float)):
                out["gs"] = round(live["gs"] * 1.15078)
            lat, lon = live["lat"], live["lon"]
            out["mi"] = round(_gc_mi(_LKN[0], _LKN[1], lat, lon))
            ap = _airport_ll(fa.get("to"))
            if ap:
                out["dmi"] = round(_gc_mi(lat, lon, ap[0], ap[1]))
    # ETA: FlightAware's estimated arrival (gate) when airborne; firmware
    # 1.1.14 only draws it with dmi, so it appears exactly when it did before.
    if out["air"] and fa.get("ei"):
        out["eta"] = fa["ei"]
    return out


_airport_ll_cache: dict = {}


def _airport_ll(iata):
    """(lat, lon) for an airport via AeroAPI /airports/{id} ($0.015, cached
    for the life of the instance; a pinned flight touches 1-2 airports)."""
    import os
    if not iata:
        return None
    if iata in _airport_ll_cache:
        return _airport_ll_cache[iata]
    key = os.environ.get("FLIGHTAWARE_API_KEY")
    if not key or not _aero_budget_ok():
        return None
    ll = None
    try:
        r = requests.get(f"{AEROAPI_BASE}/airports/{iata}", headers={"x-apikey": key}, timeout=4)
        if r.status_code == 200:
            a = r.json()
            if a.get("latitude") is not None:
                ll = (a["latitude"], a["longitude"])
    except Exception as exc:  # noqa: BLE001
        logger.info("airport lookup failed %s: %s", iata, exc)
    if ll:
        _airport_ll_cache[iata] = ll
    return ll


@api_router.get("/device/flight")
def device_flight(ident: str):
    """Verify a pinned flight number and report live status.
    {ok, fn, al, air, alt, gs, fr, to, mi} or {ok:false, msg}."""
    import re as _re
    q = _re.sub(r"[^A-Z0-9]", "", (ident or "").upper())
    if not _re.match(r"^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$", q):
        return {"ok": False, "msg": "Bad flight number"}
    fa = _flight_aeroapi(q)
    if fa is not None:
        return _device_flight_fa(q, fa)
    meta = _flight_meta(q)
    cs = meta.get("cs") or q
    live = _flight_live(cs)
    if meta.get("ok") is False and not live:
        return {"ok": False, "msg": "Flight not found"}
    out = {"ok": True, "fn": meta.get("fn") or q, "al": meta.get("al"), "air": False}
    if meta.get("ok") is None:
        out["unv"] = True  # adsbdb unreachable: not verified yet
    if live:
        ab = live.get("alt_baro")
        air = isinstance(ab, (int, float)) and ab > 0
        out["air"] = air
        if air:
            out["alt"] = int(round(ab, -2))
            if isinstance(live.get("gs"), (int, float)):
                out["gs"] = round(live["gs"] * 1.15078)
            lat, lon = live["lat"], live["lon"]
            out["mi"] = round(_gc_mi(_LKN[0], _LKN[1], lat, lon))
            fr, to, tlat, tlon = _plausible_leg(meta.get("legs") or [], lat, lon, live.get("track"))
            if fr and to:
                out["fr"], out["to"] = fr, to
                dmi = _gc_mi(lat, lon, tlat, tlon)
                out["dmi"] = round(dmi)
                gs_mph = out.get("gs") or 0
                if gs_mph > 115:  # gs > 100 kt
                    from datetime import datetime, timedelta
                    from zoneinfo import ZoneInfo
                    # +10 min for descent/approach slowdown (rough).
                    t = datetime.now(ZoneInfo("America/New_York")) + timedelta(hours=dmi / gs_mph, minutes=10)
                    out["eta"] = f"{t.hour % 12 or 12}:{t.minute:02d}"
    return out


@api_router.get("/device/tv")
def device_tv(names: str):
    def _ascii(s):
        return (s or "").encode("ascii", "ignore").decode().strip()

    nms = [r.strip() for r in names.split("|") if r.strip()]
    out = []
    res = _tv_status_many(nms)
    if any(x.get("failed") for x in res):
        # Let the panel keep its previous labels and retry soon, instead of
        # overwriting them with blanks.
        raise HTTPException(status_code=503, detail="tv lookup incomplete")
    for nm, s in zip(nms, res):
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
    """Latest Lake Norman water temp (F) from USGS. USGS intermittently 503s
    or returns an empty latest value, so try twice, then fall back to the
    last reading within the past 2 days (period=P2D)."""
    import time as _time

    attempts = (
        {"siteStatus": "active"},
        {"siteStatus": "active"},
        {"period": "P2D"},
    )
    for i, extra in enumerate(attempts):
        try:
            r = requests.get(
                USGS_IV,
                params={
                    "format": "json",
                    "sites": LKN_TEMP_SITE,
                    "parameterCd": "00010",  # water temperature, degrees C
                    **extra,
                },
                timeout=5,
            )
            r.raise_for_status()
            for series in r.json()["value"]["timeSeries"]:
                vals = [v for v in series["values"][0]["value"]
                        if v.get("value") not in (None, "", "-999999")]
                if vals:
                    c = float(vals[-1]["value"])
                    return int(round(c * 9 / 5 + 32))
        except Exception as exc:  # noqa: BLE001
            logger.warning("lake water temp attempt %d failed: %s", i + 1, exc)
        if i == 0:
            _time.sleep(0.7)
    return None


@api_router.get("/device/lake")
def device_lake():
    """Lake Norman level (Duke Energy) vs full pond + water temp (USGS)."""
    import time as _time

    cached = _lake_cache.get("d")
    if cached and _time.time() - cached["ts"] < 3600:
        return cached["data"]

    lvl = tgt = full = dt = df = lip = None
    try:
        r = requests.get(DUKE_LEVELS, timeout=8)
        r.raise_for_status()
        for lk in r.json():
            if "NORMAN" in (lk.get("LakeName") or "").upper():
                lvl = round(float(lk["Actual"]), 1)
                tgt = round(float(lk["Target"]), 1)
                full = round(float(lk["Max"]), 1)
                # Differences from the unrounded values (97.46 - 98.50 = -1.0,
                # not 97.5 - 98.5). "Target" is Duke's operating guide-curve
                # target for today; "Max" is full pond (100.0).
                act = float(lk["Actual"])
                dt = round(act - float(lk["Target"]), 1)
                df = round(act - float(lk["Max"]), 1)
                try:
                    lip = int(lk.get("LowInputStage") or 0)  # Low Inflow Protocol stage
                except (TypeError, ValueError):
                    lip = None
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

    out = {"lvl": lvl, "tgt": tgt, "full": full, "w": w,
           "dt": dt, "df": df, "lip": lip}
    # Don't cache a failed cold-cache fetch (would blank the module for the TTL).
    if lvl is not None:
        # A response without a water temp is NOT cached: the panel fetches the
        # lake only hourly and `w: null` blanks its WATER line, so every request
        # should retry USGS until it gets a real reading.
        if w is not None:
            _lake_cache["d"] = {"ts": _time.time(), "data": out}
    return out

# ---------------------------------------------------------------------------
# Firmware OTA (same scheme as the Aura backend). Builds are published as
# static files in backend/public/fw/ (firmware.bin + meta.json) and served by
# Vercel's CDN at /fw/firmware.bin. No upload endpoint: the serverless
# filesystem is read-only, so publishing is a git commit + redeploy.
# See public/fw/README.md.
# ---------------------------------------------------------------------------
import json as _json  # noqa: E402

_FW_DIR = ROOT_DIR / "public" / "fw"
_FW_BIN = _FW_DIR / "firmware.bin"
_FW_META = _FW_DIR / "meta.json"
_FW_URL = "/fw/firmware.bin"


def _fw_meta() -> dict:
    if _FW_META.exists():
        try:
            return _json.loads(_FW_META.read_text())
        except Exception:  # noqa: BLE001
            pass
    return {"version": "", "size": 0}


@api_router.get("/firmware/latest")
def firmware_latest(current: str = ""):
    """The panel (BLE "ota" command) and the app ask this for the latest
    firmware. `update` is true when a build is hosted and its version differs
    from `current`; the firmware itself only installs a strictly newer one."""
    m = _fw_meta()
    has = bool(m.get("version")) and _FW_BIN.exists()
    size = m.get("size", 0)
    if has and not size:
        size = _FW_BIN.stat().st_size
    return {
        "version": m.get("version", ""),
        "size": size,
        "available": has,
        "update": has and m.get("version", "") != (current or ""),
        "url": _FW_URL,
        "sha256": m.get("sha256", ""),
    }


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
