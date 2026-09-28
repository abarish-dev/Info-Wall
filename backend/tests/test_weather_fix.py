"""Regression tests for iteration_12:
- Weather bug fix: /api/weather/current now prefers Open-Meteo (accurate) over
  wttr.in (which reads ~4°F high for this location) and caches the fallback for
  a shorter TTL so we don't get "stuck" on a stale wttr.in reading.
- Also confirm quick regression on /api/device/folly (new 'dir' field),
  /api/device/lake, /api/teams/status (Eastern-date labels), /api/device/planes.
"""

import os
import time

import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None

# Fallback: use the public preview URL from frontend/.env
if not BASE_URL:
    BASE_URL = "https://bluetooth-led-sync.preview.emergentagent.com"

LAT, LON = 35.5841, -80.8685  # target user coords (Lake Norman area)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "InfoWallTest/1.0"})
    return s


# ---------------- WEATHER (bug fix under test) ----------------

class TestWeatherCurrent:
    def test_returns_200_and_shape(self, api):
        r = api.get(f"{BASE_URL}/api/weather/current", params={"lat": LAT, "lon": LON}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # All 5 fields must exist
        for k in ("temp", "code", "text", "hi", "lo"):
            assert k in j, f"missing {k} in {j}"
        # temp/hi/lo must be numeric (not None) — user complained about stale/wrong
        assert j["temp"] is not None, f"temp is None: {j}"
        assert j["hi"] is not None, f"hi is None: {j}"
        assert j["lo"] is not None, f"lo is None: {j}"
        assert isinstance(j["temp"], (int, float)), j
        assert isinstance(j["hi"], (int, float)), j
        assert isinstance(j["lo"], (int, float)), j
        # Sanity range for Fahrenheit (-40..130)
        assert -40 <= j["temp"] <= 130, j
        assert j["lo"] <= j["hi"], j
        # text must be a non-empty string
        assert isinstance(j["text"], str) and j["text"], j

    def test_matches_openmeteo_source(self, api):
        """Endpoint should track Open-Meteo (accurate). wttr.in reads ~4°F higher
        at this location. Confirm the endpoint's temp is within ~2°F of a direct
        Open-Meteo call (not stuck on wttr.in's warmer reading)."""
        # Warm the endpoint (may return cached wttr from a prior run — bust via jitter)
        r = api.get(f"{BASE_URL}/api/weather/current", params={"lat": LAT, "lon": LON}, timeout=15)
        assert r.status_code == 200
        api_temp = r.json()["temp"]

        # Fetch Open-Meteo directly
        om = api.get(
            "https://api.open-meteo.com/v1/forecast",
            params={
                "latitude": LAT,
                "longitude": LON,
                "current": "temperature_2m",
                "temperature_unit": "fahrenheit",
                "timezone": "auto",
            },
            timeout=10,
        )
        if om.status_code != 200:
            pytest.skip(f"Open-Meteo upstream unavailable (status={om.status_code}); cannot verify accuracy")
        om_temp = om.json().get("current", {}).get("temperature_2m")
        if om_temp is None:
            pytest.skip("Open-Meteo returned no temperature_2m; cannot verify")

        # Also grab wttr.in for comparison context
        try:
            w = api.get(
                f"https://wttr.in/{LAT},{LON}",
                params={"format": "j1"},
                headers={"User-Agent": "curl/8"},
                timeout=10,
            )
            wttr_temp = None
            if w.status_code == 200:
                wttr_temp = float((w.json().get("current_condition") or [{}])[0].get("temp_F"))
        except Exception:
            wttr_temp = None

        diff_om = abs(api_temp - round(om_temp))
        print(f"api_temp={api_temp} om={round(om_temp)} wttr={wttr_temp} diff_om={diff_om}")
        # Endpoint should be within 2°F of Open-Meteo (rounding + tiny lag).
        assert diff_om <= 2, (
            f"endpoint temp {api_temp} diverges from Open-Meteo {round(om_temp)} "
            f"(diff {diff_om}°F) — likely stuck on wttr.in fallback {wttr_temp}"
        )

    def test_repeat_calls_fast_and_consistent(self, api):
        """After warmup, repeat calls should be fast (<3s) and return the same
        cached payload shape."""
        # Warm
        r0 = api.get(f"{BASE_URL}/api/weather/current", params={"lat": LAT, "lon": LON}, timeout=15)
        assert r0.status_code == 200
        first = r0.json()

        for _ in range(3):
            t0 = time.time()
            r = api.get(f"{BASE_URL}/api/weather/current", params={"lat": LAT, "lon": LON}, timeout=15)
            elapsed = time.time() - t0
            assert r.status_code == 200
            j = r.json()
            assert set(j.keys()) >= {"temp", "code", "text", "hi", "lo"}
            assert j["temp"] == first["temp"], f"cached temp drifted: {first['temp']} -> {j['temp']}"
            assert elapsed < 3.0, f"warm call slow: {elapsed:.2f}s"


# ---------------- REGRESSION: shape-only, no deep assertions ----------------

class TestDeviceFolly:
    def test_shape_includes_dir_field(self, api):
        r = api.get(f"{BASE_URL}/api/device/folly", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        # New field: dir must exist (value can be 'in' | 'out' | None if no events)
        assert "dir" in j, f"missing 'dir': {j}"
        assert j["dir"] in ("in", "out", None), j
        assert "e" in j and isinstance(j["e"], list), j
        assert "w" in j, j  # water temp (may be None if upstream down)
        # Each event should have y/t/v
        for ev in j["e"]:
            assert set(ev.keys()) >= {"y", "t", "v"}, ev
            assert ev["y"] in ("H", "L"), ev
            assert isinstance(ev["v"], (int, float)), ev


class TestDeviceLake:
    def test_shape(self, api):
        r = api.get(f"{BASE_URL}/api/device/lake", timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert set(j.keys()) >= {"lvl", "tgt", "full", "w"}, j
        # lvl/tgt/full may be None on transient upstream failure, but if present must be numeric
        for k in ("lvl", "tgt", "full"):
            if j[k] is not None:
                assert isinstance(j[k], (int, float)), (k, j[k])


class TestTeamsStatusEasternDate:
    def test_yankees_returns_valid_shape_with_local_date_label(self, api):
        r = api.get(f"{BASE_URL}/api/teams/status", params={"teams": "MLB:NYY"}, timeout=15)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "results" in j and len(j["results"]) == 1, j
        row = j["results"][0]
        assert row["team"] == "MLB:NYY"
        assert row["highlight"] in (
            "live", "today", "soon", "upcoming", "recent", "offseason", "none",
        ), row
        # Not required to have a game scheduled; but if a label exists, it must be a str
        if row.get("label"):
            assert isinstance(row["label"], str)
        # If date returned, must be an ISO string
        if row.get("date"):
            assert isinstance(row["date"], str) and len(row["date"]) >= 10

    def test_eastern_date_conversion_util(self):
        """Directly verify _iso_to_eastern_date correctly rolls a UTC late-night
        event back to the local Eastern calendar date."""
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _iso_to_eastern_date

        # 2026-09-30 00:05Z is 2026-09-29 20:05 ET — must return 2026-09-29
        assert _iso_to_eastern_date("2026-09-30T00:05Z") == "2026-09-29"
        # A daytime UTC time should keep the same date
        assert _iso_to_eastern_date("2026-09-30T18:00Z") == "2026-09-30"
        # Malformed input degrades to first 10 chars
        assert _iso_to_eastern_date("2026-09-30") == "2026-09-30"


class TestDevicePlanes:
    def test_shape(self, api):
        r = api.get(
            f"{BASE_URL}/api/device/planes",
            params={"lat": 35.58, "lon": -80.86, "radius": 50},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        j = r.json()
        assert "p" in j and isinstance(j["p"], list), j
        for p in j["p"]:
            assert set(p.keys()) >= {"f", "al", "d"}, p
            assert isinstance(p["f"], str) and p["f"], p
            if p["d"] is not None:
                assert isinstance(p["d"], (int, float)), p
