"""Mom Wall daily content (firmware 1.2.0 "simple mode" + the mom-app Today page).

One pick per day for word / classical / math / born-today, chosen
deterministically from the curated lists in daily/ (each list has >= 366
entries, so nothing repeats within a year), cached per ET date.
Born-today comes from Wikipedia's on-this-day births feed, filtered to
well-known older people (born 1880-1965, ranked by Wikipedia page views).
The family message is stored in Upstash/Vercel KV when configured, else a
local JSON file (dev only - Vercel's filesystem is ephemeral).
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import threading
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ET = ZoneInfo("America/New_York")
DATA = Path(__file__).parent / "daily"
UA = {"User-Agent": "InfoWall-MomWall/1.0 (https://github.com/abarish-dev/Info-Wall)"}
YT = "https://www.youtube.com/results?search_query="


def _load(name):
    with open(DATA / name, encoding="utf-8") as f:
        return json.load(f)


WORDS = _load("words.json")
CFACTS = _load("classical_facts.json")
COTD = _load("classical_on_this_day.json")
MATH = _load("math_facts.json")
EARTH = _load("earth_facts.json")
SPORTS = _load("sports_facts.json")
YIDDISH = _load("yiddish_words.json")   # Mom Wall 1.2.23: Learn Yiddish
HISTORY = _load("this_day_history.json")   # Mom Wall 1.2.23: This Day in History, keyed MM-DD  # main walls 1.3.2: Olympics / NFL / MLB / UFC  # Mom Wall 1.2.21: geography + geology

_cache: dict = {}
_lock = threading.Lock()


def ascii_(s: str) -> str:
    """Panel font is ASCII 5x7: fold accents, smart quotes, dashes."""
    s = (s or "").replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    s = s.replace("\u2013", "-").replace("\u2014", "-").replace("\u2026", "...").replace("\u00b2", "^2")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", s).strip()


def today_et() -> _dt.date:
    return _dt.datetime.now(ET).date()


def _doy(d: _dt.date) -> int:
    return d.timetuple().tm_yday  # 1..366


def pick_word(d):
    w = WORDS[(_doy(d) - 1) % len(WORDS)]
    return {
        "word": w["word"], "pron": w["pron"], "pos": w["pos"],
        "definition": w.get("wiktionary_def") or w["definition"],
        "short": w["definition"], "origin": w["origin"], "example": w.get("example", ""),
        "more_url": w.get("more_url") or w["source"],
    }


def pick_fact(d):
    f = CFACTS[(_doy(d) - 1) % len(CFACTS)]
    return {"text": f["text"], "topic": f["topic"], "source": f["source"], "listen_url": f.get("listen_url")}


# ---- Math: computed special dates first, else the curated list ------------
def special_date(d) -> dict | None:
    m, dd, yy = d.month, d.day, d.year % 100
    if m * m + dd * dd == yy * yy:
        return {"big": f"{m}^2+{dd}^2={yy}^2", "text": f"{m}/{dd}/{yy:02d} is a Pythagorean (right-triangle) date.",
                "kind": "pythagorean"}
    if m == dd and m * m == yy:
        return {"big": f"{m}/{dd}/{yy:02d}", "text": f"Square Root Day: {m} x {dd} = {yy}.", "kind": "sqrt"}
    if (m, dd) == (3, 14):
        return {"big": "3.14159...", "text": "Happy Pi Day! Pi is the ratio of a circle's circumference to its diameter.", "kind": "pi"}
    if (m, dd) == (11, 23):
        return {"big": "1, 1, 2, 3, 5, 8", "text": "Fibonacci Day: 11/23 starts the sequence 1,1,2,3.", "kind": "fib"}
    if (m, dd) == (2, 7) or (m, dd) == (7, 27):
        pass
    if m * dd == yy:
        return {"big": f"{m} x {dd} = {yy}", "text": f"Multiplication date: month times day equals the year ({yy:02d}).", "kind": "mult"}
    s = f"{m}{dd}{yy:02d}"
    if len(s) >= 4 and s == s[::-1]:
        return {"big": f"{m}/{dd}/{yy:02d}", "text": f"Palindrome date: {s} reads the same both ways.", "kind": "palindrome"}
    if len(s) >= 4 and all(int(s[i + 1]) - int(s[i]) == 1 for i in range(len(s) - 1)):
        return {"big": f"{m}/{dd}/{yy:02d}", "text": "Sequential date: the digits count up in order.", "kind": "sequential"}
    return None


def pick_math(d):
    sp = special_date(d)
    if sp:
        sp["source"] = {
            "pythagorean": "https://en.wikipedia.org/wiki/Pythagorean_triple",
            "pi": "https://en.wikipedia.org/wiki/Pi_Day",
            "fib": "https://en.wikipedia.org/wiki/Fibonacci_sequence",
        }.get(sp["kind"], "https://en.wikipedia.org/wiki/Palindrome")
        if sp["kind"] == "pythagorean":
            # "last this century" when no later date this century qualifies
            later = any(_is_pyth(_dt.date(d.year, 1, 1) + _dt.timedelta(n)) and
                        (_dt.date(d.year, 1, 1) + _dt.timedelta(n)) > d for n in range(0, 366 * (2100 - d.year)))
            if not later:
                sp["text"] = f"{d.month}/{d.day}/{d.year % 100:02d}: the last right-triangle date this century!"
        return sp
    f = MATH[(_doy(d) - 1) % len(MATH)]
    return {"big": "", "text": f["text"], "source": f["source"], "kind": "fact"}


def pick_earth(d):
    """Geography on odd days-of-year, geology on even; each list walks in order."""
    doy = _doy(d)
    kind = "geography" if doy % 2 else "geology"
    lst = EARTH[kind]
    f = lst[((doy - 1) // 2) % len(lst)]
    return {"kind": kind, "title": kind.upper(), "topic": f["topic"], "text": f["text"], "source": f["source"]}


def pick_yiddish(d):
    """One Yiddish word a day, walking the list in order."""
    f = YIDDISH[(_doy(d) - 1) % len(YIDDISH)]
    return {"title": "LEARN YIDDISH", "word": f["word"], "meaning": f["meaning"], "source": f["source"]}


_MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def pick_history(d):
    """World-history event for today's calendar date (one per MM-DD)."""
    f = HISTORY.get(d.strftime("%m-%d"))
    if not f:
        return None
    y = f["year"]
    ys = f"{-y} BC" if y < 0 else (f"AD {y}" if y < 1000 else str(y))
    return {"title": "THIS DAY IN HISTORY", "year": y, "when": f"{_MON[d.month - 1]} {d.day}, {ys}",
            "text": f["text"], "source": f["source"]}


SPORT_TITLES = {"olympics": "OLYMPIC TRIVIA", "nfl": "NFL TRIVIA", "mlb": "MLB TRIVIA", "ufc": "UFC TRIVIA"}


def pick_sports(d):
    """One sports fact a day, cycling Olympics -> NFL -> MLB -> UFC."""
    doy = _doy(d)
    kind = list(SPORT_TITLES)[(doy - 1) % 4]
    lst = SPORTS[kind]
    f = lst[((doy - 1) // 4) % len(lst)]
    return {"kind": kind, "title": SPORT_TITLES[kind], "topic": f["topic"], "text": f["text"], "source": f["source"]}


def _is_pyth(x):
    return x.month ** 2 + x.day ** 2 == (x.year % 100) ** 2


# ---- Born today: Wikipedia births feed, filtered to famous older people ---
_births_cache: dict = {}


def _births(d):
    """Wikipedia births for MM/DD (cached per date; two mirrors of the same feed)."""
    k = f"{d.month:02d}{d.day:02d}"
    if k in _births_cache:
        return _births_cache[k]
    last = None
    for url in (f"https://en.wikipedia.org/api/rest_v1/feed/onthisday/births/{d.month:02d}/{d.day:02d}",
                f"https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/{d.month:02d}/{d.day:02d}"):
        try:
            r = requests.get(url, headers=UA, timeout=10)
            r.raise_for_status()
            _births_cache[k] = r.json().get("births", [])
            return _births_cache[k]
        except Exception as e:  # noqa: BLE001
            last = e
    raise last


def _fame(pages) -> list[int]:
    """Wikidata sitelink counts (how many Wikipedias have an article) - a
    stable fame signal; one batched call per 50 people."""
    ids = [p.get("wikibase_item") or "" for p in pages]
    out = {}
    for i in range(0, len(ids), 50):
        chunk = [q for q in ids[i:i + 50] if q]
        if not chunk:
            continue
        try:
            r = requests.get("https://www.wikidata.org/w/api.php", headers=UA, timeout=10, params={
                "action": "wbgetentities", "ids": "|".join(chunk), "props": "sitelinks", "format": "json"})
            for q, e in r.json().get("entities", {}).items():
                out[q] = len(e.get("sitelinks", {}))
        except Exception:  # noqa: BLE001
            pass
    return [out.get(q, 0) for q in ids]


_SKIP = re.compile(r"footballer|cricketer|rugby|wrestler|racing driver|ice hockey|basketball|baseball|soccer|"
                   r"\b(duo|band|group|trio)\b|bishop|noble|prince|princess|king of|queen of|"
                   r"Nazi|\bSS\b|criminal|murderer|killer|terrorist|dictator|gangster|mobster|fascist|"
                   r"Holocaust|cult leader|porn", re.I)
_BORN_FILE = DATA / "born_today.json"
BORN = json.loads(_BORN_FILE.read_text()) if _BORN_FILE.exists() else {}


def _name(p):
    return re.sub(r"\s*\(.*?\)$", "", p.get("normalizedtitle") or p["title"].replace("_", " "))


def _desc(s: str) -> str:
    return re.sub(r"\s*\((?:born|died|\d{3,4})[^)]*\)", "", s or "").strip()


def rank_births(d, composer=False):
    """Live ranking: well-known older people (born 1880-1965) or composers."""
    c = []
    for b in _births(d):
        y = b.get("year") or 0
        p = (b.get("pages") or [{}])[0]
        desc = p.get("description") or ""
        if not desc or not p.get("title"):
            continue
        if composer:
            if not (y <= 1965 and "composer" in desc.lower()) or re.search(
                    r"singer|songwriter|rapper|guitarist|\bDJ\b|film score|video game", desc, re.I):
                continue
        elif not (1880 <= y <= 1965) or _SKIP.search(desc):
            continue
        c.append((y, p))
    if not c:
        return []
    f = _fame([p for _, p in c])
    sc = [f[i] * _appeal(c[i][1].get("description") or "") for i in range(len(c))]
    order = sorted(range(len(c)), key=lambda i: -sc[i])
    return [{"name": _name(c[i][1]), "year": c[i][0], "description": _desc(c[i][1].get("description")),
             "fame": f[i], "read_more": f"https://en.wikipedia.org/wiki/{c[i][1]['title']}",
             "thumb": (c[i][1].get("thumbnail") or {}).get("source")} for i in order[:5]]


_LIKED = re.compile(r"actor|actress|singer|author|writer|novelist|poet|comedian|musician|pianist|"
                    r"conductor|composer|artist|painter|astronaut|inventor|scientist|physicist|"
                    r"television|broadcaster|journalist|director|dancer|chef|First Lady", re.I)


def _appeal(desc: str) -> float:
    """Tilt toward names an 81-year-old American would know."""
    k = 1.0
    if "American" in desc:
        k *= 1.6
    if _LIKED.search(desc):
        k *= 1.3
    if re.search(r"politician|dictator|military|general|lawyer|businessman", desc, re.I) and "American" not in desc:
        k *= 0.4
    return k


def _from_file(d, key):
    lst = [p for p in (BORN.get(f"{d.month:02d}{d.day:02d}") or {}).get(key) or []
           if not _SKIP.search(p.get("description") or "")]
    return lst[0] if lst else None


def pick_born(d):
    b = _from_file(d, "people")
    if not b:
        r = rank_births(d)
        b = r[0] if r else None
    if b:
        b = dict(b, age=d.year - b["year"])
    return b


def _composer_born(d):
    c = _from_file(d, "composers")
    if c:
        return c
    try:
        r = rank_births(d, composer=True)
        return r[0] if r else None
    except Exception:  # noqa: BLE001
        return None


def pick_classical_today(d):
    items = COTD.get(f"{d.month:02d}{d.day:02d}") or []
    if items:
        it = items[d.year % len(items)]
        return {"kind": "event", "year": it["year"], "text": it["text"],
                "source": it["source_url"], "listen_url": it.get("listen_url")}
    c = _composer_born(d)
    if c:
        return {"kind": "composer_born", "year": c["year"], "text": f"Born today: {c['name']} ({c['year']}), {c['description']}",
                "name": c["name"], "description": c["description"], "source": c["read_more"],
                "listen_url": YT + urllib.parse.quote_plus(f"{c['name']} best known works")}
    return None


# ---- Family message --------------------------------------------------------
_FAM_FILE = Path(os.environ.get("FAMILY_MSG_FILE", "/tmp/infowall_family_msg.json"))


def _kv():
    url = os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL")
    tok = os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN")
    return (url.rstrip("/"), tok) if url and tok else None


# ---- Wall "last seen" (1.2.22 / 1.3.1 User-Agent) ---------------------------
_UA_RE = re.compile(r"InfoWall/([\w.\-]+) \((simple|main); id=([0-9a-f]{6})\)")
_seen_local: dict = {}
_seen_last_write: dict = {}
SEEN_WRITE_EVERY = 600  # s per wall per instance: keeps KV use tiny


def seen_note(ua: str, path: str) -> None:
    """Record {id: version, mode, path, time} from an InfoWall User-Agent.
    Only the 6-hex hashed id is stored - no IPs, no Wi-Fi names."""
    m = _UA_RE.search(ua or "")
    if not m:
        return
    ver, mode, wid = m.groups()
    now = _dt.datetime.now(ET)
    rec = {"id": wid, "mode": mode, "fw": ver, "path": path, "seen": now.isoformat(timespec="seconds")}
    _seen_local[wid] = rec
    t = now.timestamp()
    if t - _seen_last_write.get(wid, 0) < SEEN_WRITE_EVERY:
        return
    _seen_last_write[wid] = t
    kv = _kv()
    if not kv:
        return
    try:
        requests.post(f"{kv[0]}/hset/walls:seen/{wid}", headers={"Authorization": f"Bearer {kv[1]}"},
                      data=json.dumps(rec), timeout=3)
    except Exception:  # noqa: BLE001 - never fail a wall request over logging
        pass


def seen_all() -> list:
    out = dict(_seen_local)
    kv = _kv()
    if kv:
        try:
            r = requests.get(f"{kv[0]}/hgetall/walls:seen", headers={"Authorization": f"Bearer {kv[1]}"}, timeout=5)
            flat = r.json().get("result") or []
            for k, v in zip(flat[::2], flat[1::2]):
                rec = json.loads(v)
                if k not in out or out[k]["seen"] < rec["seen"]:
                    out[k] = rec
        except Exception:  # noqa: BLE001
            pass
    return sorted(out.values(), key=lambda r: r["seen"], reverse=True)


def family_get(wall: str = "mom") -> dict:
    kv = _kv()
    try:
        if kv:
            r = requests.get(f"{kv[0]}/get/family:{wall}", headers={"Authorization": f"Bearer {kv[1]}"}, timeout=5)
            v = r.json().get("result")
            return json.loads(v) if v else {}
        if _FAM_FILE.exists():
            return json.loads(_FAM_FILE.read_text()).get(wall, {})
    except Exception:  # noqa: BLE001
        pass
    return {}


def family_set(wall: str, text: str, sender: str) -> dict:
    rec = {"text": text.strip()[:140], "from": sender.strip()[:24],
           "updated": _dt.datetime.now(ET).isoformat(timespec="seconds")}
    kv = _kv()
    if kv:
        requests.post(f"{kv[0]}/set/family:{wall}", headers={"Authorization": f"Bearer {kv[1]}"},
                      data=json.dumps(rec), timeout=5).raise_for_status()
    else:
        all_ = json.loads(_FAM_FILE.read_text()) if _FAM_FILE.exists() else {}
        all_[wall] = rec
        _FAM_FILE.write_text(json.dumps(all_))
    with _lock:
        _cache.clear()
    return rec


def family_clear(wall: str = "mom") -> dict:
    kv = _kv()
    if kv:
        requests.post(f"{kv[0]}/del/family:{wall}", headers={"Authorization": f"Bearer {kv[1]}"},
                      timeout=5).raise_for_status()
    elif _FAM_FILE.exists():
        all_ = json.loads(_FAM_FILE.read_text())
        all_.pop(wall, None)
        _FAM_FILE.write_text(json.dumps(all_))
    with _lock:
        _cache.clear()
    return {}


# ---- Assembly --------------------------------------------------------------
def daily(d: _dt.date | None = None) -> dict:
    d = d or today_et()
    key = d.isoformat()
    with _lock:
        if key in _cache:
            return _cache[key]
    out = {"date": key, "word": pick_word(d), "classical_fact": pick_fact(d),
           "classical_today": pick_classical_today(d), "math": pick_math(d), "earth": pick_earth(d), "sports": pick_sports(d),
           "yiddish": pick_yiddish(d), "history": pick_history(d)}
    try:
        out["born"] = pick_born(d)
    except Exception:  # noqa: BLE001
        out["born"] = None
    born_ok = out["born"] is not None
    with _lock:
        if born_ok:  # don't cache a Wikipedia outage for the whole day
            _cache.clear()
            _cache[key] = out
    return out


def device_daily(d: _dt.date | None = None, wall: str = "mom") -> dict:
    """Compact ASCII payload for the panel (fits a small JSON doc)."""
    x = daily(d)
    w, m, b, ct, cf = x["word"], x["math"], x["born"], x["classical_today"], x["classical_fact"]
    fam = family_get(wall)
    h = x.get("history")
    return {
        "d": x["date"],
        "w": ascii_(w["word"]), "wp": ascii_(w["pron"]), "ws": ascii_(w["pos"]),
        "wd": ascii_(w["short"]), "wo": ascii_(w["origin"]), "wx": ascii_(w["example"]),
        "bn": ascii_(b["name"]) if b else "", "by": b["year"] if b else 0,
        "bd": ascii_(b["description"]) if b else "",
        "cf": ascii_(cf["text"]),
        "ct": ascii_((ct.get("name") if ct.get("kind") == "composer_born" else ct["text"]) if ct else ""),
        "cx": ascii_(ct.get("description", "")) if ct else "", "cy": (ct or {}).get("year") or 0,
        "ck": (ct or {}).get("kind", ""),
        "mb": ascii_(m["big"]), "mt": ascii_(m["text"]),
        "gt": ascii_(x["earth"]["title"]), "gs": ascii_(x["earth"]["topic"]), "gx": ascii_(x["earth"]["text"]),
        "pt": ascii_(x["sports"]["title"]), "ps": ascii_(x["sports"]["topic"]), "px": ascii_(x["sports"]["text"]),
        "yt": ascii_(x["yiddish"]["title"]), "ys": ascii_(x["yiddish"]["word"]), "yx": ascii_(x["yiddish"]["meaning"]),
        "ht": ascii_(h["title"]) if h else "", "hs": ascii_(h["when"]) if h else "", "hx": ascii_(h["text"]) if h else "",
        "fm": ascii_(fam.get("text", "")), "ff": ascii_(fam.get("from", "")),
    }
