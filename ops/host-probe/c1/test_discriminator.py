"""Separate explicit path masking from systemd credential projection (local, synthetic).

Case 004 (systemd 255.4) showed the plus reader could not see the live decoy's
credential directory although plus source/write controls passed. A hidden
sibling therefore does not identify WHICH mechanism hid it:

  mask        InaccessiblePaths= style overlay of one path
  projection  a private /run/credentials tree holding only the unit's own credential

This fixture runs both mechanisms, alone and together, inside a private
user+mount namespace and records what an independently readable peer sees.
It proves the attribution logic only. It does not prove systemd 255 behaviour.
"""
import os
import subprocess
import unittest

SCRIPT = r"""
set -eu
mount -t tmpfs tmpfs /run
cred=/run/credentials
peer_cred=$cred/cape-probe-decoy.service     # path under the credential tree
peer_file=/run/cape-probe/peer/probe         # independently readable, outside the tree
mkdir -p "$peer_cred" "$cred/cape-probe-self.service" /run/cape-probe/peer
echo synthetic > "$peer_cred/probe"
echo synthetic > "$peer_file"
case $MASK in
  yes) mount -t tmpfs tmpfs "$peer_cred"; mount -t tmpfs tmpfs /run/cape-probe/peer ;;
esac
case $PROJECT in
  yes) mount -t tmpfs tmpfs "$cred"; mkdir "$cred/cape-probe-self.service" ;;
esac
r() { if cat "$1" >/dev/null 2>&1; then echo OK; else echo FAIL; fi; }
echo "outside=$(r "$peer_file") inside=$(r "$peer_cred/probe")"
"""


def observe(mask, project):
    env = dict(os.environ, MASK=mask, PROJECT=project)
    done = subprocess.run(["unshare", "-Urm", "bash", "-c", SCRIPT], env=env,
                          capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


class MaskVersusProjection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if subprocess.run(["unshare", "-Urm", "true"], capture_output=True).returncode != 0:
            raise RuntimeError("unprivileged user+mount namespaces are required; do not skip this test")

    def test_unmasked_unprojected_peer_is_readable(self):
        # The only combination that is a positive control for BOTH paths.
        self.assertEqual(observe("no", "no"), "outside=OK inside=OK")

    def test_mask_alone_discriminates_on_a_path_outside_the_credential_tree(self):
        # Peer outside /run/credentials: readable unmasked (above), denied masked. This
        # is the positive/negative pair for the explicit-mask mechanism (Case 004's
        # secrets-source controls have the same shape).
        self.assertEqual(observe("yes", "no"), "outside=FAIL inside=FAIL")

    def test_projection_alone_hides_credential_peer_without_any_mask(self):
        # Attribution hazard: the credential peer is denied with NO mask, and the
        # outside peer is untouched, so projection is independent of the mask.
        self.assertEqual(observe("no", "yes"), "outside=OK inside=FAIL")

    def test_denied_credential_peer_cannot_attribute_the_mask(self):
        # Three of four combinations deny the credential peer. A denial alone,
        # with projection possible, is therefore not evidence about the mask.
        denied = [(m, p) for m in ("no", "yes") for p in ("no", "yes")
                  if observe(m, p).endswith("inside=FAIL")]
        self.assertEqual(denied, [("no", "yes"), ("yes", "no"), ("yes", "yes")])


if __name__ == "__main__":
    unittest.main()
