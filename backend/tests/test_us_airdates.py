"""US-first TV air dates: origin detection, override projection and expiry."""
from datetime import date

import server


def test_us_origin_detection():
    assert server._is_us_origin({"webChannel": {"name": "Apple TV", "country": None}})
    assert server._is_us_origin({"network": {"name": "PBS", "country": {"code": "US"}}})
    assert not server._is_us_origin({"network": {"name": "Channel 5", "country": {"code": "GB"}}})


def test_acgas_override_weekly_and_expiry(monkeypatch):
    monkeypatch.setattr(server, "_season_episode_count", lambda sid, s: 6)
    ov = server._us_override_dates(42836, today=date(2026, 10, 10))
    assert ov["run"]["network"] == "PBS" and ov["run"]["time"] == "21:00"
    assert ov["dates"] == ["2027-01-17", "2027-01-24", "2027-01-31",
                           "2027-02-07", "2027-02-14", "2027-02-21"]
    # still active through 3 days after the finale, gone after that
    assert server._us_override_dates(42836, today=date(2027, 2, 24))
    assert server._us_override_dates(42836, today=date(2027, 2, 25)) is None


def test_no_override_for_other_shows():
    for sid in (58323, 41632, 44458, 77060, 73127, 8090):
        assert server._us_override_dates(sid) is None


def test_label_rules(monkeypatch):
    days = {"a": 0, "b": 5, "c": 98, "p": -2, "q": -10}
    monkeypatch.setattr(server, "_days_from_today", lambda iso: days[iso])
    monkeypatch.setattr(server, "_fmt_date", lambda iso: iso.upper())
    assert server._label_for("a", None, "Running")[:2] == ("new", "New episode today!")
    assert server._label_for("b", None, "Running")[:2] == ("soon", "New episode B")
    assert server._label_for("c", None, "Running")[:2] == ("returning", "Returns C")
    assert server._label_for(None, "p", "Running")[0] == "new"
    assert server._label_for(None, "q", "Running")[0] == "between"
    assert server._label_for(None, "q", "Ended")[0] == "ended"
