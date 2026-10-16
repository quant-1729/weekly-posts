"""Cut-out service for Weekly Posts (Brand Face, owner's own photos).

POST /cutout   body = the image bytes (JPEG, PNG or WebP)  ->  PNG with an alpha channel
GET  /healthz  ->  {"ok": true}

Uses rembg with the BiRefNet portrait model (MIT licence). Do NOT switch this to the "bria-rmbg" model: its licence is
non-commercial. The model is downloaded when the image is built (see Dockerfile), so a cold start does not fetch it.

If CUTOUT_TOKEN is set, requests must send "Authorization: Bearer <token>".
"""

from __future__ import annotations

import hmac
import io
import os
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response
from PIL import Image, UnidentifiedImageError

MODEL_NAME = os.environ.get("CUTOUT_MODEL", "birefnet-portrait")
# The one model we refuse, whatever the environment says.
FORBIDDEN_MODELS = {"bria-rmbg"}
MAX_UPLOAD_BYTES = int(os.environ.get("CUTOUT_MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
MAX_SIDE_PX = int(os.environ.get("CUTOUT_MAX_SIDE_PX", "2048"))
MAX_PIXELS = 40_000_000  # refuse decompression bombs before decoding fully

if MODEL_NAME in FORBIDDEN_MODELS:
    raise RuntimeError(f"{MODEL_NAME} is non-commercial and must not be used")

Image.MAX_IMAGE_PIXELS = MAX_PIXELS

app = FastAPI(title="cutout", docs_url=None, redoc_url=None)

_session: Any = None


def get_session() -> Any:
    """The rembg session, created once (the model file is already in the image)."""
    global _session
    if _session is None:
        from rembg import new_session  # imported late so tests can run without the weights

        _session = new_session(MODEL_NAME)
    return _session


def remove_background(image: Image.Image) -> Image.Image:
    """Overridable in tests. Returns an RGBA image."""
    from rembg import remove

    out = remove(image, session=get_session(), post_process_mask=True)
    return out.convert("RGBA")


def _check_token(request: Request) -> None:
    token = os.environ.get("CUTOUT_TOKEN", "").strip()
    if not token:
        return
    sent = request.headers.get("authorization", "")
    if not hmac.compare_digest(sent, f"Bearer {token}"):
        raise HTTPException(status_code=401, detail="unauthorised")


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.post("/cutout")
async def cutout(request: Request) -> Response:
    _check_token(request)
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="no image")
    if len(body) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    try:
        image = Image.open(io.BytesIO(body))
        image.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise HTTPException(status_code=415, detail="not a usable image") from None
    image = image.convert("RGBA") if image.mode not in ("RGB", "RGBA") else image
    if max(image.size) > MAX_SIDE_PX:
        image.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX))
    result = remove_background(image)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")
