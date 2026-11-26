"""Regression tests for the host.sh pending-edit preflight.

Extracts pending() from host.sh and runs it against a stub systemctl that, like
real systemctl, treats a unit name starting with '-' as an option unless it
follows '--'. Real unit '-.mount' exposed this.
"""
import subprocess
import tempfile
import unittest
from pathlib import Path

HOST = Path(__file__).resolve().parent / "host.sh"
SRC = HOST.read_text()
FUNC = SRC[SRC.index("pending() {"):SRC.index("installed() {")]

STUB = r'''#!/bin/bash
case $1 in
list-units) printf '%s\n' "$UNITS"; exit "${LIST_RC:-0}";;
show)
  shift; name=
  while (($#)); do
    if [[ $1 == -- ]]; then shift; name=${1-}; break; fi
    if [[ $1 == -p ]]; then shift; elif [[ $1 == --value ]]; then :
    elif [[ $1 == -* ]]; then echo "Unknown option $1" >&2; exit 1
    else name=$1; fi
    shift
  done
  [[ -n $name ]] || exit 1
  [[ $name == "${FAIL_UNIT-}" ]] && { echo "Failed to get properties" >&2; exit 1; }
  if [[ $name == "${YES_UNIT-}" ]]; then echo yes; else echo no; fi;;
esac
'''


def run(units, phase="setup", yes="", fail="", list_rc=0, attested=""):
    with tempfile.TemporaryDirectory() as d:
        stub = Path(d, "systemctl")
        stub.write_text(STUB)
        stub.chmod(0o755)
        script = (
            f'set -euo pipefail\nPATH={d}:$PATH\nphase={phase}\n'
            f'cases=({attested}) units=()\n'
            'die() { echo "STOP: $*" >&2; exit 1; }\n'
            f'{FUNC}\npending\necho OK\n'
        )
        env = {"UNITS": "\n".join(f"{u} loaded active" for u in units),
               "YES_UNIT": yes, "FAIL_UNIT": fail, "LIST_RC": str(list_rc),
               "PATH": "/usr/bin:/bin"}
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env=env)


class Pending(unittest.TestCase):
    def test_uses_option_terminator(self):
        self.assertIn("--value -- \"$u\"", FUNC)

    def test_dash_mount_unit(self):
        r = run(["-.mount", "ssh.service"])
        self.assertEqual((r.returncode, r.stdout), (0, "OK\n"), r.stderr)

    def test_normal_units(self):
        self.assertEqual(run(["a.service", "b.slice"]).returncode, 0)

    def test_pending_edit_rejected(self):
        r = run(["a.service", "b.service"], yes="b.service")
        self.assertEqual(r.returncode, 1)
        self.assertIn("b.service", r.stderr)

    def test_pending_dash_mount_rejected(self):
        self.assertEqual(run(["-.mount"], yes="-.mount").returncode, 1)

    def test_rollback_ignores_only_attested_yes(self):
        ok = run(["cape-x.service"], phase="rollback", yes="cape-x.service", attested="cape-x.service")
        self.assertEqual(ok.returncode, 0, ok.stderr)
        bad = run(["other.service"], phase="rollback", yes="other.service", attested="cape-x.service")
        self.assertEqual(bad.returncode, 1)

    def test_systemctl_show_error(self):
        r = run(["a.service"], fail="a.service")
        # set -e aborts on the failed command substitution: fails closed.
        self.assertEqual(r.returncode, 1)
        self.assertNotIn("OK", r.stdout)
        self.assertIn("Failed to get properties", r.stderr)

    def test_systemctl_list_error(self):
        r = run(["a.service"], list_rc=1)
        self.assertEqual(r.returncode, 1)


if __name__ == "__main__":
    unittest.main()
