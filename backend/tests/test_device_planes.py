"""Tests for GET /api/device/planes — new 'ia' airline code field."""

import os
import re
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://bluetooth-led-sync.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestDevicePlanes:
    """Verify /api/device/planes returns compact shape with 'ia' field."""

    def test_status_200_and_shape(self, api):
        r = api.get(f"{BASE_URL}/api/device/planes", params={"lat": 35.58, "lon": -80.86, "radius": 50}, timeout=20)
        assert r.status_code == 200, f"expected 200, got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert "p" in data, f"missing 'p' key: {data}"
        assert isinstance(data["p"], list)

    def test_each_entry_has_required_fields_and_ia_rule(self, api):
        r = api.get(f"{BASE_URL}/api/device/planes", params={"lat": 35.58, "lon": -80.86, "radius": 50}, timeout=20)
        assert r.status_code == 200
        entries = r.json().get("p", [])

        # If no live traffic, skip — cannot assert on shape without at least one row.
        if not entries:
            pytest.skip("no live aircraft in the sky right now; shape check needs at least one entry")

        icao_re = re.compile(r"^[A-Z]{3}$")
        for e in entries:
            # required fields exist
            for k in ("f", "al", "ia", "d"):
                assert k in e, f"missing key '{k}' in entry {e}"
            call = (e.get("f") or "").strip().upper()
            ia = e.get("ia")
            # ia rule: derived only from 3-letters+digit callsigns
            if re.match(r"^[A-Z]{3}\d", call):
                assert ia is not None and icao_re.match(ia), f"expected 3-letter ICAO for {call!r}, got {ia!r}"
                assert call.startswith(ia), f"ia {ia!r} should be leading 3 letters of callsign {call!r}"
            else:
                # private tail / non-airline pattern
                assert ia is None, f"expected ia=null for non-airline callsign {call!r}, got {ia!r}"

    def test_at_most_six_entries(self, api):
        r = api.get(f"{BASE_URL}/api/device/planes", params={"lat": 35.58, "lon": -80.86, "radius": 50}, timeout=20)
        assert r.status_code == 200
        assert len(r.json().get("p", [])) <= 6

    def test_default_radius(self, api):
        r = api.get(f"{BASE_URL}/api/device/planes", params={"lat": 35.58, "lon": -80.86}, timeout=20)
        assert r.status_code == 200
        assert "p" in r.json()
