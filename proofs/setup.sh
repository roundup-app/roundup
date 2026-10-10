#!/usr/bin/env bash
# V1: install the Bend named by proofs/BEND_VERSION into proofs/.tools/bend (git-ignored), once.
# The download's sha256 must match proofs/BEND_SHA256 (one `<sha256>  <asset>` line per platform);
# the installed `bend version` must equal the pin. Usage: proofs/setup.sh
# Test hooks: PROOFS_DIR (holds the pin files and .tools), BEND_BASE_URL (download directory), BEND_ASSET_PLATFORM.
set -euo pipefail

dir=${PROOFS_DIR:-$(cd "$(dirname "$0")" && pwd)}
version=$(tr -d '[:space:]' < "$dir/BEND_VERSION")
base=${BEND_BASE_URL:-https://github.com/bendlang/bend/releases/download/v$version}
tools=$dir/.tools
export BEND_NO_TELEMETRY=1

installed() { "$tools/bend/bin/bend" version 2>/dev/null | grep -Fq "$version"; }
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1"; else shasum -a 256 "$1"; fi | cut -d' ' -f1; }

if [ -x "$tools/bend/bin/bend" ] && installed; then exit 0; fi

command -v curl >/dev/null || { echo "bend: curl is required to download it and is not installed" >&2; exit 1; }
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
[ -x "$work/x/bend/bin/bend" ] || { echo "bend: $asset holds no bend/bin/bend" >&2; exit 1; }
got=$("$work/x/bend/bin/bend" version 2>/dev/null || true)
case "$got" in *"$version"*) ;; *) echo "bend: installed version is '$got', proofs/BEND_VERSION pins $version" >&2; exit 1 ;; esac
mkdir -p "$tools"
rm -rf "$tools/bend"
mv "$work/x/bend" "$tools/bend"
