import os, importlib
from fastapi.testclient import TestClient


def _client(tmp_path, monkeypatch):
    monkeypatch.setenv("FAMILY_MSG_FILE", str(tmp_path / "fam.json"))
    monkeypatch.setenv("FAMILY_WRITE_TOKEN", "t")
    for k in ("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL"):
        monkeypatch.delenv(k, raising=False)
    import daily, server
    importlib.reload(daily); importlib.reload(server)
    return TestClient(server.app)


def test_set_then_clear(tmp_path, monkeypatch):
    c = _client(tmp_path, monkeypatch)
    h = {"X-Family-Token": "t"}
    assert c.post("/api/family", json={"text": "Hi Mom", "sender": "Adam"}, headers=h).status_code == 200
    assert c.get("/api/family").json()["text"] == "Hi Mom"
    assert c.delete("/api/family", headers={"X-Family-Token": "bad"}).status_code == 401
    assert c.delete("/api/family", headers=h).status_code == 200
    assert c.get("/api/family").json() == {}
    c.post("/api/family", json={"text": "x"}, headers=h)
    assert c.post("/api/family", json={"text": "  "}, headers=h).json() == {}
    assert c.get("/api/family").json() == {}
