"""Smoke tests for the cut-out service. They replace the model with a stub, so they need fastapi, httpx, pillow and
pytest but not rembg or the model weights:

    pip install fastapi httpx pillow pytest
    pytest services/cutout
"""

import io
import os

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app as cutout_app


def png_bytes(size=(64, 64), color=(200, 50, 50, 255)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def stub_model(monkeypatch):
    def fake(image):
        out = image.convert("RGBA")
        px = out.load()
        for x in range(out.width):
            px[x, 0] = (0, 0, 0, 0)  # one transparent row, so the alpha channel is visibly used
        return out

    monkeypatch.setattr(cutout_app, "remove_background", fake)
    monkeypatch.delenv("CUTOUT_TOKEN", raising=False)


client = TestClient(cutout_app.app)


def test_health():
    assert client.get("/healthz").json() == {"ok": True}


def test_returns_png_with_alpha():
    res = client.post("/cutout", content=png_bytes(), headers={"content-type": "application/octet-stream"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    out = Image.open(io.BytesIO(res.content))
    assert out.mode == "RGBA"
    assert out.getpixel((0, 0))[3] == 0
    assert out.getpixel((10, 10))[3] == 255


def test_rejects_empty_and_non_images():
    assert client.post("/cutout", content=b"").status_code == 400
    assert client.post("/cutout", content=b"not an image").status_code == 415


def test_rejects_too_large(monkeypatch):
    monkeypatch.setattr(cutout_app, "MAX_UPLOAD_BYTES", 10)
    assert client.post("/cutout", content=png_bytes()).status_code == 413


def test_token_is_checked_when_set(monkeypatch):
    monkeypatch.setenv("CUTOUT_TOKEN", "s3cret")
    assert client.post("/cutout", content=png_bytes()).status_code == 401
    ok = client.post("/cutout", content=png_bytes(), headers={"authorization": "Bearer s3cret"})
    assert ok.status_code == 200


def test_downsizes_large_images(monkeypatch):
    seen = {}

    def spy(image):
        seen["size"] = image.size
        return image.convert("RGBA")

    monkeypatch.setattr(cutout_app, "remove_background", spy)
    monkeypatch.setattr(cutout_app, "MAX_SIDE_PX", 32)
    assert client.post("/cutout", content=png_bytes((100, 50))).status_code == 200
    assert max(seen["size"]) == 32


def test_bria_model_is_refused():
    assert "bria-rmbg" in cutout_app.FORBIDDEN_MODELS
    assert cutout_app.MODEL_NAME not in cutout_app.FORBIDDEN_MODELS
    assert os.environ.get("CUTOUT_MODEL", "birefnet-portrait") != "bria-rmbg"
