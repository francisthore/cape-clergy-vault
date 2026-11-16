#!/usr/bin/env bash
# Local-only orchestration. No init, migrations, grants, seeds or queue rewrites.
set -Eeuo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null || { echo 'Node 24.12+ is required.' >&2; exit 1; }
command -v flock >/dev/null || { echo 'flock is required.' >&2; exit 1; }
mkdir -p .local
exec 9>.local/dev-all.lock
flock -n 9 || { echo 'Another dev:all instance holds the project lock.' >&2; exit 1; }
exec node scripts/dev-all.mjs "$@"
