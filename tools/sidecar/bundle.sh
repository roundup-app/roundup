#!/usr/bin/env bash
# U3523f: assembles the listing sidecar folder the Daemon finds beside its executable:
# the pinned Node binary, list.mjs, the pinned SDK in node_modules, and NOTICES.md.
# Usage: bundle.sh <dest-dir>   (run after `pnpm install`)
set -euo pipefail

NODE_VERSION=22.23.3
# From https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt
SHA_darwin_arm64=23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53
SHA_darwin_x64=8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8
SHA_linux_x64=df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de

dest=${1:?usage: bundle.sh <dest-dir>}
root=$(cd "$(dirname "$0")/../.." && pwd)
src=$root/crates/agents/sidecar

case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) plat=darwin-arm64; ext=tar.gz; want=$SHA_darwin_arm64 ;;
    Darwin-x86_64) plat=darwin-x64; ext=tar.gz; want=$SHA_darwin_x64 ;;
    Linux-x86_64) plat=linux-x64; ext=tar.xz; want=$SHA_linux_x64 ;;
    *) echo "no pinned Node for $(uname -s)-$(uname -m)" >&2; exit 2 ;;
esac

[ -d "$src/node_modules/@anthropic-ai/claude-agent-sdk" ] || { echo "run pnpm install first" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
name=node-v$NODE_VERSION-$plat
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$name.$ext" -o "$work/node.$ext"
got=$(shasum -a 256 "$work/node.$ext" | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "Node checksum mismatch: $got" >&2; exit 1; }
mkdir "$work/x"
tar -xf "$work/node.$ext" -C "$work/x" "$name/bin/node" "$name/LICENSE"

rm -rf "$dest"
mkdir -p "$dest"
cp "$work/x/$name/bin/node" "$dest/node"
cp "$work/x/$name/LICENSE" "$dest/NODE-LICENSE"
cp "$src/list.mjs" "$src/package.json" "$src/NOTICES.md" "$dest/"
cp -RL "$src/node_modules" "$dest/node_modules"
