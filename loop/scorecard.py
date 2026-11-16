#!/usr/bin/env python3
"""L124: the loop's scorecard. Each build, fix, review and critic run that ends in a result adds one row to the one scorecard
comment of its PR (`record`); `python3 loop/scorecard.py [--since YYYY-MM-DD]` reads every PR's comment and prints the numbers per
`.agents/builder.md` version. A change to a prompt or a model is kept only when its score holds. Exit 4: GitHub could not be read."""
import argparse
import datetime
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import orders  # noqa: E402

# The first line of a scorecard comment holds its rows as JSON; the table under it is a view of them.
MARK = '<!-- scorecard '
# `record` reads its write back and writes again, at most this many times: two runs of one PR can end together.
TRIES = 3
# A prompt version that ran on fewer PRs than this is too few to judge.
FEW = 5
# Each prompt version ran on different Issues, so its numbers alone cannot say whether the prompt change helped.
HINT = 'Versions ran on different Issues: read these as a hint, not a verdict.'
# The PRs `report` reads, newest first.
LIMIT = 1000
# The counts of a Claude Code `result` event's `usage` that make a run's tokens: input, cache writes, cache reads and output.
CLAUDE_TOKENS = ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')
NO_TOKENS = '-'


def version(path):
    """The first 7 digits of the git blob hash of the file at `path`: `git show <version>` prints the prompt a run used."""
    data = Path(path).read_bytes()
    return hashlib.sha1(b'blob %d\0' % len(data) + data, usedforsecurity=False).hexdigest()[:7]


def events(text):
    """The event dicts in the `text` of a run's events: claude-code-action's execution file is one JSON array, Claude Code's
    and Codex's `--json` output one event per line; a line that holds no event is skipped."""
    try:
        whole = json.loads(text)
        found = whole if isinstance(whole, list) else [whole]
    except ValueError:
        found = []
        for line in text.splitlines():
            try:
                found.append(json.loads(line))
            except ValueError:
                pass
    return [event for event in found if isinstance(event, dict)]


def turns(seen):
    """The `usage` of each Codex `turn.completed` event among the events `seen`."""
    return [event.get('usage') or {} for event in seen if event.get('type') == 'turn.completed']


def short(count):
    """`count` tokens as `812k`; `n/a` for a run with no count."""
    if count is None:
        return 'n/a'
    return f'{count / 1e6:.1f}M' if count >= 1e6 else f'{count / 1e3:.0f}k' if count >= 1e3 else str(count)


def measure(events_path, prompt_path, codex_model):
    """What a run's model job tells its `after` job, as `<prompt> <version> <model> <tokens>`: the prompt file's stem and
    `version`, the model, and the tokens of the events file `events_path`: Claude Code's `result` event, or the sum of
    Codex's `turn.completed` events, which name no model, so it is `codex_model`. `-` stands for a run that ended before
    it wrote its usage. The line holds no brace: GitHub drops a job output that matches a masked line of a secret."""
    seen = events(Path(events_path).read_text())
    results = [event for event in seen if event.get('type') == 'result']
    if results:
        tokens = sum((results[-1].get('usage') or {}).get(key, 0) for key in CLAUDE_TOKENS)
    elif turns(seen):
        # Codex counts the cached input inside `input_tokens`.
        tokens = sum(turn.get('input_tokens', 0) + turn.get('output_tokens', 0) for turn in turns(seen))
    else:
        tokens = None
    started = next((event['model'] for event in seen if event.get('type') == 'system' and event.get('subtype') == 'init'), codex_model)
    model = re.sub(r'[^\w.]+', '-', started.removeprefix('claude-'))
    return f"{Path(prompt_path).stem} {version(prompt_path)} {model} {NO_TOKENS if tokens is None else tokens}"


def leave(events_path, prompt_path, codex_model, output, warn):
    """Append `row=<measure>` to the step-output file `output`. A run that started no model left no events file and leaves no
    row. A file that cannot be read calls `warn` with why and leaves none: a scorecard never fails a run."""
    if not events_path or not Path(events_path).is_file():
        return
    try:
        line = measure(events_path, prompt_path, codex_model)
    except (OSError, ValueError, KeyError, TypeError) as error:
        warn(f'The scorecard took no measure of {events_path}: {error}')
        return
    with open(output, 'a') as out:
        out.write(f'row={line}\n')


def row(measured, run, result, url):
    """The row of a run of kind `run` (`build`, `fix`, `review` or `critic`) at `url` that ended in `result`, from the
    `measured` line its model job left."""
    prompt, found, model, tokens = measured.split()
    return dict(run=run, url=url, prompt=prompt, version=found, model=model, tokens=None if tokens == NO_TOKENS else int(tokens),
                result=result)


def render(rows):
    """The text of a scorecard comment: `rows` as JSON on its first line, then a table of them."""
    lines = [f"{MARK}{json.dumps(rows, separators=(',', ':'))} -->", '**Scorecard**', '',
             '| run | prompt | model | tokens | result |', '| --- | --- | --- | --- | --- |']
    fixes = 0
    for each in rows:
        fixes += each['run'] == 'fix'
        name = f'fix {fixes}' if each['run'] == 'fix' else each['run']
        lines.append(f"| [{name}]({each['url']}) | {each['prompt']}.md {each['version']} | {each['model']} | "
                     f"{short(each['tokens'])} | {each['result']} |")
    return '\n'.join(lines)


def parse(body):
    """The rows in the first line of a scorecard comment's `body`; none in any other text."""
    found = re.match(re.escape(MARK) + r'(.*) -->', body)
    return json.loads(found[1]) if found else []


def merged(comments, extra=()):
    """The rows of the scorecard `comments`, oldest first, then `extra`, one row to a run: a row for a run already there
    replaces it in place."""
    rows = {}
    for each in [*(each for comment in comments for each in parse(comment['body'])), *extra]:
        rows[each['url']] = each
    return list(rows.values())


def record(pr, new):
    """Add the row `new` to PR `pr`'s scorecard comment, creating the comment when the PR has none. Runs of one PR end
    together (review and critic) and each rewrites the whole comment, so a write is read back and made again until the PR
    holds one comment with the row; a second comment a race created is merged into the first and deleted. Raises when
    `TRIES` writes never leave the row there."""
    for _ in range(TRIES):
        found = orders.marked(pr, MARK)
        body = render(merged(found, [new]))
        if found:
            orders.call('api', '-X', 'PATCH', f"repos/{{owner}}/{{repo}}/issues/comments/{found[0]['id']}", '-f', f'body={body}')
            for extra in found[1:]:
                orders.call('api', '-X', 'DELETE', f"repos/{{owner}}/{{repo}}/issues/comments/{extra['id']}")
        else:
            orders.call('api', f'repos/{{owner}}/{{repo}}/issues/{pr}/comments', '-f', f'body={body}')
        left = orders.marked(pr, MARK)
        if len(left) == 1 and new['url'] in {each['url'] for each in parse(left[0]['body'])}:
            return
    raise RuntimeError(f"PR #{pr}'s scorecard holds no row of {new['url']} after {TRIES} writes")


def add(pr, measured, run, result, url, warn):
    """Add a run's row to PR `pr`'s scorecard: `run` is its kind, `result` how it ended, `url` its link and `measured` the
    line its model job left (`measure`). A run that left none adds no row. A write that fails calls `warn` with why and
    returns: a scorecard never fails a run."""
    if not measured:
        return
    try:
        record(pr, row(measured, run, result, url))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.SubprocessError) as error:
        warn(f'The scorecard of PR #{pr} took no row of {url}: {error}')


def scored(since):
    """(number, state, rows) of each PR created on or after the date `since` ('' for any) that holds a scorecard its own bot
    wrote, newest first; a comment of anyone else is left out."""
    search = ['--search', f'created:>={since}'] if since else []
    listed = json.loads(orders.call('pr', 'list', '--state', 'all', '--limit', str(LIMIT), '--json', 'number,state,comments',
                                    *search, timeout=600))
    bot = orders.BOT.removesuffix('[bot]')
    found = [(pr['number'], pr['state'], merged([comment for comment in pr['comments']
                                                 if (comment['author'] or {}).get('login') == bot and comment['body'].startswith(MARK)]))
             for pr in listed]
    return [each for each in found if each[2]]


def tally(prs):
    """The numbers of `prs`, each a (state, rows): how many, the share merged of those merged or closed (None when all are
    open), and per PR the mean fix runs, rejects and tokens; `blind` counts runs with no token count, which add nothing."""
    settled = [state for state, _ in prs if state != 'OPEN']

    def mean(counts):
        return sum(counts) / len(prs)
    return dict(prs=len(prs), merged=settled.count('MERGED') / len(settled) if settled else None,
                fixes=mean(sum(each['run'] == 'fix' for each in rows) for _, rows in prs),
                rejects=mean(sum(each['result'] == 'reject' for each in rows) for _, rows in prs),
                tokens=mean(sum(each['tokens'] or 0 for each in rows) for _, rows in prs),
                blind=sum(each['tokens'] is None for _, rows in prs for each in rows))


def numbers(found):
    """{version: tally} for the PRs `found`, each counted under the `.agents/builder.md` version of its first run that used that
    prompt, versions oldest first; a PR with no such run is left out."""
    groups = {}
    for _, state, rows in sorted(found):
        ours = [each for each in rows if each['prompt'] == 'builder']
        if ours:
            groups.setdefault(ours[0]['version'], []).append((state, rows))
    return {found_version: tally(prs) for found_version, prs in groups.items()}


def report(found):
    """The lines that print `numbers(found)`: a table with a row per version, the `HINT` once, a warning for each version that
    ran on fewer than `FEW` PRs, and a note for each with runs that left no token count."""
    stats = numbers(found)
    lines = [f"{'builder.md':<10}  {'PRs':>4}  {'merged':>6}  {'fix runs':>8}  {'rejects':>7}  {'tokens':>7}"]
    for each, stat in stats.items():
        share = 'n/a' if stat['merged'] is None else f"{stat['merged']:.0%}"
        lines.append(f"{each:<10}  {stat['prs']:>4}  {share:>6}  {stat['fixes']:>8.1f}  {stat['rejects']:>7.1f}  {short(round(stat['tokens'])):>7}")
    lines.append(HINT)
    for each, stat in stats.items():
        if stat['prs'] < FEW:
            lines.append(f"warning: builder.md {each} ran on {stat['prs']} PRs, fewer than {FEW}: too few to judge")
        if stat['blind']:
            lines.append(f"note: builder.md {each} has {stat['blind']} runs with no token count, left out of its tokens")
    return lines


def main(args):
    parser = argparse.ArgumentParser(description="Print the loop's numbers per builder.md version, from the scorecard comments on PRs.")
    parser.add_argument('--since', type=datetime.date.fromisoformat, help='count only PRs created on or after this date, YYYY-MM-DD')
    since = parser.parse_args(args).since
    found = scored(since.isoformat() if since else '')
    print('\n'.join(report(found)) if found else 'no scorecard comment found')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        print(f'scorecard: {error}', file=sys.stderr)
        sys.exit(4)
