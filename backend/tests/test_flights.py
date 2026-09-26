# Backend tests for GET /api/flights/nearby
# Verifies proxy of adsb.lol + airline logo resolution, radius clamping, and
# validation errors.
import os
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") if os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL"
) else None

if not BASE_URL:
    # Read from frontend .env directly, since backend .env has no public URL
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Accept": "application/json"})
    return s


# --- happy path near JFK ---
class TestFlightsNearby:
    def test_jfk_returns_flights_shape(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413, "lon": -73.7781, "radius": 25},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(["count", "flights", "center", "radiusMiles"]).issubset(body)
        assert body["radiusMiles"] == 25
        assert body["center"] == {"lat": 40.6413, "lon": -73.7781}
        assert isinstance(body["flights"], list)
        assert len(body["flights"]) <= 15
        # Every flight must have a non-empty callsign
        for f in body["flights"]:
            assert f["callsign"] and isinstance(f["callsign"], str)
            # If an airline resolved, logo must be gstatic + IATA
            if f.get("airline"):
                assert f["iata"] and len(f["iata"]) == 2
                assert (
                    f["logo"]
                    == f"https://www.gstatic.com/flights/airline_logos/70px/{f['iata']}.png"
                )

    def test_jfk_sorted_by_distance_ascending(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413, "lon": -73.7781, "radius": 25},
            timeout=15,
        )
        assert r.status_code == 200
        flights = r.json()["flights"]
        # None distances would be sorted last (as 9999). Verify monotonic
        # non-decreasing over non-None values.
        dists = [f["distance"] if f["distance"] is not None else 9999 for f in flights]
        assert dists == sorted(dists), f"flights not sorted: {dists}"

    def test_jfk_capped_at_15(self, api):
        # Near JFK there should be way more than 15 aircraft, so cap must apply
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413, "lon": -73.7781, "radius": 100},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert len(body["flights"]) <= 15
        # count is the total server-side count before slicing
        assert body["count"] >= len(body["flights"])


# --- radius clamping ---
class TestRadiusClamping:
    def test_huge_radius_still_200(self, api):
        # 1000mi -> ~869nm, clamped to 250nm max; must not 5xx
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413, "lon": -73.7781, "radius": 1000},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["radiusMiles"] == 1000  # echoes the input
        assert isinstance(body["flights"], list)

    def test_tiny_radius_still_200(self, api):
        # 0.5mi -> ~0.4nm, clamped up to 1nm min; must not 5xx
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413, "lon": -73.7781, "radius": 0.5},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["radiusMiles"] == 0.5
        assert isinstance(body["flights"], list)


# --- low-traffic coordinate ---
class TestLowTraffic:
    def test_null_island_returns_200(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 0, "lon": 0, "radius": 25},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body["flights"], list)
        # Empty or small list — both are valid PASS
        assert len(body["flights"]) <= 15


# --- validation ---
class TestValidation:
    def test_missing_lat_returns_422(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lon": -73.7781},
            timeout=10,
        )
        assert r.status_code == 422

    def test_missing_lon_returns_422(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": 40.6413},
            timeout=10,
        )
        assert r.status_code == 422

    def test_invalid_lat_returns_422(self, api):
        r = api.get(
            f"{BASE_URL}/api/flights/nearby",
            params={"lat": "abc", "lon": -73.7781},
            timeout=10,
        )
        assert r.status_code == 422
