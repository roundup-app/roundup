"""L23: the words a run's public step log shows for the content of one event: each part's kind, and after a `Bash` call
a label of its command, so GitHub's line timestamps time the call without a secret reaching the log."""

LABEL_WORDS = 4
LABEL_CHARACTERS = 80
WORD_CHARACTERS = 40
UNSAFE = set('=$"\'')


def label(part):
    """The first `LABEL_WORDS` whitespace-separated words of a `Bash` call's command, minus any holding `=`, `$` or a
    quote or longer than `WORD_CHARACTERS`, cut to `LABEL_CHARACTERS`; empty for any other part."""
    command = part.get('input', {}).get('command') if part.get('name') == 'Bash' and isinstance(part.get('input'), dict) else None
    words = command.split()[:LABEL_WORDS] if isinstance(command, str) else []
    return ' '.join(w for w in words if len(w) <= WORD_CHARACTERS and not UNSAFE.intersection(w))[:LABEL_CHARACTERS]


def parts(content):
    """The log words for an event's `content`: each part's type, then the label of a `Bash` call; none when `content` is
    no list."""
    for part in content if isinstance(content, list) else []:
        yield part.get('type', '')
        if text := label(part):
            yield text
