"""Validate one retained process result. Only copy allowlisted records into evidence."""
from pathlib import Path
import re
import sys


def assess(unit, start_rc, host_ns, host_bound, status_path, log_path, messages):
    def require(condition, label):
        if not condition:
            raise ValueError(label)

    status = dict(line.split("=", 1) for line in Path(status_path).read_text().splitlines())
    variant = unit.removeprefix("cape-probe-").removesuffix(".service")
    runtime = variant.startswith("runtime-")
    role = variant.removeprefix("runtime-")
    own = "/run/credentials/" + unit
    ctl = "/run/cape-probe/ctl"
    paths = {"/run", ctl}
    paths.update({"/run/cape-probe/" + role} if runtime else {"/", "/run/credentials", own})
    access_keys = {"read_secret", "ls_secrets", "ls_decoy_creds", "read_decoy_cred",
                   "ls_own_creds", "write_ctl"}
    # Every accepted line is a fixed label with bounded kernel metadata or a verdict.
    # Never persist unknown stdout, even on an early service failure.
    patterns = [
        r"(mnt_ns)=(mnt:\[\d+\])",
        r"(CapBnd|CapEff|CapPrm|CapAmb):\s+([a-f0-9]{16})",
        r"(NoNewPrivs|Seccomp):\s+([0-2])",
        r"== stage1 (variant)=(bang uid=0|plus uid=0)",
        r"(" + "|".join(sorted(access_keys)) + r"): (OK|FAIL|FAIL \(EROFS\))",
        r"(runtime_write\[(?:approval|scanner|reviewer)\]): (OK)",
    ]
    data = {}
    invalid = False
    with Path(log_path).open("x") as log:
        for raw in messages:
            line = raw.rstrip("\n")
            mount = re.fullmatch(r"mount\[([^]]+)\]=([^ ]+) ([\w.-]+) ([\w.,=-]+)", line)
            if mount and mount[1] in paths and mount[2] in paths | {"/", "/run/cape-probe"}:
                key, value = mount[1], mount[4].split(",")
            else:
                match = next((m for pat in patterns if (m := re.fullmatch(pat, line))), None)
                if not match:
                    invalid = True
                    continue
                key, value = match.groups()
            log.write(line + "\n")
            if key in data:
                invalid = True
            data[key] = value
        if invalid:
            log.write("Unexpected or duplicate journal record withheld\n")
    require(not invalid, "unexpected journal output")
    require(re.fullmatch(r"mnt:\[\d+\]", host_ns) and "mnt_ns" in data, "mount namespace evidence")
    if variant != "plus":
        require(data["mnt_ns"] != host_ns, "expected private mount namespace")
    for path in paths:
        require(path in data, "missing mount metadata for " + path)
    for path in ({ctl} if variant == "plus" else paths - {own, "/run/credentials"}):
        expected = "rw" if variant == "plus" or (runtime and path == "/run/cape-probe/" + role) else "ro"
        require(set(data[path]) & {"ro", "rw"} == {expected}, "wrong covering VFS flags for " + path)

    if runtime:
        require(data.get(f"runtime_write[{role}]") == "OK", "runtime exception")
    else:
        require(data.get("variant") == variant + " uid=0", "stage-one identity")
        require(data.get("ls_own_creds") == "OK", "own credential")
        expected = "FAIL" if variant == "bang" else "OK"
        require(data.get("ls_secrets") == data.get("read_secret") == expected, "source controls")
        if variant == "bang":
            require(data.get("write_ctl") == "FAIL (EROFS)", "protected write")
            require(all(data.get(k) == "00000000002001c0" for k in ("CapBnd", "CapEff", "CapPrm")), "capabilities")
            require(data.get("CapAmb") == "0" * 16 and data.get("NoNewPrivs") == "1"
                    and data.get("Seccomp") == "2", "bang process restrictions")
        else:
            require(re.fullmatch(r"[0-9a-f]{16}", host_bound) and host_bound != "00000000002001c0"
                    and data.get("CapBnd") == host_bound, "plus bounding set")
            require(data.get("write_ctl") == "OK", "positive write control")
            if (data.get("ls_decoy_creds") == data.get("read_decoy_cred") == "FAIL"
                    and start_rc != "0" and status.get("Result") == "exit-code"
                    and status.get("ExecMainCode") == status.get("ExecMainStatus") == "1"):
                raise ValueError("plus source and write controls passed; sibling visibility INCONCLUSIVE; C1 OPEN")
        require(data.get("ls_decoy_creds") == data.get("read_decoy_cred") == expected, "sibling controls")
    require(start_rc == "0" and status.get("Result") == "success" and status.get("ExecMainCode") == "1"
            and status.get("ExecMainStatus") == "0" and status.get("ActiveState") == "active"
            and status.get("SubState") == "exited", "unit exit status")
    print(unit, "PASS")


if __name__ == "__main__":
    try:
        assess(*sys.argv[1:], sys.stdin)
    except ValueError as error:
        sys.exit("STOP: " + str(error))
