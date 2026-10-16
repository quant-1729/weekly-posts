# Cut-out service for Cloud Run (CPU only). rembg with the BiRefNet portrait model (MIT).
# Do NOT use the bria-rmbg model: its licence is non-commercial.
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    U2NET_HOME=/models \
    CUTOUT_MODEL=birefnet-portrait

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# Download the model weights at build time, so a cold start does not fetch them.
RUN python -c "from rembg import new_session; new_session('birefnet-portrait')" \
 && ls -l /models

COPY app.py .

RUN useradd --create-home --uid 10001 app && chown -R app /models
USER app

# Cloud Run sends requests to $PORT (8080 by default). One worker: the model is large and each request is CPU-bound.
ENV PORT=8080
CMD exec uvicorn app:app --host 0.0.0.0 --port ${PORT} --workers 1
