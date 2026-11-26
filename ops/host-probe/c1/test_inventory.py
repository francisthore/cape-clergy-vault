"""Regression tests for the host.sh Cape unit inventory preflight.

Extracts no_cape_units from host.sh and runs it against a stub systemctl.
"""
import subprocess
import tempfile
import unittest
from pathlib import Path

HOST = Path(__file__).resolve().parent / "host.sh"
SRC = HOST.read_text()
FUNC = SRC[SRC.index("no_cape_units() {"):SRC.index("setup() {")]


def run(files_rc, files_out, live_rc, live_out):
    with tempfile.TemporaryDirectory() as d:
        stub = Path(d, "systemctl")
        stub.write_text(
            '#!/bin/bash\n'
            'case $1 in\n'
            f'list-unit-files) printf %s "{files_out}"; exit {files_rc};;\n'
            f'list-units) printf %s "{live_out}"; exit {live_rc};;\n'
            'esac\n'
        )
        stub.chmod(0o755)
        script = f'set -euo pipefail\nPATH={d}:$PATH\ndie() {{ echo "STOP: $*" >&2; exit 1; }}\n{FUNC}\nno_cape_units\necho OK\n'
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True)


class Inventory(unittest.TestCase):
    def test_setup_and_rollback_use_helper(self):
        self.assertEqual(SRC.count("  no_cape_units\n"), 2)
        self.assertEqual(SRC.count("$(systemctl list-unit-files"), 1)

    def test_empty_clean_host(self):
        r = run(1, "", 0, "")
        self.assertEqual((r.returncode, r.stdout), (0, "OK\n"), r.stderr)

    def test_empty_rc0_also_ok(self):
        self.assertEqual(run(0, "", 0, "").returncode, 0)

    def test_unexpected_unit_file(self):
        for rc in (0, 1):
            r = run(rc, "cape-x.service enabled", 0, "")
            self.assertEqual(r.returncode, 1)
            self.assertIn("cape-x.service", r.stderr)
            self.assertIn("unit files not clean", r.stderr)

    def test_unexpected_live_unit(self):
        r = run(1, "", 0, "cape-x.service loaded")
        self.assertEqual(r.returncode, 1)
        self.assertIn("live units not clean", r.stderr)

    def test_genuine_errors(self):
        for case in [(2, "", 0, ""), (1, "Failed to connect to bus", 0, ""),
                     (5, "", 0, ""), (1, "", 1, ""), (0, "", 1, ""),
                     (1, "", 3, "Failed to list units")]:
            r = run(*case)
            self.assertEqual(r.returncode, 1, case)
            self.assertIn("STOP: preflight", r.stderr, case)
            self.assertIn("rc=", r.stderr, case)


if __name__ == "__main__":
    unittest.main()
