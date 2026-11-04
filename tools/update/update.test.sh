#!/usr/bin/env bash
# SU5982a-d: the helper against a throwaway repository as main, a fake build and fake programs.
set -euo pipefail
helper=$(cd "$(dirname "$0")" && pwd)/update.sh
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# The fake build writes a `rup` that forks by copying a folder and pings when its socket exists, and
# a Daemon that binds RUPD_SOCKET unless the Project folder holds `break` (or the commit's file says so).
d=rup; daemon=${d}d
FAKE_BUILD='mkdir -p target/debug && cat > target/debug/rup <<"SH"
#!/usr/bin/env bash
case $1 in
data) [ ! -e "$ROUNDUP_DATA_DIR/refuse-fork" ] || { echo "refused" >&2; exit 1; }; mkdir "$3" && echo "{}" ;;
ping) [ -S "$RUPD_SOCKET" ] && echo "pong" ;;
esac
SH
cat > target/debug/'$daemon' <<"SH"
#!/usr/bin/env python3
import os, socket, sys, time
if os.path.exists(os.path.join(sys.argv[1], "break")): sys.exit(1)
s = socket.socket(socket.AF_UNIX); s.bind(os.environ["RUPD_SOCKET"]); s.listen(1)
time.sleep(60)
SH
chmod +x target/debug/rup target/debug/'$daemon'; [ ! -f broken-build ] || exit 7'

fresh() {
    rm -rf "$tmp/w"; mkdir -p "$tmp/w/data" "$tmp/w/home" "$tmp/w/main-proj" "$tmp/w/proj2"
    cd "$tmp/w"
    git init -q src && cd src && git config user.email t@t && git config user.name t
    echo 1 > f; git add f; git commit -qm one; git update-ref refs/remotes/origin/main HEAD
    cd ..
    echo "{\"open\":[\"$tmp/w/main-proj\",\"$tmp/w/proj2\"],\"recent\":[],\"names\":{}}" > data/projects.json
    export ROUNDUP_HOME=$tmp/w/home ROUNDUP_DATA_DIR=$tmp/w/data UPDATE_SOURCE=$tmp/w/src UPDATE_BUILD=$FAKE_BUILD ROUNDUP_SLOT=A
    echo A > home/slots_good_seed; mkdir -p home/slots/A; echo A > home/slots/good
}
move() { (cd "$tmp/w/src" && echo "$1" > f && git commit -qam "$1" && git update-ref refs/remotes/origin/main HEAD); }
run() { set +e; "$helper" "$@" >"$tmp/out" 2>&1; code=$?; set -e; }
hash_tree() { (cd "$1" && find . -type f -not -path './.git' | sort | xargs cat | sha256sum); }
good() { cat "$ROUNDUP_HOME/slots/good"; }

# su5982a: the move builds in B, never A.
fresh; echo a > "$ROUNDUP_HOME/slots/A/keep"; before=$(hash_tree "$ROUNDUP_HOME/slots/A")
move two; run; [ $code = 0 ] || fail "su5982a exit $code: $(cat "$tmp/out")"
[ "$(cat "$ROUNDUP_HOME/slots/B/f")" = two ] || fail "su5982a: B lacks the new commit"
[ "$before" = "$(hash_tree "$ROUNDUP_HOME/slots/A")" ] || fail "su5982a: A changed"
# a commit already built is not built again
run; grep -q 'up to date' "$tmp/out" || fail "su5982a: rebuilt a built commit"
# a further move supersedes a build in flight
fresh; move three; UPDATE_BUILD='sleep 30' "$helper" >/dev/null 2>&1 & first=$!
sleep 1; move four; run
wait "$first" 2>/dev/null || true
[ "$(cat "$ROUNDUP_HOME/slots/B/f")" = four ] && [ "$(good)" = B ] || fail "su5982a: second move did not supersede"

# su5982b/c: the check opens every Project on a Fork and good changes only after it.
fresh; move two; run
[ $code = 0 ] || fail "su5982c pass exit $code"
grep -q "opened $tmp/w/main-proj" "$tmp/out" && grep -q "opened $tmp/w/proj2" "$tmp/out" || fail "su5982b: log names no opened Project"
[ "$(good)" = B ] || fail "su5982c: good not B after a pass"
[ "$(tail -n 1 "$tmp/out")" = "good: B" ] || fail "su5982c: good written before the check ended"
[ ! -e "$ROUNDUP_HOME/slots/B/failed.json" ] || fail "su5982c: failed.json after a pass"

step() { # name code expected-step
    [ "$code" = "$2" ] || fail "su5982c $1 exit $code: $(cat "$tmp/out")"
    [ "$(jq -r .step "$ROUNDUP_HOME/slots/B/failed.json")" = "$3" ] || fail "su5982c $1 step"
    [ "$(cat "$ROUNDUP_HOME/slots/good")" = A ] || fail "su5982c $1 moved good"
}
fresh; move two; UPDATE_BUILD='echo boom; exit 9' run; step build 1 build
grep -q boom "$ROUNDUP_HOME/slots/B/failed.json" || fail "su5982c: build cause missing"
fresh; touch data/refuse-fork; move two; run; step fork 2 fork
fresh; move two; UPDATE_BUILD="${FAKE_BUILD/Daemon/}"' ; sed -i "s/^s = .*/time.sleep(60)/" target/debug/'$daemon' ; echo' run; step ping 3 ping
fresh; touch main-proj/break; move two; run; step open 4 open
jq -r .cause "$ROUNDUP_HOME/slots/B/failed.json" | grep -q "$tmp/w/main-proj" || fail "su5982c: open cause lacks the Project"
# a new check clears failed.json
rm main-proj/break; move three; run; [ ! -e "$ROUNDUP_HOME/slots/B/failed.json" ] || fail "su5982c: failed.json kept"
# the live folder is untouched (FK5977e is the Fork's own test)
fresh; sum=$(hash_tree data); move two; run; [ "$sum" = "$(hash_tree data)" ] || fail "su5982b: live folder changed"
# a kill mid-check leaves good as it was
fresh; move two; UPDATE_BUILD='sleep 30' "$helper" >/dev/null 2>&1 & pid=$!
sleep 1; kill "$pid"; wait "$pid" 2>/dev/null || true; [ "$(good)" = A ] || fail "su5982c: kill moved good"

# su5982d: pass, failure, pass use alternating slots and never write the running or good slot.
fresh; move two; run; [ "$(good)" = B ] || fail "su5982d first pass"
ROUNDUP_SLOT=B; export ROUNDUP_SLOT                # the App restarted into B
b=$(hash_tree "$ROUNDUP_HOME/slots/B")
move three; UPDATE_BUILD='exit 1' run
[ -s "$ROUNDUP_HOME/slots/A/failed.json" ] && [ "$(good)" = B ] || fail "su5982d: failure used the wrong slot"
move four; run; [ "$(good)" = A ] && [ "$b" = "$(hash_tree "$ROUNDUP_HOME/slots/B")" ] || fail "su5982d: B written or good wrong"
# with the App still on B and good on A there is no spare
move five; run; [ $code = 5 ] || fail "su5982d: expected no spare, got $code"
run --rollback; [ "$(good)" = B ] || fail "su5982d: rollback did not restore B"
echo "ok"
