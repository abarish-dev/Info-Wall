import server


def test_icon_mapping():
    m = {0: "sun", 1: "sun", 2: "partly", 3: "cloud", 45: "cloud", 61: "rain",
         81: "rain", 66: "rain", 71: "snow", 86: "snow", 95: "storm", 99: "storm", None: "cloud"}
    for code, icon in m.items():
        assert server._wx_icon(code) == icon


def test_forecast_skips_today():
    daily = {"time": ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"],
             "temperature_2m_max": [75.2, 76.4, 84.0, 86.1],
             "temperature_2m_min": [64.0, 61.2, 56.3, 60.9],
             "weather_code": [2, 3, 3, 0]}
    assert server._forecast_days(daily) == [
        {"d": "Mon", "i": "cloud", "h": 76, "l": 61},
        {"d": "Tue", "i": "cloud", "h": 84, "l": 56},
        {"d": "Wed", "i": "sun", "h": 86, "l": 61}]
