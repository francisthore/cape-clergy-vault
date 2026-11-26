"""Synthetic local checks. No systemd manager or real credential paths."""
from contextlib import redirect_stdout
import io
from pathlib import Path
import tempfile
import unittest

from assess import assess


class VerdictTests(unittest.TestCase):
    def evaluate(self, variant, replacements=(), failed=False, extra=""):
        unit = f"cape-probe-{variant}.service"
        host_bound = "000001ffffffffff"
        ns = "mnt:[123]"
        role = variant.removeprefix("runtime-")
        runtime = role != variant
        flags = "rw" if variant == "plus" else "ro"
        cred = "/run/credentials"
        paths = {"/run": flags, "/run/cape-probe/ctl": flags}
        lines = ["mnt_ns=mnt:[456]"]
        if runtime:
            paths["/run/cape-probe/" + role] = "rw"
            lines += [f"runtime_write[{role}]: OK"]
        else:
            paths.update({"/": flags, cred: "ro", cred + "/" + unit: "ro"})
            access = "OK" if variant == "plus" else "FAIL"
            bound = host_bound if variant == "plus" else "00000000002001c0"
            lines += [f"== stage1 variant={variant} uid=0", f"CapBnd: {bound}", f"CapEff: {bound}",
                      f"CapPrm: {bound}", "CapAmb: 0000000000000000", "NoNewPrivs: 1", "Seccomp: 2",
                      "ls_own_creds: OK", "write_ctl: " + ("OK" if variant == "plus" else "FAIL (EROFS)")]
            lines += [key + ": " + access for key in ("ls_decoy_creds", "read_decoy_cred", "ls_secrets", "read_secret")]
        lines += [f"mount[{p}]={p} tmpfs {f},nosuid" for p, f in paths.items()]
        raw = "\n".join(lines) + "\n" + extra
        for old, new in replacements:
            self.assertIn(old, raw)
            raw = raw.replace(old, new)
        with tempfile.TemporaryDirectory() as directory:
            status = Path(directory) / "status"
            log = Path(directory) / "log"
            props = ("Result=exit-code\nExecMainStatus=1\nActiveState=failed\nSubState=failed"
                     if failed else "Result=success\nExecMainStatus=0\nActiveState=active\nSubState=exited")
            status.write_text("ExecMainCode=1\n" + props)
            try:
                with redirect_stdout(io.StringIO()):
                    assess(unit, "1" if failed else "0", ns, host_bound, status, log, io.StringIO(raw))
            finally:
                self.assertNotIn("private-fixture-value", log.read_text())

    def test_successes(self):
        for variant in ("bang", "plus", "runtime-approval", "runtime-scanner", "runtime-reviewer"):
            with self.subTest(variant=variant):
                self.evaluate(variant)

    def test_inconclusive_plus(self):
        with self.assertRaisesRegex(ValueError, "sibling visibility INCONCLUSIVE"):
            self.evaluate("plus", [("ls_decoy_creds: OK", "ls_decoy_creds: FAIL"),
                                   ("read_decoy_cred: OK", "read_decoy_cred: FAIL")], failed=True)

    def test_mismatches(self):
        for variant, old, new in [
            ("bang", "FAIL (EROFS)", "FAIL"), ("bang", "mnt:[456]", "mnt:[123]"),
            ("bang", "tmpfs ro,nosuid", "tmpfs rw,nosuid"), ("plus", "write_ctl: OK", "write_ctl: FAIL"),
            ("plus", "ls_decoy_creds: OK", "ls_decoy_creds: FAIL"),
            ("runtime-reviewer", "tmpfs rw,nosuid", "tmpfs ro,nosuid"),
        ]:
            with self.subTest(variant=variant, old=old), self.assertRaises(ValueError):
                self.evaluate(variant, [(old, new)])

    def test_failure_with_success_text(self):
        with self.assertRaisesRegex(ValueError, "exit status"):
            self.evaluate("bang", failed=True)

    def test_inconclusive_requires_every_other_control_to_pass(self):
        # INCONCLUSIVE must never absorb a genuine control failure. Each case is a hard error.
        both = [("ls_decoy_creds: OK", "ls_decoy_creds: FAIL"), ("read_decoy_cred: OK", "read_decoy_cred: FAIL")]
        cases = {
            "source read lost": (both + [("read_secret: OK", "read_secret: FAIL")], True),
            "source listing lost": (both + [("ls_secrets: OK", "ls_secrets: FAIL")], True),
            "write control lost": (both + [("write_ctl: OK", "write_ctl: FAIL")], True),
            "only one sibling access hidden": (both[:1], True),
            "clean exit with sibling hidden": (both, False),
        }
        for label, (replacements, failed) in cases.items():
            with self.subTest(label):
                with self.assertRaises(ValueError) as caught:
                    self.evaluate("plus", replacements, failed=failed)
                self.assertNotIn("INCONCLUSIVE", str(caught.exception))

    def test_bang_exposure_is_always_a_failure(self):
        for key in ("read_secret", "ls_secrets", "ls_decoy_creds", "read_decoy_cred"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.evaluate("bang", [(key + ": FAIL", key + ": OK")])

    def test_unexpected_output_withheld(self):
        with self.assertRaisesRegex(ValueError, "unexpected journal"):
            self.evaluate("plus", extra="private-fixture-value\n")


if __name__ == "__main__":
    unittest.main()
