"""L23: the words a run's public step log shows for the content of one event: each part's kind, and after a `tool_use` a
label of the call, so GitHub's line timestamps time the call without a secret reaching the log."""
import itertools
import re

# A `Bash` label shows at most `LABEL_WORDS` words of each of at most `LABEL_SEGMENTS` segments.
LABEL_WORDS = 3
LABEL_SEGMENTS = 4
LABEL_WORD = re.compile(r'[a-z][a-z-]{0,23}')
# The names Anthropic's API allows a tool: every real tool, MCP tools included, and no sentence a model made up.
TOOL_NAME = re.compile(r'[A-Za-z0-9_-]{1,64}')
# A closed quoted string or a backslash pair, which a shell reads as part of one word and so hides every operator in it. A
# single-quoted string holds no escape. A double-quoted one is read through its backslash pairs and holds no `$(`, `${` or
# backtick, which open a command that a quote inside it would pair wrongly. A quote after `$` opens a `$'...'` or `$"..."`
# string, read otherwise.
QUOTED = re.compile(r'''(?:(?<!\$)(?:'[^']*'|"(?:[^"\\`$]|\\.|\$(?![({]))*")|\\.)''', re.DOTALL)
# What stands for it in a word, which is then no plain name.
MASK = '~'
# What a split on spaces reads differently from a shell, once those are masked: a quote left over (a string that is not closed
# or not simple), a backtick, a `#` that starts a comment and a `<<` that starts text no command reads.
UNREADABLE = re.compile(r'''['"`#]|<<''')
OPERATORS = re.compile(r'(&&|\|\||[;|\n])')
ASSIGNMENT = re.compile(r'\w+=.*')
DURATION = re.compile(r'(\d+\.?\d*|\.\d+)[smhd]?')
# The flags of `timeout` whose value is the next word.
TIMEOUT_VALUE_FLAGS = ('-k', '-s', '--kill-after', '--signal')
BASH = 'Bash'


def without_timeout(words):
    """`words` after a leading `timeout`, its flags and its duration; `words` itself when no duration follows them."""
    rest = words[1:]
    while rest and rest[0].startswith('-'):
        rest = rest[2:] if rest[0] in TIMEOUT_VALUE_FLAGS else rest[1:]
    return rest[1:] if rest and DURATION.fullmatch(rest[0]) else words


def bare(words):
    """The words of one segment that name its command: no leading `NAME=value` word, no `timeout` with its flags and
    duration; none for a `cd`, which names only where the next segment runs."""
    while words:
        rest = words[1:] if ASSIGNMENT.fullmatch(words[0]) else without_timeout(words) if words[0] == 'timeout' else words
        if rest is words:
            break
        words = rest
    return [] if words[:1] == ['cd'] else words


def readable(command):
    """`command` with each closed `QUOTED` string masked, up to the first word that still holds a quote, backtick, `#` or
    `<<`; all of it when no word does. What a quote hides is never split, so no operator inside one makes a false
    segment, and a quote read wrongly leaves a character of `UNREADABLE` before it."""
    masked = QUOTED.sub(MASK, command)
    found = UNREADABLE.search(masked)
    return re.match(r'.*\s|', masked[:found.start()], re.DOTALL)[0] if found else masked


def segments(command):
    """`(operator, label)` for each segment of the `readable` start of `command`, split at `&&`, `||`, `;`, `|` and a
    newline (shown as `;`): the operator that joins it to the segment before, and the first words of its command, at
    most `LABEL_WORDS`, that are lowercase letters and hyphens only. A segment with no such word is left out with its
    operator."""
    pieces = OPERATORS.split(readable(command))
    for operator, text in zip(['', *pieces[1::2]], pieces[::2]):
        words = itertools.islice(itertools.takewhile(LABEL_WORD.fullmatch, bare(text.split())), LABEL_WORDS)
        if label := ' '.join(words):
            yield operator.replace('\n', ';'), label


def bash_label(command):
    """The label of a `Bash` call's `command`: the first `LABEL_SEGMENTS` of its `segments`, each after its operator, the
    first with none. A `cd <dir>`, `NAME=value` words and `timeout` with its flags and duration are never shown, and a
    label word is lowercase letters and hyphens only, so no path, flag, quote, digit, token or argument reaches the log."""
    shown = itertools.islice(segments(command), LABEL_SEGMENTS)
    return ' '.join(f'{operator} {label}' if index else label for index, (operator, label) in enumerate(shown))


def label(part):
    """What the log names of a `tool_use` `part`: the `bash_label` of a `Bash` call's command, else the tool's name, which
    holds no secret: so every tool, a `Bash` call with no plain word included. Empty for any other part, and for a name no
    tool has."""
    name = part.get('name') if part.get('type') == 'tool_use' else None
    if not isinstance(name, str) or not TOOL_NAME.fullmatch(name):
        return ''
    arguments = part.get('input')
    command = arguments.get('command') if name == BASH and isinstance(arguments, dict) else None
    return (bash_label(command) if isinstance(command, str) else '') or name


def parts(content):
    """The log words for an event's `content`: each part's type, then its `label`; none when `content` is no list; a part
    that is no dict is skipped."""
    for part in (p for p in content if isinstance(p, dict)) if isinstance(content, list) else []:
        yield part.get('type', '')
        if text := label(part):
            yield text
