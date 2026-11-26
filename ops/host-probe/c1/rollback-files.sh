#!/bin/bash
# Called with trusted, verified bundle as cwd. The receipt list is root-private.
set -euo pipefail
E=$1 P=$2 X=$3 D=$4
# Reconcile known entries in reverse creation order. An unrecorded collision,
# a replaced inode, an unexpected mount or a nonempty directory survives.
mounts=$(findmnt -rn -o TARGET)
for root in "$P" "$X"; do
  awk -v p="$root" '$0==p || index($0,p"/")==1 {bad=1} END {exit bad}' <<< "$mounts"
done
tac "$E/created" > "$E/reverse"
while read -r inode path; do
  [[ -e $path || -L $path ]] || continue
  [[ $(realpath -e -- "$path") == "$path" && $(stat -c '%d:%i' -- "$path") == "$inode" ]] || { echo "STOP: changed identity $path" >&2; exit 1; }
  awk -v p="$path" '$0==p || index($0,p"/")==1 {bad=1} END {exit bad}' <<< "$mounts"
  case "$path" in
    "$P"|"$P/ctl"|"$P/secrets"|"$X") rmdir -- "$path" ;;
    "$P/secrets/probe-secret"|"$P/secrets/probe-secret-decoy") rm -- "$path" ;;
    "$X/runtime.sh"|"$X/stage1.sh"|"$D/cape-probe-bang.service"|"$D/cape-probe-plus.service"|"$D/cape-probe-decoy.service"|\
    "$D/cape-probe-runtime-scanner.service"|"$D/cape-probe-runtime-approval.service"|"$D/cape-probe-runtime-reviewer.service"|"$D/cape-probe.slice")
      cmp -- "${path##*/}" "$path"
      rm -- "$path" ;;
    *) echo "STOP: unrecognised receipt $path" >&2; exit 1 ;;
  esac
done < "$E/reverse"
