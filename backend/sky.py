"""Sky + VIP feeds for the panel (firmware 1.1.17+).

/api/device/sky  moon phase, sunrise/sunset, moonrise and the ISS (next
                 visible pass + the next pass window so the panel can show
                 "OVERHEAD NOW" by itself between polls).
/api/device/vip  Air Force One / VC-25 / Special Air Mission aircraft near the
                 wall, from adsb.lol (free, no key). Interrupt-only on the panel.

Astronomy uses PyEphem (one small C wheel; its satellite code is SGP4), which
is lighter than skyfield + numpy + a 17 MB ephemeris on Vercel. The ISS TLE
comes from Celestrak and is refreshed once a day (kept on failure).
"""
import datetime as dt
import logging
import math
import re
import time
from zoneinfo import ZoneInfo

import ephem
import requests

log = logging.getLogger(__name__)
ET = ZoneInfo("America/New_York")
UA = {"User-Agent": "InfoWall/1.1 (+personal LED wall)"}

_tle = {"ts": 0.0, "lines": None}
_sky_cache: dict = {}
_mil = {"ts": 0.0, "ac": []}
_pt_cache: dict = {}
_vip_cache: dict = {}

TLE_URL = "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"
# Both VC-25A airframes (verified on hexdb.io: 82-8000 / 92-9000).
VC25_HEX = {"adfdf8": "82-8000", "adfdf9": "92-9000"}
VIP_CS = re.compile(r"^(AF1|AF2|SAM\d{1,5}|EXEC1F|EXEC2F|VENUS\d{1,3})$")
VIP_TYPES = {"VC25", "B742", "C32", "C40", "C37A", "C37B", "B752"}
VIP_RADIUS_MI = 60.0


def _hm(d: dt.datetime) -> str:
    """'7:35a' in Eastern time."""
    s = d.astimezone(ET).strftime("%I:%M%p").lower()
    return s.lstrip("0")[:-1]


def _utc(d) -> dt.datetime:
    return ephem.Date(d).datetime().replace(tzinfo=dt.timezone.utc)


def _compass(az_deg: float) -> str:
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((az_deg + 22.5) % 360) // 45)]


def _obs(lat: float, lon: float, when: dt.datetime) -> ephem.Observer:
    o = ephem.Observer()
    o.lat, o.lon = str(lat), str(lon)
    o.date = when
    o.pressure = 0
    o.horizon = "-0:34"
    return o


def _iss_tle():
    if _tle["lines"] and time.time() - _tle["ts"] < 86400:
        return _tle["lines"]
    try:
        r = requests.get(TLE_URL, timeout=6, headers=UA)
        lines = [ln.strip() for ln in r.text.splitlines() if ln.strip()]
        if r.ok and len(lines) >= 3 and lines[1].startswith("1 ") and lines[2].startswith("2 "):
            _tle.update(ts=time.time(), lines=lines[:3])
    except Exception as exc:  # keep the last good TLE
        log.warning("celestrak TLE fetch failed: %s", exc)
    return _tle["lines"]


def moon_sun(lat: float, lon: float, now: dt.datetime) -> dict:
    o = _obs(lat, lon, now)
    m = ephem.Moon(o)
    illum = float(m.phase)
    waxing = ephem.next_full_moon(now) < ephem.next_new_moon(now)
    if illum < 2:
        name = "New Moon"
    elif illum > 98:
        name = "Full Moon"
    elif 45 <= illum <= 55:
        name = "First Quarter" if waxing else "Last Quarter"
    else:
        name = ("Waxing " if waxing else "Waning ") + ("Crescent" if illum < 50 else "Gibbous")
    midnight = now.astimezone(ET).replace(hour=0, minute=0, second=0, microsecond=0)
    o.date = midnight.astimezone(dt.timezone.utc)
    out = {"il": round(illum), "wx": 1 if waxing else 0, "ph": name}
    try:
        out["sr"] = _hm(_utc(o.next_rising(ephem.Sun())))
        out["ss"] = _hm(_utc(o.next_setting(ephem.Sun())))
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        pass
    o.date = now
    try:
        mr = _utc(o.next_rising(ephem.Moon()))
        out["mr"] = _hm(mr)
        out["mrd"] = "" if mr.astimezone(ET).date() == now.astimezone(ET).date() else "tmw"
    except (ephem.AlwaysUpError, ephem.NeverUpError):
        pass
    return out


def iss(lat: float, lon: float, now: dt.datetime) -> dict:
    lines = _iss_tle()
    if not lines:
        return {}
    sat = ephem.readtle(*lines)
    o = ephem.Observer()
    o.lat, o.lon, o.elevation, o.pressure = str(lat), str(lon), 230, 0
    o.horizon = "10"
    out: dict = {"src": "celestrak", "ep": lines[1][18:32]}
    o.date = now
    sat.compute(o)
    out["mi"] = round(sat.elevation / 1609.34)  # height above sea level (m -> mi)
    sun = ephem.Sun()
    t = now - dt.timedelta(minutes=15)   # catch a pass already in progress
    first_any = None
    for _ in range(40):
        o.date = t
        try:
            rt, raz, mt, malt, st, saz = o.next_pass(sat)
        except Exception:
            break
        if None in (rt, mt, st):
            break
        rise, peak, setT = _utc(rt), _utc(mt), _utc(st)
        if setT <= now:
            t = setT + dt.timedelta(minutes=1)
            continue
        p = {"r": int(rise.timestamp()), "e": int(setT.timestamp()),
             "el": round(math.degrees(malt)), "fr": _compass(math.degrees(raz)),
             "to": _compass(math.degrees(saz))}
        if first_any is None:
            first_any = p
        o.date = peak
        sat.compute(o)
        sun.compute(o)
        if not sat.eclipsed and math.degrees(sun.alt) < -6:
            out["nv"] = dict(p, d=peak.astimezone(ET).strftime("%a %b %-d"), t=_hm(rise),
                             m=max(1, round((setT - rise).total_seconds() / 60)))
            break
        t = setT + dt.timedelta(minutes=1)
    if first_any:
        out["np"] = first_any   # next pass of any kind (panel: OVERHEAD NOW window)
    out["ov"] = 1 if first_any and first_any["r"] <= now.timestamp() <= first_any["e"] else 0
    return out


def device_sky(lat: float, lon: float) -> dict:
    key = (round(lat, 2), round(lon, 2))
    hit = _sky_cache.get(key)
    if hit and time.time() - hit["ts"] < 300:
        return hit["data"]
    now = dt.datetime.now(dt.timezone.utc)
    data = {"moon": moon_sun(lat, lon, now), "iss": iss(lat, lon, now), "now": int(now.timestamp())}
    _sky_cache[key] = {"ts": time.time(), "data": data}
    return data


# ---------------------------------------------------------------- VIP alerts
def _miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _bearing(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _get_ac(url: str):
    r = requests.get(url, timeout=6, headers=UA)
    r.raise_for_status()
    return r.json().get("ac") or []


def vip_match(a: dict):
    """Return (key, label) when an aircraft is a VIP mission, else None."""
    hx = (a.get("hex") or "").lower().lstrip("~")
    cs = (a.get("flight") or "").strip().upper()
    typ = (a.get("t") or "").upper()
    if cs == "AF1":
        return "AF1", "AIR FORCE ONE"
    if cs == "AF2":
        return "AF2", "AIR FORCE TWO"
    if hx in VC25_HEX:
        return "VC25", "VC-25A"
    if cs.startswith("EXEC") and VIP_CS.match(cs):
        return "EXEC", "EXECUTIVE JET"
    if cs.startswith("VENUS") and VIP_CS.match(cs):
        return "VENUS", "VIP FLIGHT"
    if cs.startswith("SAM") and VIP_CS.match(cs) and (not typ or typ in VIP_TYPES or (a.get("dbFlags", 0) & 1)):
        return "SAM", "SPECIAL AIR MSN"
    return None


def device_vip(lat: float, lon: float, radius_mi: float = VIP_RADIUS_MI) -> dict:
    key = (round(lat, 1), round(lon, 1), int(radius_mi))
    hit = _vip_cache.get(key)
    if hit and time.time() - hit["ts"] < 30:
        return hit["data"]
    now = time.time()
    # Global military list (shared by every wall, 30 s cache) ...
    if now - _mil["ts"] > 30:
        try:
            _mil.update(ts=now, ac=_get_ac("https://api.adsb.lol/v2/mil"))
        except Exception as exc:
            log.info("adsb.lol mil failed: %s", exc)
            _mil["ts"] = now - 15   # retry in ~15 s, keep the old list
    # ... plus everything near the wall (catches VIP callsigns not flagged mil).
    nm = max(5, min(250, int(radius_mi / 1.1508) + 1))
    pkey = (round(lat, 1), round(lon, 1), nm)
    pt = _pt_cache.get(pkey)
    if not pt or now - pt["ts"] > 30:
        try:
            pt = {"ts": now, "ac": _get_ac(f"https://api.adsb.lol/v2/point/{lat:.3f}/{lon:.3f}/{nm}")}
        except Exception as exc:
            log.info("adsb.lol point failed: %s", exc)
            pt = {"ts": now - 15, "ac": (pt or {}).get("ac", [])}
        _pt_cache[pkey] = pt
    seen, out = set(), []
    for a in list(_mil["ac"]) + list(pt["ac"]):
        hx = (a.get("hex") or "").lower()
        if hx in seen or a.get("lat") is None or a.get("lon") is None:
            continue
        m = vip_match(a)
        if not m:
            continue
        d = _miles(lat, lon, a["lat"], a["lon"])
        if d > radius_mi:
            continue
        seen.add(hx)
        alt = a.get("alt_baro")
        rate = a.get("baro_rate") or a.get("geom_rate") or 0
        out.append({
            "k": m[0], "l": m[1], "cs": (a.get("flight") or "").strip(), "hex": hx,
            "t": "VC-25A" if hx.lstrip("~") in VC25_HEX else (a.get("t") or ""),
            "reg": VC25_HEX.get(hx.lstrip("~"), a.get("r") or ""),
            "d": round(d, 1), "b": _compass(_bearing(lat, lon, a["lat"], a["lon"])),
            "alt": alt if isinstance(alt, (int, float)) else 0,
            "vr": 1 if rate > 300 else (-1 if rate < -300 else 0),
            "hdg": round(a.get("track") or 0), "spd": round(a.get("gs") or 0),
        })
    out.sort(key=lambda x: x["d"])
    data = {"a": out[:2], "r": radius_mi}
    _vip_cache[key] = {"ts": now, "data": data}
    return data
