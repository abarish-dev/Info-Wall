"""Markets page is suppressed on Sat/Sun US Eastern (empty list hides the page)."""
from datetime import datetime, timezone
import server


def _utc(y, m, d, h, mi=0):
    return datetime(y, m, d, h, mi, tzinfo=timezone.utc)


def test_weekend_detection_uses_eastern():
    assert not server._markets_weekend_closed(_utc(2026, 10, 16, 20))   # Fri 4pm ET
    assert not server._markets_weekend_closed(_utc(2026, 10, 17, 3, 59))  # Fri 11:59pm ET
    assert server._markets_weekend_closed(_utc(2026, 10, 17, 4, 0))     # Sat 00:00 ET
    assert server._markets_weekend_closed(_utc(2026, 10, 18, 20))       # Sun 4pm ET
    assert server._markets_weekend_closed(_utc(2026, 10, 19, 3, 59))    # Sun 11:59pm ET
    assert not server._markets_weekend_closed(_utc(2026, 10, 19, 4, 0))  # Mon 00:00 ET


def test_endpoint_empty_on_weekend(monkeypatch):
    monkeypatch.setattr(server, "_markets_weekend_closed", lambda now=None: True)
    assert server.device_markets() == {"st": "Closed", "m": []}
