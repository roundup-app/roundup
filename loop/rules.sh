#!/usr/bin/env bash
# Machine checks for AGENTS.md. Usage: loop/rules.sh vocab | tokens | laws | delta <base-dir> <head-dir> | base|ci-trailers|keeps-main|overturned|captures <pr> | architect-words | clean-merge <commit> [main-ref] | scenario-ids | capture-prepare <pr> <directory> | capture-publish <pr> <directory> <artifact-url>
# Scans: `vocab` reads public Rust items and fields, TS exports, and non-comment text under contracts/.
# It does not read imports, enum variants or UI strings.
set -euo pipefail
caller_dir=$PWD
case "${1:-}" in
  captures | capture-prepare | capture-publish | capture-run) cd "$caller_dir" ;;
  *) cd "$(dirname "$0")/.." ;;
esac

# grep that treats "no match" as success but a real error as failure.
g() { grep "$@" || [ $? -eq 1 ]; }

# Avoid words from GLOSSARY.md, lowercased; a two-word term joins with `_`.
avoid_phrases() {
  local phrases
  phrases=$(sed -n 's/^_Avoid_: \([^.;]*\).*/\1/p' GLOSSARY.md | tr ',' '\n' |
    awk 'NF { print tolower(($2 != "" && $2 != "in") ? $1 "_" $2 : $1) }')
  [ -n "$phrases" ] || { echo "rule 6: no _Avoid_ words found in GLOSSARY.md" >&2; return 1; }
  echo "$phrases"
}

# Lowercased snake tokens of public names.
public_names() {
  local rust_pub='pub(\([a-z ]+\))? +((async|const|unsafe|extern) +)*(fn|struct|enum|trait|const|static|type|mod|union) +[A-Za-z0-9_]+'
  local rust_field='^ *pub(\([a-z ]+\))? +[A-Za-z0-9_]+ *:'
  local ts='export +(declare +)?(async +)?(function|const|type|interface|class|enum) +[A-Za-z0-9_]+'
  local dirs="" d
  for d in contracts apps ext; do [ ! -d "$d" ] || dirs="$dirs $d"; done
  {
    find crates -path crates/agents/src/claude_code -prune -o -name '*.rs' -print0 |
      xargs -0 grep -hoE "$rust_pub|$rust_field" | tr -d ':' | awk '{ print $NF }'
    # shellcheck disable=SC2086 # $dirs is a word list on purpose
    if [ -n "$dirs" ]; then
      g -rhoE "$ts" $dirs --include='*.ts' --include='*.tsx' | awk '{ print $NF }'
      g -rhvE '^\s*(//|/\*|\*)' contracts | g -oE '[A-Za-z][A-Za-z0-9_.-]*'
    fi
  } | sed -E 's/([a-z0-9])([A-Z])/\1_\2/g' | tr 'A-Z.-' 'a-z__' | sort -u
}

vocab() {
  local phrases names bad=0 phrase name
  phrases=$(avoid_phrases)
  names=$(public_names)
  while read -r phrase; do
    while read -r name; do
      case "_${name}_" in *"_${phrase}_"* | *"_${phrase}s_"* | *"_${phrase}es_"*) echo "rule 6: '$name' uses Avoid word '$phrase'" >&2; bad=1 ;; esac
    done <<<"$names"
  done <<<"$phrases"
  return "$bad"
}

# Y3: one `id | law | check` line for each scenario clause carrying a `Law:` line, sorted by id. Exit 1 for an unchecked law or a test prefix no test has, 4 without scenarios/.
laws() {
  [ -d scenarios ] || { echo "laws: scenarios/ is missing" >&2; return 4; }
  local sheet status=0 prefix id
  sheet=$(python3 - <<'PY'
import glob
import re

rows = {}
for path in glob.glob('scenarios/**/*.md', recursive=True):
    clause = None
    for line in open(path, encoding='utf-8'):
        heading = re.match(r'\*\*([A-Za-z]+[0-9]+)[ .]', line)
        if heading:
            clause = heading.group(1)
        law = re.match(r'Law: (.*?)\.? *(?:Check: *(.*?) *)?$', line.rstrip('\n'))
        if law and clause:
            rows[clause] = (law.group(1), law.group(2) or 'unchecked')
for key in sorted(rows):
    print(f'{key} | {rows[key][0]} | {rows[key][1]}')
PY
)
  [ -z "$sheet" ] || echo "$sheet"
  while IFS='|' read -r id _ prefix; do
    id=${id// /}
    prefix=${prefix// /}
    [ -n "$id" ] || continue
    if [ "$prefix" = unchecked ]; then
      echo "laws: $id has no Check" >&2
      status=1
    elif [[ $prefix =~ ^[a-z][a-z0-9]*_$ ]] &&
      ! grep -rIlE --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=target --exclude-dir=scenarios --exclude-dir=docs "(fn |[\"'\` ]|^)${prefix}[a-z0-9_]" . >/dev/null 2>&1; then
      echo "laws: $id names '$prefix' and no test has it" >&2
      status=1
    fi
  done <<<"$sheet"
  return "$status"
}

# L95: the role word "architect" in scenarios/ or docs/ fails as `<file>:<line>`; a branch `architect/…`, a host `architect-swarm|-b|-c` and the L95 block are exempt.
architect_words() {
  git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "architect-words: not a git checkout" >&2; return 2; }
  python3 -I - <<'PY'
import os
import re
import sys

WORD = re.compile(r'\b[Aa]rchitects?\b')
EXEMPT = re.compile(r'/|-(swarm|b|c)(?![\w-])')
bad = 0
for root in ('scenarios', 'docs'):
    for dirpath, _, names in os.walk(root):
        for name in sorted(names):
            path = os.path.join(dirpath, name)
            try:
                lines = open(path, encoding='utf-8').read().split('\n')
            except (UnicodeDecodeError, OSError):
                continue
            in_block = False
            for number, line in enumerate(lines, 1):
                if line.startswith('**L95 '):
                    in_block = True
                if in_block:
                    in_block = not line.startswith('Tests:')
                    continue
                for match in WORD.finditer(line):
                    if not EXEMPT.match(line, match.end()):
                        print(f'{path}:{number}')
                        bad = 1
                        break
sys.exit(bad)
PY
}

# L97: no two scenario headings (`**<ID> `) share an id, in one file or across files.
scenario_ids() { python3 loop/scenario_ids.py check; }

# L41: a look literal (colour, size, radius, shadow, duration) outside tokens.css fails as `<file>:<line> <property>`.
tokens() {
  python3 - <<'PY'
import os
import re
import sys

ROOT = 'apps/desktop/src'
NAMES = set('''aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen
darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia
gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender
lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta
maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow
springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'''.split())
COLOUR = re.compile(r'^(color|background|background-color|border.*|outline.*|fill|stroke|caret-color|text-decoration-color)$')
TS_COLOUR = {'color', 'background', 'backgroundColor', 'borderColor'}
TS_KEYS = TS_COLOUR | {'fontSize', 'borderRadius', 'boxShadow'}
HEX = re.compile(r'#[0-9a-fA-F]{3,8}\b')
FUNC = re.compile(r'(?<![\w-])(rgb|rgba|hsl|hsla|oklch|color-mix)\(', re.I)
UNIT = re.compile(r'(?<![\w.#-])[+-]?(\d*\.?\d+)([a-z%]+)', re.I)
DURATION = re.compile(r'(?<![\w.#-])(\d*\.?\d+)(ms|s)\b', re.I)
BARE = re.compile(r'(?<![\w#-])[A-Za-z]+(?![\w(-])')


def blank(text, slashes):
    # Comments become spaces; newlines and strings stay.
    out, i, n, quote = [], 0, len(text), None
    while i < n:
        c = text[i]
        if quote:
            out.append(c)
            if c == '\\' and i + 1 < n:
                out.append(text[i + 1])
                i += 1
            elif c == quote:
                quote = None
        elif c in '"\'`':
            quote = c
            out.append(c)
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r'[^\n]', ' ', text[i:j]))
            i = j
            continue
        elif slashes and text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
            continue
        else:
            out.append(c)
        i += 1
    return ''.join(out)


def strip_calls(value, names):
    # Remove name(...) calls, balanced.
    while True:
        m = re.search(r'(?<![\w-])(%s)\(' % '|'.join(names), value, re.I)
        if not m:
            return value
        depth, j = 1, m.end()
        while j < len(value) and depth:
            depth += {'(': 1, ')': -1}.get(value[j], 0)
            j += 1
        value = value[:m.start()] + ' ' + value[j:]


def has_colour(v):
    if HEX.search(v) or FUNC.search(v):
        return True
    return any(w.lower() in NAMES for w in BARE.findall(v))


def nonzero(v, pattern):
    return any(float(m.group(1)) != 0 for m in pattern.finditer(v))


def bad(prop, value, ts):
    raw = value
    v = strip_calls(strip_calls(value, ['url']), ['var'])
    if prop in ('fontSize', 'borderRadius', 'font-size', 'border-radius'):
        if ts and re.fullmatch(r'\s*[+-]?\d*\.?\d+\s*', v) and float(v) != 0:
            return True
        return nonzero(v, UNIT)
    if prop in ('boxShadow', 'box-shadow'):
        if has_colour(v):
            return True
        return 'var(' not in raw and v.strip().strip('"\'`').lower() not in ('none', 'inherit', 'initial', 'unset', '')
    if prop.startswith(('transition', 'animation')) and not ts:
        return nonzero(v, DURATION)
    if (ts and prop in TS_COLOUR) or (not ts and COLOUR.match(prop)):
        return has_colour(v)
    return False


def line_of(text, pos):
    return text.count('\n', 0, pos) + 1


def css(text):
    for m in re.finditer(r'(?<![\w-])([a-zA-Z-]+)\s*:\s*([^;{}]*)', text):
        if bad(m.group(1).lower(), m.group(2), False):
            yield line_of(text, m.start(1)), m.group(1)


def style_objects(text):
    for m in re.finditer(r'style\s*=\s*\{\s*\{', text):
        depth, j, quote = 2, m.end(), None
        while j < len(text) and depth > 1:
            c = text[j]
            if quote:
                if c == '\\':
                    j += 1
                elif c == quote:
                    quote = None
            elif c in '"\'`':
                quote = c
            elif c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
            j += 1
        yield m.end(), text[m.end():j - 1]


def ts(text):
    for start, body in style_objects(text):
        # Entries `key: value` at the object's top level.
        depth, quote, i, entries, last = 0, None, 0, [], 0
        while i <= len(body):
            c = body[i] if i < len(body) else ','
            if quote:
                if c == '\\':
                    i += 1
                elif c == quote:
                    quote = None
            elif c in '"\'`':
                quote = c
            elif c in '([{':
                depth += 1
            elif c in ')]}':
                depth -= 1
            elif c == ',' and depth == 0:
                entries.append((last, body[last:i]))
                last = i + 1
            i += 1
        for off, entry in entries:
            m = re.match(r'\s*["\']?([A-Za-z]+)["\']?\s*:\s*(.*)', entry, re.S)
            if m and m.group(1) in TS_KEYS and bad(m.group(1), m.group(2), True):
                yield line_of(text, start + off + m.start(1)), m.group(1)


def skipped(path):
    rel = os.path.relpath(path, ROOT).split(os.sep)
    return (rel == ['tokens.css'] or rel == ['terminal', 'emulator.ts'] or 'testing' in rel[:-1]
            or '.test.' in rel[-1])


found = []
for dirpath, dirs, files in os.walk(ROOT):
    dirs.sort()
    for name in sorted(files):
        path = os.path.join(dirpath, name)
        if skipped(path) or not name.endswith(('.css', '.ts', '.tsx')):
            continue
        with open(path, encoding='utf-8') as f:
            text = f.read()
        hits = css(blank(text, False)) if name.endswith('.css') else ts(blank(text, True))
        found += [f'{path}:{line} {prop}' for line, prop in hits]
if found:
    print('\n'.join(found))
    sys.exit(1)
PY
}

visual_check_ids="D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13 D14"

# A directory argument names a path from where the script was run, not from the repo root it moves to.
caller_path() { (cd "$caller_dir" && cd "$1" 2>/dev/null && pwd); }

checks_files() { (cd "$1" && find . -name '*.checks.json' | sed 's|^\./||'); }

# The status of check $2 in checks file $1. Anything but pass or fail is an error, never a pass.
check_status() {
  local status
  status=$(jq -r --arg id "$2" '.[$id].status // "missing"' "$1") || { echo "delta: $1 is not JSON" >&2; return 2; }
  case $status in
    pass | fail) echo "$status" ;;
    *) echo "delta: $1 check $2 has status '$status', not pass or fail" >&2; return 2 ;;
  esac
}

# Rule 8: compares two builds' design checks (docs/design-system.md). Exit 1 when a check regressed, 2 when the input cannot be compared.
delta() {
  local base_dir head_dir files out="" regressed=0 file dir id was now verdict
  if ! base_dir=$(caller_path "$1") || ! head_dir=$(caller_path "$2"); then
    echo "delta: usage: delta <base-dir> <head-dir>, both directories" >&2; return 2
  fi
  files=$(sort -u <(checks_files "$base_dir") <(checks_files "$head_dir"))
  [ -n "$files" ] || { echo "delta: no .checks.json files in $base_dir or $head_dir" >&2; return 2; }
  while read -r file; do
    for dir in "$base_dir" "$head_dir"; do
      [ -f "$dir/$file" ] || { echo "delta: $file is missing from $dir" >&2; return 2; }
    done
    for id in $visual_check_ids; do
      was=$(check_status "$base_dir/$file" "$id") || return 2
      now=$(check_status "$head_dir/$file" "$id") || return 2
      case "$was $now" in
        "fail pass") verdict=fixed ;;
        "pass fail") verdict=regressed; regressed=1 ;;
        "fail fail") verdict=still-failing ;;
        *) verdict=still-passing ;;
      esac
      out+="${file%.checks.json} $id $verdict"$'\n'
    done
  done <<<"$files"
  printf '%s' "$out"
  return "$regressed"
}

# L54: a clean merge of main: two parents, the second on main, no conflict, and nothing beyond the trial merge.
# It adds no authored content, so it needs no Author-Agent, and an approve on its first parent still covers it.
clean_merge() {
  local c=$1 main_ref=$2 p1 p2 extra trial conflicted f
  read -r _ p1 p2 extra <<<"$(git rev-list --parents -n 1 "$c")"
  { [ -n "${p2:-}" ] && [ -z "${extra:-}" ]; } || { echo "clean-merge: $c: not a merge of main" >&2; return 1; }
  git merge-base --is-ancestor "$p2" "$main_ref" || { echo "clean-merge: $c: not a merge of main (second parent is not on $main_ref)" >&2; return 1; }
  local mt_rc=0
  trial=$(git merge-tree --write-tree --name-only --no-messages "$p1" "$p2" 2>/dev/null) || mt_rc=$?
  { [ "$mt_rc" -le 1 ] && [ -n "$trial" ]; } || { echo "clean-merge: $c: merge-tree failed (exit $mt_rc)" >&2; return 1; }
  conflicted=$(sed 1d <<<"$trial" | sed '/^$/d')
  trial=$(head -n 1 <<<"$trial")
  f=$(head -n 1 <<<"$conflicted")
  [ -z "$f" ] || { echo "clean-merge: $c: rule a: a conflict in $f" >&2; return 1; }
  local differs
  differs=$(git diff --name-only "$trial" "$c") || { echo "clean-merge: $c: could not compare with the trial merge" >&2; return 1; }
  f=$(head -n 1 <<<"$differs")
  [ -z "$f" ] || { echo "clean-merge: $c: rule c: $f differs from the trial merge" >&2; return 1; }
}

# PR trees are data: never check them out or execute their copy of this script.
pr_rule() {
  python3 - "$@" <<'PY'
import json
import os
import re
import subprocess
import sys
import tempfile
import shutil
import zipfile
from pathlib import Path
from datetime import datetime
import time

command, number, *extra = sys.argv[1:]

class Refused(Exception):
    pass

def require(ok, reason):
    if not ok:
        raise Refused(reason)

try:
    limit = float(os.environ.get('LOOP_GH_TIMEOUT', '20'))
    budget = float(os.environ.get('LOOP_GH_RETRY_BUDGET', '4200'))
    wait = float(os.environ.get('LOOP_GH_RETRY_WAIT', '60'))
    require(all(0 < value < float('inf') for value in (limit, budget, wait)),
            'GitHub timeout, retry budget and wait must be finite and positive')
except (ValueError, Refused) as error:
    print(error, file=sys.stderr)
    sys.exit(4)

def gh(route):
    deadline = time.monotonic() + budget
    while True:
        try:
            result = subprocess.run(['gh', 'api', route, '--paginate', '--slurp'],
                                    text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    timeout=limit, check=False)
            if result.returncode and any(refusal in result.stderr for refusal in
                                         ('API rate limit exceeded', 'secondary rate limit')):
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    print(result.stderr, file=sys.stderr, end='')
                    print('LOOP_RULES_API_LIMIT: GitHub refused the rules read; rerun this job.', file=sys.stderr)
                    sys.exit(75)
                print(f'gh: {route}: GitHub rate limit; retrying within {remaining:.0f}s', file=sys.stderr)
                time.sleep(min(wait, remaining))
                continue
            if result.stderr:
                print(result.stderr, file=sys.stderr, end='')
            result.check_returncode()
            pages = json.loads(result.stdout)
            require(isinstance(pages, list) and bool(pages), 'gh returned no pages')
            return pages
        except (subprocess.SubprocessError, OSError, ValueError, Refused) as error:
            print(f'gh: {route}: {error}', file=sys.stderr)
            sys.exit(4)

def one(route):
    pages = gh(route)
    require(len(pages) == 1 and isinstance(pages[0], dict), f'invalid object: {route}')
    return pages[0]

repo = 'repos/{owner}/{repo}'
pull = f'{repo}/pulls/{number}'

def git(*args):
    return subprocess.check_output(['git', *args], text=True, timeout=limit).rstrip('\n')

def present(value):
    return subprocess.run(['git', 'cat-file', '-e', value+'^{commit}'], stderr=subprocess.DEVNULL).returncode == 0

def sha(value):
    require(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{40}', value), 'missing or invalid SHA')
    return value

def fetch(value):
    if not present(value):
        # Fetch objects only; hooks, checkout filters and PR executables never run.
        subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', 'fetch', '--no-tags', 'origin', value],
                       timeout=limit, check=True, stdout=subprocess.DEVNULL)

def base_gate(pr):
    ref = pr['base']['ref']
    require(ref == 'main', f'base is {ref}, not main')

def trailers(commit, key, shape=r'[A-Za-z0-9_.-]+'):
    value = git('show', '-s', f'--format=%(trailers:key={key},valueonly)', commit)
    ids = value.splitlines()
    require(all(re.fullmatch(shape, agent) for agent in ids), f'invalid {key} on {commit}')
    return set(ids)

COPILOT = 'Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>'

# L37: a Copilot Autofix commit accepted on GitHub is authored by `copilot`: it carries Copilot's trailer, GitHub
# committed it, and its signature verifies against GitHub's web-flow key in loop/web-flow.asc and no other key.
def copilot(commit):
    message = git('show', '-s', '--format=%B', commit)
    if COPILOT not in message.splitlines() or git('show', '-s', '--format=%ce', commit) != 'noreply@github.com':
        return False
    with tempfile.TemporaryDirectory() as home:
        env = {**os.environ, 'GNUPGHOME': home}
        imported = subprocess.run(['gpg', '--batch', '--quiet', '--import', 'loop/web-flow.asc'], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=limit)
        return imported.returncode == 0 and subprocess.run(
            ['git', '-c', 'gpg.program=gpg', '-c', 'gpg.ssh.allowedSignersFile=/dev/null', 'verify-commit', commit], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=limit).returncode == 0

def history(base, head):
    commits = git('rev-list', '--reverse', base+'..'+head).splitlines()
    require(commits, 'no PR commits')
    authors, records = set(), []
    for commit in commits:
        parents = git('rev-list', '--parents', '-n', '1', commit).split()[1:]
        author, reviewer = trailers(commit, 'Author-Agent'), trailers(commit, 'Reviewed-by-Agent')
        if not author and not reviewer and len(parents) == 1 and copilot(commit):
            author = {'copilot'}
        authors.update(author)
        records.append((commit, parents, author, reviewer))
    require(authors, 'no Author-Agent trailers')
    return records

def clean_merge(commit, base):
    try:
        return subprocess.run(['bash', 'loop/rules.sh', 'clean-merge', commit, base], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, timeout=limit).returncode == 0
    except subprocess.TimeoutExpired:
        return False

# L2: an approval is a VERDICT comment, never a commit.
def trailer_gate(records, base):
    for commit, parents, author, reviewer in records:
        require(not reviewer, f'trailers: {commit} carries Reviewed-by-Agent; an approval is a VERDICT comment')
        if len(parents) == 1:
            require(author, f'trailers: {commit} has no Author-Agent')
        else:
            require(author or clean_merge(commit, base), f'trailers: merge {commit} needs Author-Agent or must be a clean merge of main')

# L101: the window reaches back a build or fix job's limit (120 minutes) before the PR's earliest commit.
WINDOW = 2 * 3600
LABEL = r'#[0-9]+|[0-9a-f]{12}'

def plumbing(*args, env=None):
    # Plumbing output, untrimmed: no colour, external diff, textconv or prefix config reaches it.
    return subprocess.run(['git', '--literal-pathspecs', *args], text=True, stdout=subprocess.PIPE, env=env,
                          timeout=limit, check=True).stdout

# (path, patch) for each hunk of a patch, the hunk under its file's header.
def hunks(patch):
    header, current, out = [], None, []
    for line in patch.splitlines(keepends=True):
        if line.startswith('diff --git '):
            header, current = [line], None
        elif line.startswith('@@'):
            current = [''.join(header), line]
            out.append(current)
        elif current is None:
            header.append(line)
        else:
            current.append(line)
    for head, *body in out:
        path = re.search(r'^(?:\+\+\+ b/|--- a/)(.+)$', head, re.M)
        yield (path[1] if path else head.split('\n', 1)[0]), head + ''.join(body)

def applies(env, patch):
    result = subprocess.run(['git', '-c', 'apply.ignoreWhitespace=no', 'apply', '--cached', '--check', '--whitespace=nowarn', '-'],
                            text=True, input=patch, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=limit)
    if result.returncode > 1:
        raise subprocess.CalledProcessError(result.returncode, 'git apply --check')
    return result.returncode == 0

def label(commit):
    pull = re.match(r'Merge pull request #([0-9]+) ', git('show', '-s', '--format=%s', commit))
    return f'#{pull[1]}' if pull else commit[:12]

# Each hunk a first-parent commit from `base` back into the window made that applies to `head` and not to `base`:
# work `main` holds that the head undoes. Returns {label: paths}.
def undone(base, head):
    times = [int(line) for line in git('rev-list', '--format=%at', base+'..'+head).splitlines() if not line.startswith('commit ')]
    paths = [path for path in plumbing('diff-tree', '-r', '-z', '--name-only', '--no-renames', base, head).split('\0') if path]
    if not times or not paths:
        return {}
    empty = plumbing('hash-object', '-t', 'tree', '/dev/null').strip()
    found = {}
    with tempfile.TemporaryDirectory() as tmp:
        trees = {}
        for name, rev in (('head', head), ('base', base)):
            trees[name] = {**os.environ, 'GIT_INDEX_FILE': os.path.join(tmp, name)}
            plumbing('read-tree', rev, env=trees[name])
        walk = git('rev-list', '--first-parent', '--parents', '--timestamp', f'--max-age={min(times) - WINDOW}', base)
        for line in walk.splitlines():
            _, commit, *parents = line.split()
            patch = plumbing('diff-tree', '-p', '-r', '--no-renames', (parents or [empty])[0], commit, '--', *paths)
            reverted = {path for path, hunk in hunks(patch) if applies(trees['head'], hunk) and not applies(trees['base'], hunk)}
            if reverted:
                found.setdefault(label(commit), set()).update(reverted)
    return found

def keeps_main(base, head):
    found = undone(base, head)
    declared = set().union(*(trailers(commit, 'Undoes', LABEL) for commit in git('rev-list', base+'..'+head).splitlines()))
    missing = [name for name in found if name not in declared]
    def named(name):
        paths = sorted(found[name])
        return f'  {name}: {", ".join(paths[:3])}' + (f' and {len(paths) - 3} more' if len(paths) > 3 else '')
    require(not missing, '\n'.join([
        f'{head} undoes work main merged after this branch started; merging it would revert it:',
        *map(named, missing),
        "Restore main's side of those hunks, or, when undoing it is this PR's purpose, add these lines to the final "
        'trailer block of a commit on this branch, which its review judges:',
        *(f'  Undoes: {name}' for name in missing)]))
    if found:
        print(f'keeps-main: {head} undoes {", ".join(found)}, as its Undoes: trailers declare; its review judges each')

# L102: each scenario id on the PR body's `Scenarios:` line that a scenario file on `base` overturns, with the id that
# overturns it. A note is a line holding `Overturned by <id>`, and it belongs to the id of the nearest heading above it.
def overturned(base, body):
    named = set(re.findall(r'\b[A-Z][0-9]+[a-z]?\b', ' '.join(re.findall(r'^Scenarios:(.*)$', body or '', re.M))))
    found = {}
    for path in plumbing('ls-tree', '-r', '--name-only', base, '--', 'scenarios').split('\n'):
        if not path.endswith('.md'):
            continue
        current = None
        for line in plumbing('show', f'{base}:{path}').splitlines():
            heading = re.match(r'\*\*([A-Z][0-9]+[a-z]?)[ .]', line)
            current = heading[1] if heading else current
            note = re.search(r'Overturned by ([A-Z][0-9]+[a-z]?)', line)
            if note and current in named:
                found[current] = note[1]
    require(not found, '\n'.join(f'{name} is overturned by {by} on main; the PR builds what main replaced' for name, by in sorted(found.items())))

# L112: retirement is deletion-only; generated payloads are never committed.
EVIDENCE = ('artifacts', 'crates/rpc/r16', 'crates/rupd/evidence')
PUBLICATION = r'^Capture publication: (.*)$'

def cited(body):
    return set(re.findall(r'\b[A-Z][0-9]+[a-z]?\b', ' '.join(re.findall(r'^Scenarios:(.*)$', body or '', re.M))))

def capture_owner(path):
    parts = path.split('/')
    if path.startswith('artifacts/ux/'):
        if len(parts) > 4 and parts[2] == 'journey':
            return parts[3] if re.fullmatch(r'J[0-9]+[a-z]?', parts[3]) else None
        return parts[2] if len(parts) > 3 and not parts[2].startswith('J') and re.fullmatch(r'[A-Z][0-9]+[a-z]?', parts[2]) else None
    return None

def capture_required(base, head, body):
    explicit = set(re.findall(r'\b[A-Z][0-9]+[a-z]?\b', ' '.join(re.findall(r'^Capture required:(.*)$', body or '', re.M))))
    changed = plumbing('diff', '--name-only', base, head, '--', 'apps/desktop/src').splitlines()
    # Specifications and tests alone have no rendered payload; source changes keep the rendered observer.
    visible = any(not re.search(r'\.test\.[^.]+$', path) for path in changed)
    rendered = {name for name in cited(body) if name.startswith(('U', 'J'))} if visible else set()
    require(not visible or rendered, 'desktop source change has no cited rendered capture scenario')
    return explicit | rendered

def parse_capture(data, head, named, required):
    require(isinstance(data, dict) and set(data) == {'revision', 'observers'}, 'invalid capture manifest fields')
    require(data['revision'] == head, 'capture revision is not the PR head')
    require(isinstance(data['observers'], list) and data['observers'], 'capture observers are missing')
    paths, observed = set(), set()
    for row in data['observers']:
        require(isinstance(row, dict) and set(row) == {'ids', 'command', 'exit_code', 'conditions', 'paths'},
                'invalid capture observer fields')
        ids = row['ids']
        require(isinstance(ids, list) and ids and all(isinstance(i, str) and re.fullmatch(r'[A-Z][0-9]+[a-z]?', i) for i in ids),
                'invalid capture scenario ids')
        require(set(ids) <= named, 'capture names an uncited scenario')
        require(type(row['exit_code']) is int and row['exit_code'] == 0, 'capture observer failed or has no exit code')
        for key in ('command', 'conditions'):
            require(isinstance(row[key], str) and row[key].strip() and len(row[key]) <= 2048,
                    f'capture {key} is missing or too long')
        require(isinstance(row['paths'], list) and row['paths'], 'capture payload is missing')
        for path in row['paths']:
            require(isinstance(path, str) and path and not path.startswith('/') and
                    all(part not in ('', '.', '..') for part in path.split('/')) and
                    any(path.startswith(root + '/') for root in EVIDENCE), 'invalid capture payload path')
            if path.startswith('artifacts/ux/'):
                require(capture_owner(path) in ids, f'{path}: malformed or uncited capture ownership')
            require(path not in paths, f'{path}: duplicate capture payload')
            paths.add(path)
        observed.update(ids)
    require(required <= observed, 'required captures are missing: ' + ', '.join(sorted(required - observed)))
    return paths

def capture_record(body):
    rows = re.findall(PUBLICATION, body or '', re.M)
    require(len(rows) <= 1, 'duplicate capture publication')
    if not rows:
        return None
    data = json.loads(rows[0])
    require(isinstance(data, dict) and set(data) == {'url', 'retention_days', 'revision', 'observers'},
            'invalid capture publication fields')
    require(type(data['retention_days']) is int and data['retention_days'] == 14, 'capture retention must be 14 days')
    return data

def capture_facts(manifest):
    return {'revision': manifest['revision'], 'observers': [
        {key: row[key] for key in ('ids', 'command', 'exit_code', 'conditions')} for row in manifest['observers']]}

def own_patch(revision, main):
    # The PR's own change at `revision`: its diff from the last `main` it merged, as a stable patch id.
    patch = plumbing('diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', '--no-renames',
                     git('merge-base', revision, main), revision)
    return subprocess.run(['git', 'patch-id', '--stable'], input=patch, text=True, stdout=subprocess.PIPE,
                          timeout=limit, check=True).stdout.split()[:1]

def covers(record, head, main):
    # L112: a publication covers `head` when it names it, or names an ancestor that `head` changed only by merging
    # `main`, so a refresh or update-branch keeps the captures of an unchanged PR.
    revision = sha(record['revision'])
    if revision == head:
        return True
    try:
        fetch(revision)
        if subprocess.run(['git', 'merge-base', '--is-ancestor', revision, head], timeout=limit).returncode:
            return False
        return own_patch(revision, main) == own_patch(head, main)
    except (subprocess.SubprocessError, ValueError):
        return False

def published(data, pr, required):
    head = pr['head']['sha']
    require(covers(data, head, pr['base']['sha']),
            f'capture revision {data["revision"]} is not the PR head {head}, and the head changes more than a merge of '
            '`main`; a fix run recaptures it')
    revision = data['revision']
    full_name = pr['head']['repo']['full_name']
    link = re.fullmatch(r'https://github.com/' + re.escape(full_name) + r'/actions/runs/([0-9]+)/artifacts/([0-9]+)', data['url'])
    require(link, 'capture link is not a repository artifact download')
    run_id, artifact_id = link.groups()
    artifact = one(f'{repo}/actions/artifacts/{artifact_id}')
    require(artifact['name'] == f'captures-{revision}' and artifact['workflow_run']['id'] == int(run_id),
            'capture artifact is not for this revision and run')
    require(artifact['expired'] is False, 'capture artifact expired; regenerate before review')
    duration = (datetime.fromisoformat(artifact['expires_at'].replace('Z', '+00:00')) -
                datetime.fromisoformat(artifact['created_at'].replace('Z', '+00:00'))).total_seconds()
    require(abs(duration - 14 * 86400) < 300, 'capture artifact does not have 14-day retention')
    with tempfile.TemporaryFile() as archive:
        subprocess.run(['gh', 'api', f'{repo}/actions/artifacts/{artifact_id}/zip'],
                       stdout=archive, stderr=subprocess.PIPE, timeout=limit, check=True)
        archive.seek(0)
        with zipfile.ZipFile(archive) as payload:
            require(payload.getinfo('capture-observers.json').file_size <= 1024 * 1024, 'capture manifest exceeds 1 MiB')
            manifest = json.loads(payload.read('capture-observers.json'))
            paths = parse_capture(manifest, revision, cited(pr.get('body')), required)
            require(capture_facts(manifest) == {key: data[key] for key in ('revision', 'observers')},
                    'capture archive observer facts disagree with the PR')
            files = [entry for entry in payload.infolist() if not entry.is_dir()]
            require(len(files) == len(paths) + 1 and {entry.filename for entry in files} == paths | {'capture-observers.json'},
                    'capture archive has missing or unlisted payloads')
            require(all(entry.file_size > 0 and (entry.external_attr >> 16) & 0o170000 != 0o120000 for entry in files),
                    'capture archive has an empty payload or symbolic link')
            require(payload.testzip() is None, 'capture archive has a corrupt payload')

def captures(base, head, body):
    changed = plumbing('diff', '--name-status', '-z', '--no-renames', base, head, '--', *EVIDENCE).split('\0')
    found = [path for status, path in zip(changed[0::2], changed[1::2]) if status != 'D']
    require(not found, '\n'.join(f'{path}: tracked evidence additions or edits are rejected (L112)' for path in found))
    required = capture_required(base, head, body)
    require(required <= cited(body), 'required capture scenario is not cited')
    record = capture_record(body)
    if pr.get('draft') and (required or record) and (not record or not covers(record, head, pr['base']['sha'])):
        # A draft cannot merge; `rules` checks its publication again when the PR is marked ready.
        print('captures: publication for this head is pending on a draft; rules checks it once the PR is ready')
        return
    require(record or not required, 'required capture publication is missing; leave the PR draft')
    if record:
        published(record, pr, required)

def write_pr(*args, fields=None):
    result = subprocess.run(['gh', *args], text=True, input=json.dumps(fields) if fields is not None else None,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=limit, check=True)
    return result.stdout

def draft(pr):
    if not pr.get('draft'):
        write_pr('pr', 'ready', number, '--undo')

def publication(base, head, pr):
    # The run uses main's script. PR worktrees and observer metadata are data, never executable authority.
    destination = Path(extra[0])
    if command == 'capture-publish':
        draft(pr)
        try:
            require(len(extra) == 2 and extra[1], 'capture upload failed: no download link')
            manifest = json.loads((destination / 'capture-observers.json').read_text())
            record = {**capture_facts(manifest), 'url': extra[1], 'retention_days': 14}
            published(record, pr, capture_required(base, head, pr.get('body')))
            current = one(pull)
            if current.get('state') == 'closed':
                print('PR closed during publication; its body stays unchanged.')
                return
            require(current['head']['sha'] == head, 'PR head moved during publication')
            observed = set().union(*(set(row['ids']) for row in record['observers']))
            require(observed <= cited(current.get('body')), 'capture citations changed during publication')
            require(capture_required(base, head, current.get('body')) <= observed, 'capture requirements changed during publication')
            body = re.sub(PUBLICATION + r'\n?', '', current.get('body') or '', flags=re.M).rstrip()
            body += '\n\nCapture publication: ' + json.dumps(record, separators=(',', ':')) + '\n'
            write_pr('api', '-X', 'PATCH', pull, '--input', '-', fields={'body': body})
            print(f'Published captures for {head}: {extra[1]} (14 days); review remains independent.')
        except (Refused, ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
            draft(pr)
            write_pr('pr', 'comment', number, '--body', f'Capture publication failed for {head}: {error}. PR remains draft; no observer passes from a missing upload.')
            raise
        return
    worktrees = plumbing('worktree', 'list', '--porcelain').split('\n\n')
    roots = [Path(re.search(r'^worktree (.+)$', row, re.M)[1]) for row in worktrees if f'HEAD {head}\n' in row + '\n']
    manifests = []
    for root in roots:
        path = Path(git('-C', str(root), 'rev-parse', '--path-format=absolute', '--git-path', 'capture-observers.json'))
        if path.is_file():
            manifests.append((root, path))
    required = capture_required(base, head, pr.get('body'))
    if not manifests and required:
        record = capture_record(pr.get('body'))
        if record and covers(record, head, pr['base']['sha']):
            print(f'Captures for {head} are already published; nothing to prepare.')
            return
        if not re.search(r'^Capture ready: ' + head + r'$', pr.get('body') or '', re.M):
            # A run that wrote no manifest and asked no publication left captures pending, not failed.
            draft(pr)
            print(f'Captures for {head} are pending; PR stays draft until a run marks it `Capture ready:`.')
            return
    if not required and not manifests:
        return
    draft(pr)
    require(len(manifests) == 1, 'required capture manifest missing or ambiguous; PR remains draft')
    root, source = manifests[0]
    require(source.stat().st_size <= 1024 * 1024, 'capture manifest exceeds 1 MiB')
    manifest = json.loads(source.read_text())
    paths = parse_capture(manifest, head, cited(pr.get('body')), required)
    require(not destination.exists(), 'capture upload directory already exists')
    destination.mkdir(parents=True)
    for path in sorted(paths):
        file = root / path
        require(file.is_file() and file.stat().st_size > 0 and not any(p.is_symlink() for p in (file, *file.parents)),
                f'{path}: missing, empty or linked capture payload')
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(file, target)
    (destination / 'capture-observers.json').write_text(json.dumps(manifest))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            output.write(f'path={destination}\nname=captures-{head}\n')
    print(f'Prepared captures for {head}; PR remains draft until upload and independent review.')

try:
    pr = one(pull)
    base_gate(pr)
    if command != 'base':
        head, base = sha(pr['head']['sha']), sha(pr['base']['sha'])
        fetch(head)
        fetch(base)
        if command == 'ci-trailers':
            trailer_gate(history(base, head), base)
        elif command == 'overturned':
            overturned(base, pr.get('body'))
        elif command in ('capture-prepare', 'capture-publish'):
            publication(git('merge-base', head, base), head, pr)
        elif command == 'captures':
            captures(git('merge-base', head, base), head, pr.get('body'))
        else:
            keeps_main(git('merge-base', head, base), head)
except (Refused, KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
    if command == 'capture-prepare' and 'pr' in globals():
        draft(pr)
        write_pr('pr', 'comment', number, '--body', f'Capture preparation failed: {error}. PR remains draft; publication is incomplete.')
    print(f'{command}: {error}', file=sys.stderr)
    sys.exit(1)
PY
}

# Composition at main's workflow boundary: the PR supplies payload data, never credentials or gate authority.
capture_run() {
  python3 - "$(cd "$(dirname "$0")" && pwd)" "$@" <<'PY'
import os
import re
import signal
import subprocess
import sys
from pathlib import Path

trusted, mode, target, directory, *extra = sys.argv[1:]
sys.path.insert(0, trusted)
import builder

if mode == 'prepare':
    rows = builder.orders.gh('pr', 'list', '--head', target, '--state', 'open', '--json', 'number')
    if not rows:
        sys.exit(0)
    pr = rows[0]['number']
else:
    pr = int(target)
current = builder.view(pr)
if builder.owner_closed(*builder.related(current)):
    sys.exit(0)
if mode == 'prepare' and os.environ.get('GITHUB_OUTPUT'):
    with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
        output.write(f'pr={pr}\n')
os.environ['GH_TOKEN'] = builder.app_token(builder.RUN_RIGHTS)
try:
    args = ['bash', str(Path(trusted) / 'rules.sh'), 'capture-' + mode, str(pr), directory, *extra]
    with subprocess.Popen(args, start_new_session=True) as publication:
        try:
            code = publication.wait(timeout=180)
        except subprocess.TimeoutExpired:
            # A stopped publisher releases its gh/git children as well as the App token.
            try:
                os.killpg(publication.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            publication.wait()
            raise
        if code:
            raise subprocess.CalledProcessError(code, args)
    if mode == 'publish':
        current = builder.view(pr)
        # Readiness is the Builder's completion request; it arms every existing independent gate.
        if re.search(r'^Capture ready: ' + current['headRefOid'] + r'$', current['body'], re.M) and not builder.STOPPED.search(current['body']):
            builder.ready(pr)
finally:
    builder.call('api', '-X', 'DELETE', '/installation/token')
PY
}

case "${1:-}" in
  base | ci-trailers | keeps-main | overturned | captures)
    [[ ${2:-} =~ ^[0-9]+$ ]] || { echo "usage: loop/rules.sh $1 <pr>" >&2; exit 2; }
    pr_rule "$1" "$2" ;;
  capture-run)
    { [ "${2:-}" = prepare ] || [ "${2:-}" = publish ]; } && [ -n "${3:-}" ] && [ -n "${4:-}" ] || { echo 'usage: loop/rules.sh capture-run prepare|publish <branch-or-pr> <directory> [artifact-url]' >&2; exit 2; }
    capture_run "${@:2}" ;;
  capture-prepare | capture-publish)
    [[ ${2:-} =~ ^[0-9]+$ ]] && [ -n "${3:-}" ] || { echo "usage: loop/rules.sh $1 <pr> <directory> [artifact-url]" >&2; exit 2; }
    pr_rule "$@" ;;
  vocab) vocab ;;
  scenario-ids) [ $# -eq 1 ] || { echo "usage: loop/rules.sh scenario-ids" >&2; exit 2; }
    scenario_ids ;;
  laws) [ $# -eq 1 ] || { echo "usage: loop/rules.sh laws" >&2; exit 2; }
    laws ;;
  architect-words) [ $# -eq 1 ] || { echo "usage: loop/rules.sh architect-words" >&2; exit 2; }
    architect_words ;;
  tokens) [ $# -eq 1 ] || { echo "usage: loop/rules.sh tokens" >&2; exit 2; }
    tokens ;;
  delta) delta "${2:-}" "${3:-}" ;;
  clean-merge) [ -n "${2:-}" ] || { echo "usage: loop/rules.sh clean-merge <commit> [main-ref]" >&2; exit 2; }
    clean_merge "$2" "${3:-origin/main}" ;;
  *) sed -n '2p' "$0" >&2; exit 2 ;;
esac
