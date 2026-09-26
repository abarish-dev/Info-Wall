# Tests for the ticker verify + TV search/status catalog endpoints
# GET /api/tickers/verify, /api/tv/search, /api/tv/status
import os
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get(
    "EXPO_BACKEND_URL"
)
if not BASE_URL:
    # Fallback to reading frontend .env (public URL used by the app)
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


# --------- Ticker verify ----------
class TestTickerVerify:
    def test_valid_and_invalid_mix(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/verify",
            params={"symbols": "AAPL,ZZZZZ,VOO,tsla"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "results" in data
        results = data["results"]
        by_sym = {r_["symbol"]: r_ for r_ in results}
        # Uppercased & deduped: tsla -> TSLA, expect 4 unique
        assert set(by_sym.keys()) == {"AAPL", "ZZZZZ", "VOO", "TSLA"}
        # Valid ones
        for sym in ("AAPL", "VOO", "TSLA"):
            entry = by_sym[sym]
            assert entry["valid"] is True, f"{sym} should be valid: {entry}"
            assert entry["name"], f"{sym} should have a name"
        # Invalid one
        assert by_sym["ZZZZZ"]["valid"] is False

    def test_dedup_preserves_order(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/verify",
            params={"symbols": "AAPL,aapl,AAPL"},
            timeout=20,
        )
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 1
        assert results[0]["symbol"] == "AAPL"

    def test_empty_symbols(self, api):
        r = api.get(
            f"{BASE_URL}/api/tickers/verify",
            params={"symbols": ""},
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json() == {"results": []}


# --------- TV search ----------
class TestTvSearch:
    def test_basic_search(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/search",
            params={"q": "shrinking"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert isinstance(results, list)
        assert len(results) > 0
        # Verify expected fields exist on at least one row
        keys = {"id", "name", "year", "status", "network", "image", "imdb"}
        assert keys.issubset(results[0].keys())
        # Expect "Shrinking" to be among top results
        names = [x["name"].lower() for x in results]
        assert any("shrinking" in n for n in names)

    def test_gibberish_search_returns_empty(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/search",
            params={"q": "zzqqxxvvnothingatall1234"},
            timeout=20,
        )
        assert r.status_code == 200
        assert r.json()["results"] == []

    def test_empty_query(self, api):
        # Endpoint requires q param (FastAPI), so this should 422
        # But per spec: empty q should still return 200 with empty list.
        # Server accepts empty string via ?q=
        r = api.get(f"{BASE_URL}/api/tv/search", params={"q": ""}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["results"] == []


# --------- TV status ----------
class TestTvStatus:
    def test_status_mix(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/status",
            params={"names": "Ted Lasso|Breaking Bad|NotARealShowXYZ"},
            timeout=25,
        )
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert len(results) == 3
        by_name = {x["name"]: x for x in results}
        # Breaking Bad -> ended
        bb = by_name["Breaking Bad"]
        assert bb["highlight"] == "ended", bb
        assert bb["status"] in ("Ended", None) or bb["status"] == "Ended"
        # Unknown -> highlight == unknown
        unk = by_name["NotARealShowXYZ"]
        assert unk["highlight"] == "unknown", unk
        # Ted Lasso -> any of new/soon/returning/between/ended (has a valid label type)
        tl = by_name["Ted Lasso"]
        assert tl["highlight"] in {
            "new", "soon", "returning", "between", "ended", "none",
        }, tl

    def test_empty_names(self, api):
        r = api.get(
            f"{BASE_URL}/api/tv/status", params={"names": ""}, timeout=10
        )
        assert r.status_code == 200
        assert r.json()["results"] == []
