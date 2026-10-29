#!/usr/bin/env bash
# Machine checks for AGENTS.md. Usage: loop/rules.sh vocab | tokens | laws | delta <base-dir> <head-dir> | architect-words | merge-loss [main-ref] | scenario-ids
# Scans: `vocab` reads public Rust items and fields, TS exports, and non-comment text under contracts/.
# It does not read imports, enum variants or UI strings.
set -euo pipefail
caller_dir=$PWD
cd "$(dirname "$0")/.."

# grep that treats "no match" as success but a real error as failure.
g() { grep "$@" || [ $? -eq 1 ]; }

# Avoid words from the `Code term | User label | Avoid` tables of GLOSSARY.md, lowercased; a two-word term joins with `_`.
# An Avoid cell ends at its first `.` or `;`; `—` marks a row with none.
avoid_phrases() {
  local phrases
  [ -f GLOSSARY.md ] || { echo "rule 6: GLOSSARY.md is missing" >&2; return 1; }
  phrases=$(awk -F'|' '
    /^\| *Code term *\| *User label *\| *Avoid *\|/ { in_table = 1; next }
    /^\|/ { if (in_table && $4 !~ /^[ -]*$/) print $4; next }
    { in_table = 0 }' GLOSSARY.md | sed 's/[.;].*//' | tr ',' '\n' |
    awk 'NF && $1 != "—" { print tolower(($2 != "" && $2 != "in") ? $1 "_" $2 : $1) }')
  [ -n "$phrases" ] || { echo "rule 6: no Avoid words found in the GLOSSARY.md tables" >&2; return 1; }
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
        heading = re.match(r'\*\*([A-Za-z]+[0-9]+[a-z]?)[ .]', line)
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
scenario_ids() {
  [ -d scenarios ] || { echo "scenario-ids: no scenarios/ here" >&2; return 2; }
  python3 - <<'PY'
import glob
import re
import sys

seen = {}
for path in sorted(glob.glob('scenarios/*.md')):
    with open(path, encoding='utf-8') as f:
        for n, line in enumerate(f, 1):
            m = re.match(r'\*\*([A-Za-z]+[0-9]+[a-z]?) ', line)
            if m:
                seen.setdefault(m.group(1), []).append(f'{path}:{n}')
bad = 0
for id_, at in seen.items():
    if len(at) > 1:
        print(f'{id_} {" ".join(at)}')
        bad = 1
sys.exit(bad)
PY
}

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

# L120: a file that differs from main but that no commit of the branch's own touched changed only through a merge, so a merge dropped
# the work there for certain. Never reads the PR body. It reads the repository it was run in, so a fix run can run main's copy on
# the branch it checked out (`builder.py restore-merge-loss`).
# It compares with the merge base, the newest main the branch holds, so a file main changed since is not a loss.
merge_loss() {
  local main_ref=$1 base own changed lost
  base=$(git -C "$caller_dir" merge-base "$main_ref" HEAD) || { echo "merge-loss: no merge base with $main_ref" >&2; return 1; }
  own=$(git -C "$caller_dir" -c core.quotePath=false log --no-merges --no-renames --name-only --format= "$base..HEAD") || { echo "merge-loss: could not list own commits against $main_ref" >&2; return 1; }
  changed=$(git -C "$caller_dir" -c core.quotePath=false diff --no-renames --name-only "$base" HEAD) || { echo "merge-loss: could not diff against $main_ref" >&2; return 1; }
  lost=$(comm -13 <(sort -u <<<"$own") <(sort -u <<<"$changed") | sed '/^$/d')
  [ -z "$lost" ] || { echo "merge-loss: these files differ from the merge base $base of $main_ref but no own commit touched them, so a merge lost the work there:" >&2; sed 's/^/  /' <<<"$lost" >&2; return 1; }
}

case "${1:-}" in
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
  merge-loss) merge_loss "${2:-origin/main}" ;;
  *) sed -n '2p' "$0" >&2; exit 2 ;;
esac
