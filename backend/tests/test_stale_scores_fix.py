"""Backend tests for the 'stale score' bug fix in _team_status_one().

Bug: /api/teams/status?teams=MLB:NYY was returning highlight='recent' with a
Final 0-0 for a postponed / day-old MLB game. The fix requires a genuine final
score AND the game to have completed within ~14 hours; otherwise the score
must be cleared and the highlight downgraded (today/soon/upcoming/offseason).

These tests hit the LIVE preview URL and validate SHAPES + INVARIANTS rather
than exact labels (ESPN nextEvent flaps between empty and stale). Regression
coverage: weather_current, device/folly, device/lake, device/scores shape.
"""
import os
import pytest
import requests

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://bluetooth-led-sync.preview.emergentagent.com",
).rstrip("/")

VALID_HIGHLIGHTS = {
    "live", "today", "soon", "upcoming", "recent", "offseason", "none",
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "pytest-stale-scores/1.0"})
    return s


# -------------------- BUG 1: /api/teams/status stale-score fix --------------------
class TestTeamsStatusStaleScoresFix:
    def test_nyy_no_stale_zero_zero_final(self, api):
        r = api.get(f"{BASE_URL}/api/teams/status", params={"teams": "MLB:NYY"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "results" in body and len(body["results"]) == 1
        row = body["results"][0]
        # Shape invariants
        for k in ("team", "highlight", "label", "score", "oppScore"):
            assert k in row, f"missing key {k}"
        assert row["team"] == "MLB:NYY"
        assert row["highlight"] in VALID_HIGHLIGHTS, row["highlight"]

        # Core invariant: NEVER surface a Final 0-0 as 'recent'.
        if row["highlight"] == "recent":
            assert row["score"] is not None and row["oppScore"] is not None, (
                "recent must have real scores"
            )
            assert not (row["score"] == 0 and row["oppScore"] == 0), (
                "0-0 final is stale/postponed data, must not be 'recent'"
            )
            label = (row.get("label") or "").lower()
            assert "final" in label, f"'recent' label should contain 'Final': {label}"
        else:
            # For any non-recent state on NYY, scores must be null (never 0-0).
            assert row["score"] is None, f"score must be None when h={row['highlight']}"
            assert row["oppScore"] is None, f"oppScore must be None when h={row['highlight']}"

    def test_nyy_record_present_when_offseason(self, api):
        """When ESPN has no live/recent game the response should still expose
        the team's record so the UI can show '/W-L' badge."""
        r = api.get(f"{BASE_URL}/api/teams/status", params={"teams": "MLB:NYY"}, timeout=15)
        assert r.status_code == 200
        row = r.json()["results"][0]
        # record is optional but if highlight is offseason/upcoming it usually exists
        assert "record" in row  # key must always be present

    def test_multi_team_status_shape(self, api):
        """Multiple teams request returns a well-shaped list without crashing."""
        r = api.get(
            f"{BASE_URL}/api/teams/status",
            params={"teams": "MLB:NYY|NFL:DAL|NBA:LAL"},
            timeout=20,
        )
        assert r.status_code == 200
        results = r.json()["results"]
        assert len(results) == 3
        for row in results:
            assert row["highlight"] in VALID_HIGHLIGHTS
            # score/oppScore consistency: either both numbers or both null
            s, o = row["score"], row["oppScore"]
            assert (s is None) == (o is None), f"score/oppScore mismatch: {row}"
            # NEVER Final 0-0 recent
            if row["highlight"] == "recent":
                assert not (s == 0 and o == 0)


# -------------------- BUG 1 companion: /api/device/scores --------------------
class TestDeviceScoresStaleFix:
    def test_nyy_device_scores_not_stale_recent(self, api):
        r = api.get(f"{BASE_URL}/api/device/scores", params={"teams": "MLB:NYY"}, timeout=15)
        assert r.status_code == 200
        body = r.json()
        assert "t" in body and len(body["t"]) == 1
        row = body["t"][0]
        # Compact shape: c, s, o, h, l, r
        for k in ("c", "s", "o", "h", "l", "r"):
            assert k in row, f"missing compact key {k}"
        assert row["c"] == "MLB:NYY"
        assert row["h"] in VALID_HIGHLIGHTS

        # Bug-specific: the on-device SCORES module renders only h in {live,recent}
        # so a stale postponed game must NOT come through as recent with 0-0.
        if row["h"] == "recent":
            assert row["s"] is not None and row["o"] is not None
            assert not (row["s"] == 0 and row["o"] == 0), (
                "device/scores must not surface a stale 0-0 as recent"
            )
        else:
            # Non-recent → s/o null so on-device module ignores the row.
            assert row["s"] is None and row["o"] is None

    def test_multi_team_device_scores_shape(self, api):
        r = api.get(
            f"{BASE_URL}/api/device/scores",
            params={"teams": "MLB:NYY|NFL:DAL"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("t"), list) and len(body["t"]) == 2
        for row in body["t"]:
            for k in ("c", "s", "o", "h", "l", "r"):
                assert k in row
            assert row["h"] in VALID_HIGHLIGHTS
            # No stray unicode red-circle in label (device wants ASCII).
            assert isinstance(row["l"], str)
            assert "🔴" not in row["l"]

    def test_live_or_recent_path_still_structurally_valid(self, api):
        """Regression: if ANY tested team currently has a live/recent game the
        code path still yields a valid, non-crashing response with real scores.
        If nothing is live/recent right now, this test just confirms shapes."""
        r = api.get(
            f"{BASE_URL}/api/device/scores",
            params={"teams": "MLB:NYY|NFL:DAL|NBA:LAL|NHL:BOS"},
            timeout=25,
        )
        assert r.status_code == 200
        rows = r.json()["t"]
        for row in rows:
            if row["h"] in ("live", "recent"):
                assert row["s"] is not None
                assert row["o"] is not None


# -------------------- REGRESSION: weather / folly / lake --------------------
class TestRegressionEndpoints:
    def test_weather_current(self, api):
        r = api.get(
            f"{BASE_URL}/api/weather/current",
            params={"lat": 35.5841, "lon": -80.8685},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        for k in ("temp", "code", "text", "hi", "lo"):
            assert k in body, f"missing weather key {k}"
        assert body["temp"] is not None, "temp must not be None on live call"
        assert isinstance(body["temp"], (int, float))
        # Sanity range for NC weather in Fahrenheit
        assert -20 <= body["temp"] <= 120

    def test_device_folly(self, api):
        r = api.get(f"{BASE_URL}/api/device/folly", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("e", "w", "dir"):
            assert k in body, f"missing folly key {k}"
        assert body["dir"] in ("in", "out", None)
        assert isinstance(body["e"], list)
        for ev in body["e"]:
            for k in ("y", "t", "v"):
                assert k in ev
            assert ev["y"] in ("H", "L")

    def test_device_lake(self, api):
        r = api.get(f"{BASE_URL}/api/device/lake", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("lvl", "tgt", "full", "w"):
            assert k in body, f"missing lake key {k}"
        # lvl/full should typically be numeric; allow None if Duke feed is down
        if body["lvl"] is not None:
            assert isinstance(body["lvl"], (int, float))
            assert isinstance(body["full"], (int, float))


# -------------------- Unit-level check on _hours_since helper --------------------
class TestHoursSinceHelper:
    def test_hours_since_future_negative(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _hours_since  # noqa: WPS433

        # 24h in the future
        from datetime import datetime, timezone, timedelta
        future = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat().replace(
            "+00:00", "Z"
        )
        hrs = _hours_since(future)
        assert hrs is not None and hrs < 0

    def test_hours_since_past_positive(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _hours_since  # noqa: WPS433

        from datetime import datetime, timezone, timedelta
        past = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat().replace(
            "+00:00", "Z"
        )
        hrs = _hours_since(past)
        assert hrs is not None and hrs > 24, f"expected >24, got {hrs}"

    def test_hours_since_bad_input_none(self):
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _hours_since  # noqa: WPS433

        assert _hours_since("not-a-date") is None
