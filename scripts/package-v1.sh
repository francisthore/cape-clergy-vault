#!/bin/bash
# Run from the release source on the build host after a frozen dependency install.
# Every archive member comes from the build or an explicit runtime input.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
mkdir -p .local/releases
work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
root="$work/release"
mkdir -p "$root"
npm run build
node_modules/.bin/esbuild scripts/db/{document-scans,approval-notifications,reviewer-notifications,production-maintenance,administration-operator,settings-operator,storage-inventory}.ts \
  --bundle --platform=node --format=esm --packages=external --metafile="$work/trace.json" --outdir="$work/trace"
python3 - "$work/trace.json" "$root" <<'PY'
import json, shutil, sys
from pathlib import Path
trace = json.loads(Path(sys.argv[1]).read_text())
root = Path(sys.argv[2])

def copy(path):
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    if path.is_dir():
        shutil.copytree(path, target)
    else:
        shutil.copyfile(path, target)

for name in trace['inputs']:
    path = Path(name)
    if path.is_absolute() or '..' in path.parts or path.parts[0] not in ('scripts', 'database', 'src'):
        raise ValueError(f'Unexpected runtime input: {path}')
    copy(path)
for path in ['.output', 'database/migrations', 'database/runtime-grants.sql',
             'database/scanner-grants.sql', 'database/notifications-grants.sql',
             'scripts/service-entry.mjs', 'scripts/namespace-guard.mjs',
             'scripts/worker-loop.mjs', 'scripts/worker-supervisor.mjs', 'ops/v1-monitor.sql']:
    copy(Path(path))
# Only reviewed non-secret templates enter the application release.
for path in sorted(Path('ops').rglob('*.example')):
    if path.is_symlink() or not path.is_file():
        raise ValueError(f'Unexpected template: {path}')
    copy(path)
# These are the four external packages imported by the traced worker/operator
# entry points. Copy installed, lockfile-resolved packages including licences.
packages = set()
for output in trace['outputs'].values():
    for item in output['imports']:
        spec = item['path']
        if not spec.startswith('node:'):
            packages.add(spec.split('/')[0])
if packages != {'postgres','drizzle-orm','resend','zod'}:
    raise ValueError(f'Review changed worker dependencies: {packages}')
seen = set()
while packages:
    name = packages.pop()
    if name in seen:
        continue
    seen.add(name)
    path = Path('node_modules') / name
    copy(path)
    manifest = json.loads((path/'package.json').read_text())
    packages.update(manifest.get('dependencies', {}))
(root/'package.json').write_text('{"private":true,"type":"module"}\n')
PY
# Test packaged production imports from the standalone tree. None opens a connection on import.
(cd "$root" && node --input-type=module -e "await Promise.all(['./database/production.server.ts','./src/lib/scanning/worker.server.ts','./src/lib/reviews/notifications.server.ts','./src/lib/approvals/notifications.server.ts','./database/migration-plan.server.ts'].map(p=>import(p)))")
(cd "$root" && find . -type f -print0 | sort -z | xargs -0 sha256sum > "$work/MANIFEST.sha256")
cp "$work/MANIFEST.sha256" "$root/"
artifact=$(mktemp .local/releases/cape-vault-v1-XXXXXXXX.tar.gz)
tar --owner=0 --group=0 --numeric-owner --mode='u+rwX,go+rX,go-w' -C "$root" -czf "$artifact" .
sha256sum "$artifact" > "$artifact.sha256"
cat "$artifact.sha256"
