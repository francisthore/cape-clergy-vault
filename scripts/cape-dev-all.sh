#!/usr/bin/env bash
# Cape Clergy Vault — local WSL development orchestrator.
# Copy into the repository as scripts/dev-all.sh and run via bash.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ALLOW_LIVE_EMAIL=false
ALLOW_CAPTURE_EMAIL=false
ALLOW_BOUNCER=false
for arg in "$@"; do
  case "$arg" in
    --allow-live-email) ALLOW_LIVE_EMAIL=true ;;
    --allow-capture-email) ALLOW_CAPTURE_EMAIL=true ;;
    --allow-bouncer) ALLOW_BOUNCER=true ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

for command in node bun flock; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done
for file in .env.db.local .env.db.runtime.local .env.db.notifications.local .env.db.scanner.local .env.auth.local; do
  [[ -f "$file" ]] || { echo "Missing configuration: $file" >&2; exit 1; }
done

# The dedicated lock prevents a second dev-all launch from starting duplicate loops.
mkdir -p .local
exec 9>.local/dev-all.lock
flock -n 9 || { echo "Another dev-all instance already holds the local lock." >&2; exit 1; }

EMAIL_PROVIDER=$(node --env-file=.env.auth.local -p 'process.env.EMAIL_PROVIDER ?? "development"')
SCANNER_PROVIDER=$(node --env-file=.env.db.scanner.local -p 'process.env.CAPE_SCANNER ?? "clamav"')

case "$EMAIL_PROVIDER" in
  resend)
    if [[ "$ALLOW_LIVE_EMAIL" != true ]]; then
      echo "Resend is configured. --allow-live-email is required to send queued real emails." >&2
      exit 2
    fi
    ;;
  development)
    if [[ "$ALLOW_CAPTURE_EMAIL" != true ]]; then
      echo "Capture provider is configured. --allow-capture-email is required because processed mail is marked complete in the persistent DB." >&2
      exit 2
    fi
    ;;
  *) echo "Unrecognized email provider: $EMAIL_PROVIDER" >&2; exit 2 ;;
esac

case "$SCANNER_PROVIDER" in
  bouncer)
    if [[ "$ALLOW_BOUNCER" != true ]]; then
      echo "Bouncer is configured. --allow-bouncer is required to transfer queued PDF bytes to the external provider." >&2
      exit 2
    fi
    HAS_BOUNCER_KEY=$(node --env-file=.env.db.scanner.local -p 'Boolean(process.env.BOUNCER_API_KEY)')
    if [[ "$HAS_BOUNCER_KEY" != true ]]; then
      echo "BOUNCER_API_KEY is missing in the scanner-only environment." >&2
      exit 2
    fi
    HAS_UPLOAD_HOST=$(node --env-file=.env.db.scanner.local -p 'Boolean(process.env.BOUNCER_UPLOAD_HOST)')
    if [[ "$HAS_UPLOAD_HOST" != true ]]; then
      echo "Notice: BOUNCER_UPLOAD_HOST is unset: files above 4 MiB will not submit."
    fi
    ;;
  clamav) ;;
  *) echo "Unrecognized scanner provider: $SCANNER_PROVIDER" >&2; exit 2 ;;
esac

# Only the marked project-local PostgreSQL cluster is started; no init/reset/migrate.
echo "Starting/confirming the project-local PostgreSQL database..."
bun run db:local:start
bun run db:status

pids=()
cleanup() {
  trap - EXIT INT TERM
  echo
  echo "Stopping Cape Clergy Vault development processes..."
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in "${pids[@]}"; do wait "$pid" 2>/dev/null || true; done
  echo "Application and worker loops stopped. PostgreSQL data retained."
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

start() {
  local label=$1; shift
  echo "Starting ${label}..."
  "$@" &
  pids+=("$!")
}

# Each child gets only its own dedicated environment files, not the migration owner URL.
start web bun --env-file=.env.db.runtime.local --env-file=.env.auth.local \
  run dev --host 127.0.0.1 --port 3000 --strictPort
start scanner node --env-file=.env.db.scanner.local scripts/worker-loop.mjs scanner
start approval-mail node --env-file=.env.db.notifications.local --env-file=.env.auth.local \
  scripts/worker-loop.mjs approval
start reviewer-mail node --env-file=.env.db.notifications.local --env-file=.env.auth.local \
  scripts/worker-loop.mjs reviewer

echo
echo "Development group started: http://localhost:3000"
echo "Workers run bounded cycles, approximately once per minute."
echo "The first cycle may submit queued real emails/PDFs according to the flags supplied."
echo "Ctrl+C stops the web app and worker loops; the local database persists."
echo

# A terminated child is never silently interpreted as successful supervision.
set +e
wait -n "${pids[@]}"
set -e
echo "A development process exited. Shutting down the remaining processes." >&2
exit 1
