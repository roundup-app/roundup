#!/usr/bin/env bash
# CI5330a/d: `disk.sh free` removes the runner image's unused toolchains; `disk.sh report <label>` logs `df -h /` and the sizes of what tests write.
set -u

case "${1:-}" in
  free)
    # Android, .NET, Haskell and the CodeQL bundle are unused by roundup and hold about 25 GB of the image.
    sudo rm -rf /usr/local/lib/android /usr/share/dotnet /opt/ghc /opt/hostedtoolcache/CodeQL /usr/local/share/boost
    df -h / ;;
  report)
    echo "::group::disk $2"
    df -h /
    du -sh "$HOME/.cargo" "$HOME/.rustup" "$HOME/.agent-browser" "$HOME/.local/share/pnpm" "$HOME/.cache" "$HOME/.npm" \
      "${GITHUB_WORKSPACE:-.}/target" "${GITHUB_WORKSPACE:-.}/node_modules" "${GITHUB_WORKSPACE:-.}/artifacts" \
      "${RUNNER_TEMP:-/tmp}" /tmp/chrome-page-* /tmp/vite-cache-* /tmp/roundup-real-* 2>/dev/null | sort -rh | head -15
    echo "::endgroup::" ;;
esac
exit 0
