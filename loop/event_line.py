"""L23: the words a run's public step log shows for the content of one event: each part's kind, and after a `tool_use` a
label of the call, so GitHub's line timestamps time the call without a secret reaching the log."""
import itertools
import re
import shlex

# A `Bash` label shows at most `LABEL_WORDS` words of each of at most `LABEL_SEGMENTS` segments, read from the first `LABEL_CHARS`
# characters of the command: `shlex` takes time quadratic in the length of one word.
LABEL_WORDS = 3
LABEL_SEGMENTS = 4
LABEL_CHARS = 20000
LABEL_WORD = re.compile(r'[a-z][a-z-]{0,23}')
# The names Anthropic's API allows a tool: every real tool, MCP tools included, and no sentence a model made up.
TOOL_NAME = re.compile(r'[A-Za-z0-9_-]{1,64}')
# The tokens that end a segment of a command and join it to the next.
OPERATORS = frozenset(['&&', '||', ';', '|'])
# What stops the reading of a command: a token that opens a here-document, whose text is no command, and one that holds a command
# substitution (`$(` or a backtick), whose own quotes `shlex` pairs with the quotes around it.
STOP = re.compile(r'<<|\$\(|`')
ASSIGNMENT = re.compile(r'\w+=.*')
DURATION = re.compile(r'(\d+\.?\d*|\.\d+)[smhd]?')
# The flags of `timeout` whose value is the next word.
TIMEOUT_VALUE_FLAGS = ('-k', '-s', '--kill-after', '--signal')
BASH = 'Bash'


def tokens(command):
    """The words and operators of `command` as a POSIX shell splits them (`shlex`): a quoted string or an escaped character
    is part of one word, so no operator inside it splits the command, and a comment is dropped. Newlines are white space. It
    stops at the first token that matches `STOP`, and reads no further than it needs. Raises `ValueError` for an unclosed
    quote or a trailing backslash."""
    lexer = shlex.shlex(command[:LABEL_CHARS], posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    return itertools.takewhile(lambda token: not STOP.search(token), lexer)


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


def segments(command):
    """`(operator, label)` for each segment of `command` (its `tokens` between `OPERATORS`): the operator that joins it to
    the segment before, and the first words of its command, at most `LABEL_WORDS`, that are lowercase letters and hyphens
    only. A segment with no such word is left out with its operator."""
    operator = ''
    for is_operator, group in itertools.groupby(tokens(command), OPERATORS.__contains__):
        if is_operator:
            *_, operator = group
        elif words := ' '.join(itertools.islice(itertools.takewhile(LABEL_WORD.fullmatch, bare(list(group))), LABEL_WORDS)):
            yield operator, words


def bash_label(command):
    """The label of a `Bash` call's `command`: the first `LABEL_SEGMENTS` of its `segments`, each after its operator, the
    first with none; empty when a shell could not split it (`ValueError` of `tokens`). A `cd <dir>`, `NAME=value` words and
    `timeout` with its flags and duration are never shown, and a label word is lowercase letters and hyphens only, so no
    path, flag, digit, token or argument reaches the log."""
    try:
        shown = list(itertools.islice(segments(command), LABEL_SEGMENTS))
    except ValueError:
        return ''
    return ' '.join(f'{operator} {words}' if index else words for index, (operator, words) in enumerate(shown))


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
