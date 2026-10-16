#!/usr/bin/env bash
# Cloud Scheduler jobs that replace Vercel Cron (C-31). Safe to run again: existing jobs are updated.
#
#   export PROJECT_ID=my-project                 # required
#   export CRON_SECRET=...                       # required: same value as the CRON_SECRET secret the service uses
#   export REGION=australia-southeast1           # optional, default shown
#   export SERVICE=weekly-posts                  # optional, default shown
#   export SERVICE_URL=https://app.example.com   # optional: default is the Cloud Run address of the service
#   bash scripts/gcp/scheduler.sh
#
# Both routes are GET and accept exactly "Authorization: Bearer $CRON_SECRET".
#   weekly     at minute 0 of every hour   -> /api/cron/weekly    (each brand's week starts within an hour of its chosen local time)
#   reminders  at minute 30 of every hour  -> /api/cron/reminders
#   queue      at minute 15 of every hour  -> /api/cron/queue      (publishes or emails each post whose slot has come)
#   insights   at minute 45 of every hour  -> /api/cron/insights   (reads post insights into post_metrics at about 24 h, 72 h and 7 days)
#   connections daily at 03:15 UTC          -> /api/cron/connections (renews Instagram tokens that end within 10 days; expired ones email the owner once)
#   research   Mondays hourly 06:00-09:00 UTC -> /api/cron/research   (weekly trend research for brands that have it on; at most one run per brand per week)
# The Cloud Scheduler API must be enabled in the project (docs/deploy.md).
set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID}"
: "${CRON_SECRET:?Set CRON_SECRET (same value as the CRON_SECRET secret)}"
REGION="${REGION:-australia-southeast1}"
SERVICE="${SERVICE:-weekly-posts}"
# The schedule is just "every hour"; the app decides each brand's local time itself.
TIME_ZONE="${TIME_ZONE:-Etc/UTC}"

if [ -z "${SERVICE_URL:-}" ]; then
  SERVICE_URL="$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"
fi
SERVICE_URL="${SERVICE_URL%/}"
echo "Service: $SERVICE_URL"

# upsert NAME SCHEDULE PATH ATTEMPT_DEADLINE DESCRIPTION
upsert() {
  local name="$1" schedule="$2" path="$3" deadline="$4" description="$5" verb=create
  if gcloud scheduler jobs describe "$name" --project "$PROJECT_ID" --location "$REGION" >/dev/null 2>&1; then
    verb=update
  fi
  echo "$verb job $name ($schedule $path)"
  gcloud scheduler jobs "$verb" http "$name" \
    --project "$PROJECT_ID" \
    --location "$REGION" \
    --schedule "$schedule" \
    --time-zone "$TIME_ZONE" \
    --uri "$SERVICE_URL$path" \
    --http-method GET \
    --headers "Authorization=Bearer $CRON_SECRET" \
    --attempt-deadline "$deadline" \
    --max-retry-attempts 0 \
    --description "$description"
}

# Weekly generation can run up to 5 minutes (the route allows 300 s); give the call a little longer.
# No retries: the next hourly run picks up whatever is still due.
upsert weekly-posts-weekly    "0 * * * *"  /api/cron/weekly    330s "Weekly Posts: generate this week for brands whose local time has come"
upsert weekly-posts-reminders "30 * * * *" /api/cron/reminders 150s "Weekly Posts: posting reminders"
upsert weekly-posts-queue     "15 * * * *" /api/cron/queue     150s "Weekly Posts: publish or deliver the queue items whose slot has come"
upsert weekly-posts-insights    "45 * * * *" /api/cron/insights  150s "Weekly Posts: read insights of published posts"
upsert weekly-posts-connections "15 3 * * *" /api/cron/connections 150s "Weekly Posts: renew Instagram connections"
# Research runs take about a minute per brand (the route allows 300 s); a late or repeated call skips brands that already ran.
upsert weekly-posts-research    "0 6-9 * * 1" /api/cron/research    330s "Weekly Posts: weekly trend research (Ideas)"

echo "Done. Test one now with:"
echo "  gcloud scheduler jobs run weekly-posts-reminders --project $PROJECT_ID --location $REGION"
