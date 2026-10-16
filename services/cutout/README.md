# Cut-out service

Removes the background from a photo of a person and returns a transparent PNG. Used for "Owner as the face" (F-6):
the owner's own photos, so there are no AI faces. Drawn characters and AI people do not use it (they are cut out in the
app by a chroma key).

- rembg with the **BiRefNet portrait** model (`birefnet-portrait`), MIT licence, CPU only.
- **Do not use the `bria-rmbg` model.** Its licence is non-commercial. `app.py` refuses to start with it.
- The model weights are downloaded when the Docker image is built.

## API

| Method and path | Body | Answer |
|---|---|---|
| `POST /cutout` | the image bytes (JPEG, PNG or WebP), at most 10 MB | `image/png` with an alpha channel |
| `GET /healthz` | none | `{"ok": true}` |

Errors: 400 no image, 401 wrong token, 413 too large, 415 not an image. Images over 2048 px on a side are scaled down first.

If `CUTOUT_TOKEN` is set on the service, every request needs `Authorization: Bearer <token>`.

## Tests

The tests stub the model, so they need no weights:

```
pip install fastapi httpx pillow pytest
cd services/cutout && pytest
```

## Deploy to Cloud Run (not done yet; needs the owner's go-ahead)

Replace `PROJECT` and `REGION`. Build with Cloud Build (the build downloads the model, so it takes a few minutes and the
image is about 2 GB):

```
gcloud builds submit services/cutout --tag REGION-docker.pkg.dev/PROJECT/weekly-posts/cutout:latest

gcloud run deploy cutout \
  --image REGION-docker.pkg.dev/PROJECT/weekly-posts/cutout:latest \
  --region REGION \
  --cpu 2 --memory 4Gi \
  --concurrency 1 --max-instances 2 --min-instances 0 \
  --timeout 120 \
  --no-allow-unauthenticated \
  --set-secrets CUTOUT_TOKEN=cutout-token:latest
```

Notes:

- BiRefNet on CPU takes several seconds a photo. `--concurrency 1` keeps each request on its own CPU; `--min-instances 0`
  means the first photo after a quiet period also waits for the container to start (a few seconds, as the model is in
  the image). Set `--min-instances 1` only if that wait matters.
- Create the secret first: `printf '%s' "$(openssl rand -hex 32)" | gcloud secrets create cutout-token --data-file=-`.
- `--no-allow-unauthenticated` plus the bearer token: the app's Cloud Run service account needs `roles/run.invoker`, or
  deploy with `--allow-unauthenticated` and rely on the token alone. Pick one when deploying.

## Hooking it up

In the app's environment (`.env.local`, and Secret Manager in the cloud):

```
CUTOUT_URL=https://cutout-xxxxx-REGION.a.run.app/cutout
CUTOUT_TOKEN=<the same secret>
```

When `CUTOUT_URL` is unset, `cutout(png, 'matting')` fails with "cut-out service not configured" and nothing else happens.
The app limits what it sends (10 MB) and waits at most 60 seconds.
