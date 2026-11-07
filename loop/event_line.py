"""L23: the words a run's public step log shows for the content of one event: each part's kind, and after a `Bash` call
a label of its command, so GitHub's line timestamps time the call without a secret reaching the log."""
import itertools
import re

LABEL_WORDS = 3
LABEL_WORD = re.compile(r'[a-z][a-z-]{0,23}')


def label(part):
    """The leading words of a `Bash` call's command that are plain names, at most `LABEL_WORDS`: a `cd <dir> &&` and
    any `NAME=value` words come first and are never shown; the label stops at the first word of anything but lowercase
    letters and hyphens, so no path, flag, token or argument reaches the log. Empty for any other part."""
    command = part.get('input', {}).get('command') if part.get('name') == 'Bash' and isinstance(part.get('input'), dict) else None
    words = command.split() if isinstance(command, str) else []
    if words[:1] == ['cd'] and words[2:3] == ['&&']:
        words = words[3:]
    while words and re.fullmatch(r'\w+=.*', words[0]):
        words = words[1:]
    return ' '.join(itertools.islice(itertools.takewhile(LABEL_WORD.fullmatch, words), LABEL_WORDS))


def parts(content):
    """The log words for an event's `content`: each part's type, then the label of a `Bash` call; none when `content` is
    no list; a part that is no dict is skipped."""
    for part in (p for p in content if isinstance(p, dict)) if isinstance(content, list) else []:
        yield part.get('type', '')
        if text := label(part):
            yield text
