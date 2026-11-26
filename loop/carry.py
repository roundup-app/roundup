"""L24, L103: whether a PR's new head keeps the verdict an earlier head got. It reads GitHub and writes nothing: `builder.py`
sets the statuses."""
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

# L103: a test file is one the repo already names so: `.test.` files (`loop/affected.py`, `loop/rules.sh`), `*tests.rs` files
# and `tests/` folders (`tools/typed-calls/guard.sh`). Git heads a hunk inside an inline Rust `mod tests {` with that line,
# and rustfmt indents all of such a module: a hunk with a line at column 0 reaches code outside it.
TEST_PATH = re.compile(r'\.test\.[^/]+$|tests\.rs$|(?:^|/)tests/')
TEST_HUNK = re.compile(r'@@[^@]*@@ (?:pub(?:\([a-z]+\))? )?mod \w*tests \{')
OUTSIDE = re.compile(r'^[ +-]\S', re.M)


def without_tests(diff):
    """`diff` less each file section whose paths are all test files (`TEST_PATH`), and each hunk in a Rust `mod tests` that
    holds no line outside it; a file left with no hunk goes too."""
    kept = []
    for section in re.split(r'^(?=diff --git )', diff, flags=re.M):
        paths = re.match(r'diff --git a/(.+?) b/(.+)', section)
        if paths and all(TEST_PATH.search(path) for path in paths.groups()):
            continue
        top, *hunks = re.split(r'^(?=@@ )', section, flags=re.M)
        left = [hunk for hunk in hunks if not (TEST_HUNK.match(hunk) and not OUTSIDE.search(hunk))]
        if not hunks or left:
            kept.append(top + ''.join(left))
    return ''.join(kept)


def patch_id(head, tests=True):
    """`git patch-id --stable` of the PR's diff at `head` against its merge base with `main`, without its test files unless
    `tests`; '' when GitHub gives none (HTTP 422 on #5484's 2.5 GB deletion) or nothing is left."""
    try:
        diff = orders.call('api', f'repos/{{owner}}/{{repo}}/compare/main...{head}', '-H', 'Accept: application/vnd.github.diff',
                           '--allow-escape-sequences')
    except subprocess.CalledProcessError:
        return ''
    diff = diff if tests else without_tests(diff)
    found = subprocess.run(['git', 'patch-id', '--stable'], input=diff, check=True, text=True, capture_output=True).stdout
    return found.split()[0] if found else ''


def stands_for(head, earlier, marker):
    """Whether a `marker` comment (`VERDICT:` or `CRITIC:`) that names `earlier` holds for `head`: it names that head, or
    the diff there has the same patch-id (L24), as a merge of `main` keeps it. For the design critic the diff leaves test
    files out (L103): a commit that changes only tests cannot change what it judges."""
    if earlier == head:
        return True
    tests = marker != 'CRITIC:'
    now = patch_id(head, tests)
    return bool(now) and patch_id(earlier, tests) == now


def approved_before(current, marker):
    """The head an earlier `marker` approval names whose diff has the PR's head's patch-id (L24); '' for none."""
    now = patch_id(current['headRefOid'])
    for note in reversed(orders.marked(current['number'], marker)):
        earlier = orders.field(note['body'], 'Head')
        if note['body'].startswith(f'{marker} approve') and now and patch_id(earlier) == now:
            return earlier
    return ''


def over_tests(current):
    """L103: (verdict, head) of the last `CRITIC:` comment when it names another head than the PR's whose diff differs from
    the PR's head's only in test files (`stands_for`); None for no comment, one on this head (a rerun judges again), or a
    head with changes beyond tests."""
    notes = orders.marked(current['number'], 'CRITIC:')
    earlier = orders.field(notes[-1]['body'], 'Head', '') if notes else ''
    if not earlier or earlier == current['headRefOid'] or not stands_for(current['headRefOid'], earlier, 'CRITIC:'):
        return None
    return ('approve' if notes[-1]['body'].startswith('CRITIC: approve') else 'reject'), earlier


def open_reject(head, criticisms, answered):
    """Whether the last `CRITIC:` comment rejects `head` and no fix run began since: it names `head` and was posted after
    the fix run that began at `answered`, or it names a head whose diff differs from `head`'s only in test files (L103), the
    reject `over_tests` carried to `head` with a status and no comment."""
    if not criticisms or not criticisms[-1]['body'].startswith('CRITIC: reject'):
        return False
    earlier = orders.field(criticisms[-1]['body'], 'Head', '')
    if earlier == head:
        return orders.created(criticisms[-1]['created_at']) > answered
    return stands_for(head, earlier, 'CRITIC:')
