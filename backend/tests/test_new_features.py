# Tests for the NEW iteration endpoints:
#   GET /api/tickers/quotes    -- live stock quotes
#   GET /api/tv/episodes       -- upcoming/recent episodes + seasons
#   GET /api/teams/status      -- team next/live game highlights
#   GET /api/tv/status         -- must now include an 'id' field
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    _env_path = "/app/frontend/.env"
    with open(_env_path) as _f:
        for _line in _f:
            if _line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = _line.split("=", 1)[1].strip().strip('"')
                break
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL missing"
BASE_URL = BASE_URL.rstrip("/")


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "pytest/1.0"})
    return s


# ---------- Stock quotes ----------
class TestTickerQuotes:
    def test_valid_quote_shape(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/quotes",
            params={"symbols": "AAPL,TSLA"},
            timeout=25,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        by_sym = {x["symbol"]: x for x in results}
        assert set(by_sym.keys()) == {"AAPL", "TSLA"}
        for sym in ("AAPL", "TSLA"):
            q = by_sym[sym]
            # Required keys present
            for k in ("symbol", "price", "prevClose", "change", "changePct", "currency"):
                assert k in q, f"{sym} missing {k}: {q}"
            # Price is numeric for valid symbols
            assert isinstance(q["price"], (int, float)), f"{sym} price not numeric: {q}"
            assert q["price"] > 0
            assert isinstance(q["changePct"], (int, float))
            assert q["currency"]

    def test_dedup_uppercase(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/quotes",
            params={"symbols": "aapl,AAPL,AaPl"},
            timeout=20,
        )
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 1
        assert results[0]["symbol"] == "AAPL"

    def test_empty_symbols(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/quotes",
            params={"symbols": ""},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"results": []}


# ---------- TV episodes ----------
class TestTvEpisodes:
    def test_valid_show(self, api):
        # 44458 = Ted Lasso on TVmaze (per test spec)
        r = api.get(
            f"{BASE_URL}/api/tv/episodes",
            params={"id": 44458},
            timeout=25,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        for k in ("name", "status", "network", "seasons", "totalEpisodes", "upcoming", "recent"):
            assert k in data, f"missing {k}: {data.keys()}"
        assert data["name"], data
        assert isinstance(data["seasons"], int) and data["seasons"] > 0
        assert isinstance(data["totalEpisodes"], int) and data["totalEpisodes"] > 0
        assert isinstance(data["upcoming"], list)
        assert isinstance(data["recent"], list)
        # If recent episodes exist, verify shape
        if data["recent"]:
            ep = data["recent"][0]
            for k in ("season", "number", "name", "airdate"):
                assert k in ep

    def test_invalid_show_returns_404(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/episodes",
            params={"id": 999999999},
            timeout=20,
        )
        assert r.status_code == 404, f"expected 404 not {r.status_code}: {r.text}"


# ---------- Team status ----------
class TestTeamsStatus:
    _VALID_HL = {
        "live", "today", "soon", "upcoming", "recent", "offseason", "none",
    }

    def test_valid_teams_shape(self, api):
        r = api.get(
            f"{BASE_URL}/api/teams/status",
            params={"teams": "MLB:NYY|NFL:CAR"},
            timeout=25,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert len(results) == 2
        for row in results:
            for k in ("team", "name", "logo", "highlight", "label", "opponent", "date"):
                assert k in row, f"missing {k}: {row}"
            assert row["highlight"] in self._VALID_HL, row
            # Real team responses should give us a display name + logo
            assert row["name"], row
            assert row["logo"], row

    def test_malformed_code_no_500(self, api):
        r = api.get(
            f"{BASE_URL}/api/teams/status",
            params={"teams": "XXX:ZZZ"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert len(results) == 1
        assert results[0]["highlight"] == "none"

    def test_missing_colon_no_500(self, api):
        r = api.get(
            f"{BASE_URL}/api/teams/status",
            params={"teams": "NOCOLON"},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert len(results) == 1
        assert results[0]["highlight"] == "none"


# ---------- TV status now returns 'id' ----------
class TestTvStatusIdField:
    def test_id_field_present(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/status",
            params={"names": "Ted Lasso"},
            timeout=25,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert len(results) == 1
        row = results[0]
        assert "id" in row, f"'id' missing: {row}"
        # For a real show, id must be an int
        assert isinstance(row["id"], int), f"'id' not int: {row}"
        assert row["id"] > 0
