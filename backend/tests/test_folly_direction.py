"""Tests for /api/device/folly ensuring 'dir' is consistent with the next tide.

Direction logic (backend): dir = 'in' if events[0].y == 'H' else 'out'
Empty events => dir may be null (acceptable).
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL",
    "https://bluetooth-led-sync.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestDeviceFolly:
    def test_status_and_shape(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/device/folly", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Required keys
        assert "e" in data
        assert "w" in data
        assert "dir" in data
        assert isinstance(data["e"], list)
        # dir must be one of the allowed values
        assert data["dir"] in ("in", "out", None)

    def test_direction_matches_next_tide(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/device/folly", timeout=15)
        assert r.status_code == 200
        data = r.json()
        events = data["e"]
        direction = data["dir"]

        if not events:
            # Empty events => dir null is acceptable
            assert direction is None
            pytest.skip("No tide events returned by upstream; skipping direction check.")

        first = events[0]
        # Event shape
        assert "y" in first and first["y"] in ("H", "L")
        assert "t" in first and isinstance(first["t"], str)
        assert "v" in first and isinstance(first["v"], (int, float))

        # Direction consistency
        expected = "in" if first["y"] == "H" else "out"
        assert direction == expected, (
            f"dir={direction} inconsistent with next tide y={first['y']}"
        )

    def test_events_have_up_to_two_items(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/device/folly", timeout=15)
        data = r.json()
        assert len(data["e"]) <= 2

    def test_water_temp_type(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/device/folly", timeout=15)
        data = r.json()
        # water temp may be None or int
        assert data["w"] is None or isinstance(data["w"], int)
