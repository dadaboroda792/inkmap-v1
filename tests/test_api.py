import pytest
from fastapi.testclient import TestClient

import server as server_mod


@pytest.fixture()
def client(tmp_path, monkeypatch):
    data = tmp_path / "data"
    imgs = data / "images"
    media = data / "media"
    data.mkdir()
    imgs.mkdir()
    media.mkdir()
    monkeypatch.setattr(server_mod, "DATA_DIR", data)
    monkeypatch.setattr(server_mod, "IMAGES_DIR", imgs)
    monkeypatch.setattr(server_mod, "MEDIA_DIR", media)
    with TestClient(server_mod.app) as c:
        yield c


def test_create_list_get(client):
    r = client.post("/api/maps", json={"name": "Проект"})
    assert r.status_code == 200
    r = client.get("/api/maps")
    assert r.json() == {"maps": ["Проект"]}
    raw = client.get("/api/maps/Проект")
    assert raw.status_code == 200
    assert raw.json()["nodes"] == []


def test_create_duplicate_conflict(client):
    client.post("/api/maps", json={"name": "a"})
    assert client.post("/api/maps", json={"name": "a"}).status_code == 409


@pytest.mark.parametrize("bad", ["", "   ", "..", ".", "../evil", "a/b"])
def test_create_invalid_names(client, bad):
    assert client.post("/api/maps", json={"name": bad}).status_code == 400


@pytest.mark.parametrize("bad", ["CON", "con", "NUL", "COM1", "lpt3", "CON.txt"])
def test_create_windows_reserved_names(client, bad):
    assert client.post("/api/maps", json={"name": bad}).status_code == 400


def test_trailing_dots_stripped(client):
    assert client.post("/api/maps", json={"name": "name."}).json()["name"] == "name"


def test_save_roundtrip_with_strokes(client):
    client.post("/api/maps", json={"name": "rt"})
    payload = {
        "version": 1,
        "meta": {"author": "test"},
        "nodes": [{"id": "n1", "x": 10, "y": 20, "title": "A"}],
        "edges": [{"id": "e1", "from": "n1", "to": "n2", "label": "связь"}],
        "strokes": [{"id": "s1", "points": [[0, 0], [5, 5]], "color": "#8a93a6", "width": 2.5}],
    }
    assert client.put("/api/maps/rt", json=payload).status_code == 200
    got = client.get("/api/maps/rt").json()
    assert got["nodes"] == payload["nodes"]
    assert got["edges"] == payload["edges"]
    assert got["strokes"] == payload["strokes"]
    assert got["meta"] == {"author": "test"}


def test_rename_and_conflicts(client):
    client.post("/api/maps", json={"name": "old"})
    client.post("/api/maps", json={"name": "taken"})
    assert client.put("/api/maps/old/rename", json={"newName": "new"}).status_code == 200
    assert client.put("/api/maps/new/rename", json={"newName": "taken"}).status_code == 409


def test_delete(client):
    client.post("/api/maps", json={"name": "del"})
    assert client.delete("/api/maps/del").status_code == 200
    assert client.delete("/api/maps/del").status_code == 404


def test_missing_map_404(client):
    assert client.get("/api/maps/nope").status_code == 404
    scene = {"nodes": [], "edges": [], "strokes": []}
    assert client.put("/api/maps/nope", json=scene).status_code == 404


def test_corrupted_json_500(client, tmp_path):
    client.post("/api/maps", json={"name": "bad"})
    import server as sm
    (sm.DATA_DIR / "bad.json").write_text("{oops", encoding="utf-8")
    assert client.get("/api/maps/bad").status_code == 500


def test_image_upload_ok(client):
    png = b"\x89PNG\r\n\x1a\nfake"
    r = client.post("/api/images", files={"file": ("s.png", png, "image/png")})
    assert r.status_code == 200
    url = r.json()["url"]
    fname = url.rsplit("/", 1)[1]
    import server as sm
    assert (sm.IMAGES_DIR / fname).read_bytes() == png


def test_image_bad_ext(client):
    r = client.post("/api/images", files={"file": ("e.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 400


def test_media_upload_ok(client):
    audio = b"\x1a\x45\xdf\xa3fake-webm"
    r = client.post("/api/media", files={"file": ("v.webm", audio, "audio/webm")})
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("/media/")
    fname = url.rsplit("/", 1)[1]
    import server as sm
    assert (sm.MEDIA_DIR / fname).read_bytes() == audio


def test_media_bad_ext(client):
    r = client.post("/api/media", files={"file": ("v.exe", b"MZ", "application/octet-stream")})
    assert r.status_code == 400


def test_media_too_big(client):
    big = b"x" * (25 * 1024 * 1024 + 1)
    r = client.post("/api/media", files={"file": ("v.mp3", big, "audio/mpeg")})
    assert r.status_code == 400
