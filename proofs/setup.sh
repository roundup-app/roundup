#!/usr/bin/env bash
# V1: install pinned Bend and verify the exact Lean toolchain on every setup.
# The download's sha256 must match proofs/BEND_SHA256 (one `<sha256>  <asset>` line per platform);
# the installed `bend version` must equal the pin. Usage: proofs/setup.sh
# Test hooks: PROOFS_DIR (holds the pin files and .tools), BEND_BASE_URL (download directory), BEND_ASSET_PLATFORM.
set -euo pipefail

dir=${PROOFS_DIR:-$(cd "$(dirname "$0")" && pwd)}
version=$(tr -d '[:space:]' < "$dir/BEND_VERSION")
base=${BEND_BASE_URL:-https://github.com/bendlang/bend/releases/download/v$version}
tools=$dir/.tools
export BEND_NO_TELEMETRY=1

fail() { echo "proofs setup: $*" >&2; exit 1; }
need_curl() { command -v curl >/dev/null || fail "$1: curl is required to download it and is not installed"; }
verify_bend() {
  local got
  got=$("$1" version 2>&1) || fail "bend: installed version failed: $got; expected $version"
  [ "$got" = "bend $version" ] || fail "bend: installed version is '$got', expected $version"
}
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

if [ -x "$tools/bend/bin/bend" ]; then
  verify_bend "$tools/bend/bin/bend"
else
  need_curl Bend
  platform=${BEND_ASSET_PLATFORM:-$(uname -s | tr A-Z a-z)-$(uname -m | sed 's/x86_64/x64/; s/aarch64/arm64/')}
  asset=bend-$version-$platform.tar.gz
  want=$(awk -v a="$asset" '$2 == a { print $1 }' "$dir/BEND_SHA256")
  [ -n "$want" ] || { echo "bend: no checksum for $asset in proofs/BEND_SHA256" >&2; exit 1; }

  work=$(mktemp -d)
  trap 'rm -rf "$work"' EXIT
  curl -fsSL -o "$work/$asset" "$base/$asset" || { echo "bend: cannot download $base/$asset" >&2; exit 1; }
  [ "$(sha "$work/$asset")" = "$want" ] || { echo "bend: checksum of $asset does not match proofs/BEND_SHA256" >&2; exit 1; }
  mkdir "$work/x"
  tar -xzf "$work/$asset" -C "$work/x"
  [ -x "$work/x/bend/bin/bend" ] || { echo "bend: $asset holds no executable bend/bin/bend" >&2; exit 1; }
  verify_bend "$work/x/bend/bin/bend"
  mkdir -p "$tools"
  rm -rf "$tools/bend"
  mv "$work/x/bend" "$tools/bend"
  rm -rf "$work"
  trap - EXIT
fi

# Elan manages download, extraction and repeated toolchain installation. Do not
# select a user default or modify shell startup files.
lean_version=4.34.0
lean_toolchain=leanprover/lean4:v$lean_version
elan_home=${ELAN_HOME:-$HOME/.elan}
elan=$(command -v elan || true)
if [ -z "$elan" ]; then elan=$elan_home/bin/elan; fi
if [ ! -x "$elan" ]; then
  need_curl Lean
  installer=$(mktemp)
  trap 'rm -f "$installer"' EXIT
  curl -fsSL https://elan.lean-lang.org/elan-init.sh -o "$installer" || fail "elan: cannot download installer"
  sh "$installer" -y --no-modify-path --default-toolchain none || fail "elan: installation failed"
  rm -f "$installer"
  trap - EXIT
fi
[ -x "$elan" ] || fail "elan: executable missing after installation"
"$elan" toolchain install "$lean_toolchain" || fail "Lean: toolchain $lean_toolchain installation failed"
lean=$(ELAN_TOOLCHAIN=$lean_toolchain "$elan" which lean) || fail "Lean: executable missing for $lean_toolchain"
[ -x "$lean" ] || fail "Lean: executable missing at $lean"
got=$("$lean" --version 2>&1) || fail "Lean: version check failed: $got"
case "$got" in
  "Lean (version $lean_version,"*|"Lean (version $lean_version)"*) ;;
  *) fail "Lean: installed version is '$got', expected $lean_version ($lean_toolchain)" ;;
esac
