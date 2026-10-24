"""Yearly refresh of daily/born_today.json (top-5 well-known people + top-5
composers born on each MM/DD). Throttled so Wikimedia doesn't 429.
Run:  python tools/build_born_today.py   (from backend/, ~10 min)"""
import json, sys, time, datetime as dt
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import daily

out_path = daily.DATA / "born_today.json"
out = json.loads(out_path.read_text()) if out_path.exists() else {}
d = dt.date(2024, 1, 1)  # leap year -> all 366 dates
while d.year == 2024:
    k = f"{d.month:02d}{d.day:02d}"
    if k not in out or not out[k].get("people"):
        for attempt in range(4):
            try:
                out[k] = {"people": daily.rank_births(d), "composers": daily.rank_births(d, composer=True)}
                break
            except Exception as e:
                print(k, "retry", e); time.sleep(10 * (attempt + 1))
        print(k, (out.get(k, {}).get("people") or [{}])[0].get("name"), flush=True)
        out_path.write_text(json.dumps(out, ensure_ascii=False, indent=0))
        time.sleep(1.2)
    d += dt.timedelta(1)
