"""Run the real C1 reporters and feed their actual output to the assessor.

Each case executes stage1.sh or runtime.sh unmodified at its real paths inside
a private user+mount namespace (unshare). Every mount, tmpfs and remount below
exists only in that namespace; the host mount table and /run are never changed.
The namespace reproduces the layers that matter to the reporter contract:
stacked self-binds (as ReadOnlyPaths= makes), a projected credential tree, a
mode-000 inaccessible source, a trimmed capability set, no_new_privs and a
seccomp filter. It does not prove systemd 255 behaviour; the host run does.

Set C1_BUNDLE to a packaged bundle directory to test the shipped bytes.
"""
import io
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

from assess import assess

REPO = Path(__file__).resolve().parents[3]
BUNDLE = Path(os.environ["C1_BUNDLE"]) if os.environ.get("C1_BUNDLE") else None
STAGE1 = (BUNDLE or REPO / "ops/host-probe") / "stage1.sh"
RUNTIME = (BUNDLE or REPO / "ops/host-probe/c1") / "runtime.sh"
BANG_CAPS = 0x2001C0

# Applies the bang unit's process restrictions, then execs the reporter.
RESTRICT = f"""
import ctypes, os, sys
libc = ctypes.CDLL(None, use_errno=True)
libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
def prctl(*args):
    args += (0,) * (5 - len(args))
    if libc.prctl(*args) != 0:
        raise OSError(ctypes.get_errno(), "prctl")
for cap in range(41):
    if not {BANG_CAPS} >> cap & 1:
        prctl(24, cap)  # PR_CAPBSET_DROP
prctl(38, 1)  # PR_SET_NO_NEW_PRIVS
class Insn(ctypes.Structure):
    _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte), ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]
class Prog(ctypes.Structure):
    _fields_ = [("len", ctypes.c_ushort), ("filter", ctypes.POINTER(Insn))]
allow = (Insn * 1)(Insn(0x06, 0, 0, 0x7FFF0000))  # BPF_RET | SECCOMP_RET_ALLOW
prctl(22, 2, ctypes.addressof(Prog(1, allow)))  # PR_SET_SECCOMP, FILTER
os.execv("/bin/sh", ["sh", sys.argv[1]])
"""

SETUP = r"""
set -euo pipefail
unit=cape-probe-$VARIANT.service
cred=/run/credentials
own=$cred/$unit
decoy=$cred/cape-probe-decoy.service
secrets=/run/cape-probe/secrets
stacked() { [[ $(grep -c " $1 " /proc/self/mountinfo) -gt 1 ]]; }
mount -t tmpfs tmpfs /run
mkdir -p /run/cape-probe/ctl "$secrets" "$decoy" "$own"
echo synthetic > "$secrets/probe-secret"
echo synthetic > "$decoy/probe"
case $LAYOUT in
  runtime)
    role=${VARIANT#runtime-}
    mkdir -m 0700 "/run/cape-probe/$role"
    mount --rbind /run /run
    mount -o remount,bind,ro /run
    mount --bind "/run/cape-probe/$role" "/run/cape-probe/$role"
    mount -o remount,bind,rw "/run/cape-probe/$role"
    stacked /run
    export RUNTIME_DIRECTORY=/run/cape-probe/$role
    echo SETUP-OK >&2
    exec sh "$REPORTER" "$role" ;;
  host) ;;                         # plus on the host: everything visible, no projection
  projected|bang-projected)        # private credential tree holding only the unit's own credential
    mount -t tmpfs tmpfs "$cred"
    mkdir "$own"
    mount -t tmpfs tmpfs "$own"
    echo synthetic > "$own/probe" ;;
esac
export CREDENTIALS_DIRECTORY=$own PROBE_MODE=${VARIANT}
if [[ $VARIANT == bang ]]; then
  # InaccessiblePaths=: an empty mode-000 directory replaces the source.
  mount -t tmpfs -o mode=000 tmpfs "$secrets"
  [[ $LAYOUT == bang-projected ]] || mount -t tmpfs -o mode=000 tmpfs "$decoy"
  mount --rbind /run /run  # ReadOnlyPaths=/run stacks a second layer on every mount below it
  for m in /run "$cred" "$own" "$secrets" "$decoy"; do
    if mountpoint -q "$m"; then mount -o remount,bind,ro "$m"; fi
  done
  mount -o remount,bind,ro /
  stacked /run
  echo SETUP-OK >&2
  exec python3 -B -I -c "$RESTRICT" "$REPORTER"
fi
echo SETUP-OK >&2
exec sh "$REPORTER"
"""


def namespace_available():
    return subprocess.run(["unshare", "-Um", "true"], capture_output=True).returncode == 0


def run_reporter(variant, layout):
    """Return (rc, stdout lines, stderr, host namespace, host bounding set)."""
    runtime = layout == "runtime"
    userns = ["-m", "-U", "--map-user=65534", "--map-group=65534", "--keep-caps"] if runtime else ["-m", "-r"]
    env = dict(os.environ, VARIANT=variant, LAYOUT=layout, RESTRICT=RESTRICT,
               REPORTER=str(RUNTIME if runtime else STAGE1))
    done = subprocess.run(["unshare", *userns, "bash", "-c", SETUP], env=env,
                          capture_output=True, text=True, timeout=60)
    host_ns = os.readlink("/proc/self/ns/mnt")
    bound = next(line.split()[1] for line in Path("/proc/self/status").read_text().splitlines()
                 if line.startswith("CapBnd:"))
    return done.returncode, done.stdout.splitlines(keepends=True), done.stderr, host_ns, bound


class RealReporterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not namespace_available():
            raise RuntimeError("unprivileged user+mount namespaces are required for the real-reporter test; "
                               "do not skip it, run on a workstation that permits `unshare -Um`")

    def assess(self, variant, lines, rc, host_ns, host_bound):
        unit = f"cape-probe-{variant}.service"
        status = ("ExecMainCode=1\nResult=success\nExecMainStatus=0\nActiveState=active\nSubState=exited"
                  if rc == 0 else f"ExecMainCode=1\nResult=exit-code\nExecMainStatus={rc}\nActiveState=failed\nSubState=failed")
        with tempfile.TemporaryDirectory() as directory:
            status_file = Path(directory) / "status"
            status_file.write_text(status)
            assess(unit, str(rc), host_ns, host_bound, status_file, Path(directory) / "log", io.StringIO("".join(lines)))

    def collect(self, variant, layout):
        rc, lines, stderr, host_ns, bound = run_reporter(variant, layout)
        self.assertIn("SETUP-OK", stderr, stderr)
        return rc, lines, stderr, host_ns, bound

    def passes(self, variant, layout):
        rc, lines, stderr, host_ns, bound = self.collect(variant, layout)
        self.assertEqual(rc, 0, "".join(lines) + stderr)
        self.assertEqual(len([x for x in lines if x.startswith("mount[")]), 3 if variant.startswith("runtime") else 5)
        self.assess(variant, lines, rc, host_ns, bound)
        return lines

    def test_bang_with_projected_credentials_and_stacked_mounts(self):
        lines = self.passes("bang", "bang-projected")
        text = "".join(lines)
        self.assertIn("mount[/run/credentials]=/run/credentials tmpfs", text)
        self.assertIn("mount[/run/credentials/cape-probe-bang.service]=", text)

    def test_bang_with_inaccessible_decoy_and_unprojected_credentials(self):
        self.passes("bang", "bang-hidden")

    def test_plus_on_host_credentials(self):
        self.passes("plus", "host")

    def test_plus_projected_credentials_report_inconclusive(self):
        rc, lines, stderr, host_ns, bound = self.collect("plus", "projected")
        self.assertEqual(rc, 1, "".join(lines) + stderr)
        self.assertIn("mount[/run/credentials/cape-probe-plus.service]=", "".join(lines))
        with self.assertRaisesRegex(ValueError, "sibling visibility INCONCLUSIVE"):
            self.assess("plus", lines, rc, host_ns, bound)

    def test_runtime_reporters(self):
        for role in ("scanner", "approval", "reviewer"):
            with self.subTest(role=role):
                self.passes(f"runtime-{role}", "runtime")

    def test_missing_mount_records_fail_closed(self):
        rc, lines, _, host_ns, bound = self.collect("bang", "bang-projected")
        for path in ("/", "/run", "/run/cape-probe/ctl", "/run/credentials", "/run/credentials/cape-probe-bang.service"):
            with self.subTest(path=path):
                kept = [x for x in lines if not x.startswith(f"mount[{path}]=")]
                self.assertEqual(len(kept), len(lines) - 1)
                with self.assertRaisesRegex(ValueError, "missing mount metadata for " + path):
                    self.assess("bang", kept, rc, host_ns, bound)

    def test_mutated_real_output_fails_closed(self):
        rc, lines, _, host_ns, bound = self.collect("bang", "bang-projected")
        text = "".join(lines)
        for label, mutated in {
            "writable root": re.sub(r"(?m)^(mount\[/\]=\S+ \S+ )ro", r"\1rw", text),
            "second record": text + "mount[/run]=/run tmpfs ro,relatime\n",
            "unknown record": text + "private-fixture-value\n",
            "wrong own target": text.replace("=/run/credentials/cape-probe-bang.service tmpfs", "=/srv tmpfs"),
        }.items():
            with self.subTest(label), self.assertRaises(ValueError):
                self.assertNotEqual(mutated, text)
                self.assess("bang", mutated.splitlines(keepends=True), rc, host_ns, bound)


if __name__ == "__main__":
    unittest.main()
