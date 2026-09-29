"""Backend tests for the NEW postseason-schedule fallback fix.

Bug (this iteration): /api/teams/status?teams=MLB:NYY was returning
highlight='offseason', label='No games scheduled' because ESPN's team-endpoint
`nextEvent` field is empty during the regular-season->postseason gap, or points
at an already-final regular-season game. The fix adds
_next_event_from_schedule() which consults ESPN's teams/{abbr}/schedule
endpoint (includes seasonType=3 postseason: MLB playoffs, NBA/NHL playoffs,
NFL playoffs, Super Bowl, World Series) and returns the live game, the
soonest upcoming game, or a final within ~14h.

Invariants asserted (NOT specific opponents/dates — those shift daily):
 - No in-season/postseason team returns highlight='offseason'.
 - highlight is one of live|today|soon|upcoming|recent (or 'none' — never 'offseason').
 - score/oppScore are BOTH null for upcoming, or BOTH numeric for live/recent.
 - No team surfaces highlight='recent' with 0-0 (postponed leaks) or a game
   older than ~14h.
 - /api/device/scores compact shape mirrors the fix (no stale 'recent' 0-0).

Regression (200 + valid JSON):
 - /api/weather/current?lat=35.5841&lon=-80.8685
 - /api/device/folly
 - /api/device/lake
"""
import os
import sys
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")

# Highlights the fix should produce for in-season/postseason teams.
# 'offseason' MUST NOT appear when the schedule endpoint has a future game.
IN_SEASON_HIGHLIGHTS = {"live", "today", "soon", "upcoming", "recent"}
ALL_VALID = IN_SEASON_HIGHLIGHTS | {"offseason", "none"}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"User-Agent": "pytest-postseason-fix/1.0"})
    return s


def _get_status(api, teams: str) -> list:
    r = api.get(
        f"{BASE_URL}/api/teams/status", params={"teams": teams}, timeout=25
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "results" in body and isinstance(body["results"], list)
    return body["results"]


# -------------------- BUG FIX: postseason schedule fallback --------------------
class TestPostseasonScheduleFix:
    def test_nyy_not_offseason_has_upcoming_or_live(self, api):
        """MLB:NYY (in MLB postseason as of the simulated 2026-09-29 clock)
        MUST NOT return offseason/No games scheduled. It should surface a
        live/today/soon/upcoming/recent game via the schedule endpoint."""
        rows = _get_status(api, "MLB:NYY")
        assert len(rows) == 1
        row = rows[0]
        assert row["team"] == "MLB:NYY"
        assert row["highlight"] in ALL_VALID, row["highlight"]
        assert row["highlight"] in IN_SEASON_HIGHLIGHTS, (
            f"NYY should have a scheduled/live postseason game, got "
            f"highlight={row['highlight']} label={row.get('label')!r}"
        )
        # Label must not be the offseason sentinel.
        label = (row.get("label") or "").lower()
        assert "no games scheduled" not in label, row

    def test_nfl_dal_not_offseason(self, api):
        """NFL:DAL previously showed offseason because its nextEvent held a
        stale Final. It should now show its next scheduled game."""
        rows = _get_status(api, "NFL:DAL")
        row = rows[0]
        assert row["highlight"] in IN_SEASON_HIGHLIGHTS, (
            f"NFL:DAL should NOT be offseason: {row}"
        )
        # Sanity: an upcoming label starts with a date or 'Today', not the
        # offseason sentinel.
        assert "no games scheduled" not in (row.get("label") or "").lower()

    @pytest.mark.parametrize(
        "team",
        ["MLB:NYY", "MLB:LAD", "NFL:DAL", "NFL:KC", "NBA:LAL", "NHL:BOS"],
    )
    def test_each_in_season_team_has_a_game(self, api, team):
        """Each of these teams is in-season/postseason per the simulated
        2026-09-29 clock. None should incorrectly show offseason."""
        rows = _get_status(api, team)
        row = rows[0]
        assert row["team"] == team
        assert row["highlight"] in ALL_VALID
        assert row["highlight"] != "offseason", (
            f"{team} unexpectedly offseason: label={row.get('label')!r}"
        )
        assert row["highlight"] != "none", (
            f"{team} returned 'none' (no data) — should have surfaced a game"
        )

    def test_multi_team_shape_and_score_consistency(self, api):
        """Bulk call — validate shape, highlight enum, and the score/oppScore
        pairing invariant (both null OR both numeric)."""
        rows = _get_status(
            api, "MLB:NYY|MLB:LAD|NFL:DAL|NFL:KC|NBA:LAL|NHL:BOS"
        )
        assert len(rows) == 6
        for row in rows:
            for k in ("team", "highlight", "label", "score", "oppScore", "record"):
                assert k in row, f"missing key {k} in {row}"
            assert row["highlight"] in ALL_VALID
            s, o = row["score"], row["oppScore"]
            # Both null (upcoming/today/soon/offseason) OR both numeric (live/recent)
            assert (s is None) == (o is None), (
                f"score/oppScore mismatch on {row['team']}: s={s} o={o}"
            )
            if row["highlight"] in ("live", "recent"):
                assert isinstance(s, int) and isinstance(o, int), row
            if row["highlight"] in ("today", "soon", "upcoming", "offseason"):
                assert s is None and o is None, row


# -------------------- INVARIANT: no stale 'recent' anywhere --------------------
class TestStaleGameInvariant:
    @pytest.mark.parametrize(
        "team",
        ["MLB:NYY", "MLB:LAD", "NFL:DAL", "NFL:KC", "NBA:LAL", "NHL:BOS"],
    )
    def test_never_recent_zero_zero(self, api, team):
        row = _get_status(api, team)[0]
        if row["highlight"] == "recent":
            s, o = row["score"], row["oppScore"]
            assert s is not None and o is not None, row
            assert not (s == 0 and o == 0), (
                f"{team}: stale/postponed 0-0 leaked as 'recent': {row}"
            )
            # 'Final' must appear in the label for a recent completed game.
            assert "final" in (row.get("label") or "").lower(), row

    def test_recent_game_within_14h_window(self, api):
        """If any team is 'recent', its date must be within ~14h. Uses the
        server's own _hours_since helper as source-of-truth."""
        sys.path.insert(0, "/app/backend")
        from server import _hours_since  # noqa: WPS433

        rows = _get_status(
            api, "MLB:NYY|MLB:LAD|NFL:DAL|NFL:KC|NBA:LAL|NHL:BOS"
        )
        for row in rows:
            if row["highlight"] != "recent":
                continue
            date = row.get("date")
            assert date, f"recent row missing date: {row}"
            hrs = _hours_since(date)
            assert hrs is not None
            assert 0 <= hrs <= 14, (
                f"{row['team']} 'recent' but game is {hrs:.1f}h old — should "
                f"have fallen back to next scheduled game"
            )


# -------------------- /api/device/scores compact shape --------------------
class TestDeviceScoresShape:
    def test_device_scores_shape_and_no_stale_recent(self, api):
        r = api.get(
            f"{BASE_URL}/api/device/scores",
            params={"teams": "MLB:NYY|NFL:DAL"},
            timeout=20,
        )
        assert r.status_code == 200
        body = r.json()
        assert isinstance(body.get("t"), list) and len(body["t"]) == 2
        for row in body["t"]:
            # Compact keys: c (code), s (score), o (oppScore), h (highlight), l (label), r (record)
            for k in ("c", "s", "o", "h", "l", "r"):
                assert k in row, f"missing compact key {k}: {row}"
            assert row["h"] in ALL_VALID
            # No unicode red circle should leak into the on-device label.
            assert isinstance(row["l"], str)
            assert "\U0001f534" not in row["l"] and "🔴" not in row["l"]

            # Score/oppScore pairing invariant.
            s, o = row["s"], row["o"]
            if row["h"] in ("today", "soon", "upcoming", "offseason", "none"):
                assert s is None and o is None, row
                assert row["h"] != "recent"
            if row["h"] in ("live", "recent"):
                assert isinstance(s, int) and isinstance(o, int), row
                # Never a stale 0-0 recent.
                if row["h"] == "recent":
                    assert not (s == 0 and o == 0), row

    def test_device_scores_nyy_not_offseason(self, api):
        r = api.get(
            f"{BASE_URL}/api/device/scores",
            params={"teams": "MLB:NYY"},
            timeout=15,
        )
        assert r.status_code == 200
        row = r.json()["t"][0]
        assert row["c"] == "MLB:NYY"
        # After the fix NYY has a scheduled postseason game.
        assert row["h"] != "offseason", row


# -------------------- REGRESSION: unrelated endpoints still healthy --------------------
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
            assert k in body
        assert body["temp"] is not None, "temp must not be None on a live call"
        assert isinstance(body["temp"], (int, float))
        assert -20 <= body["temp"] <= 120

    def test_device_folly_shape(self, api):
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

    def test_device_lake_shape(self, api):
        r = api.get(f"{BASE_URL}/api/device/lake", timeout=15)
        assert r.status_code == 200
        body = r.json()
        for k in ("lvl", "tgt", "full", "w"):
            assert k in body


# -------------------- Unit: _next_event_from_schedule works live --------------------
class TestNextEventFromSchedule:
    def test_helper_returns_event_for_nyy(self):
        """Direct call to the new helper — should return a non-None event
        with a competitions[0].date since NYY has scheduled postseason games."""
        sys.path.insert(0, "/app/backend")
        from server import _next_event_from_schedule  # noqa: WPS433

        ev = _next_event_from_schedule("baseball", "mlb", "NYY")
        assert ev is not None, (
            "schedule endpoint should have returned a postseason event for NYY"
        )
        assert ev.get("date"), ev
        comp = (ev.get("competitions") or [{}])[0]
        state = ((comp.get("status") or {}).get("type") or {}).get("state")
        assert state in ("pre", "in", "post"), state

    def test_helper_returns_event_for_dal(self):
        sys.path.insert(0, "/app/backend")
        from server import _next_event_from_schedule  # noqa: WPS433

        ev = _next_event_from_schedule("football", "nfl", "DAL")
        assert ev is not None
        assert ev.get("date")
