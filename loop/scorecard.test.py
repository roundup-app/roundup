#!/usr/bin/env python3
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder', ROOT / 'loop/builder.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
scorecard, orders = builder.scorecard, builder.orders
HEAD = 'a' * 40

RUN = 'https://github.com/o/r/actions/runs/'


def row(run, result, version='aaaaaaa', tokens=1000, prompt='builder'):
    return dict(run=run, url=f'{RUN}{run}-{result}-{version}', prompt=prompt, version=version, model='sonnet-5-5', tokens=tokens,
                result=result)


class Comments:
    """One PR's comments as GitHub holds them: the calls record makes land here. `stale` reads give it the empty list that
    was true before a run that ended a moment earlier wrote its comment."""

    def __init__(self, stale=0):
        self.items, self.stale, self.next_id = [], stale, 1

    def marked(self, pr, marker):
        if self.stale:
            self.stale -= 1
            return []
        return [dict(item) for item in self.items if item['body'].startswith(marker)]

    def call(self, *args, **_):
        body = next((arg.removeprefix('body=') for arg in args if arg.startswith('body=')), None)
        path = next(arg for arg in args if arg.startswith('repos/'))
        if 'DELETE' in args:
            self.items = [item for item in self.items if not path.endswith(f"/comments/{item['id']}")]
        elif 'PATCH' in args:
            next(item for item in self.items if path.endswith(f"/comments/{item['id']}"))['body'] = body
        else:
            self.items.append(dict(id=self.next_id, body=body))
            self.next_id += 1
        return ''

    def rows(self):
        return [scorecard.parse(item['body']) for item in self.items]


class Scorecard(unittest.TestCase):
    def record(self, comments, *new):
        with patch.object(orders, 'marked', comments.marked), patch.object(orders, 'call', comments.call):
            for each in new:
                scorecard.record(7, each)

    def test_l124_measure_names_the_version_model_and_tokens_of_a_claude_or_codex_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            prompt = Path(tmp, 'builder.md')
            prompt.write_text('Build it.\n')
            claude = Path(tmp, 'claude.json')
            claude.write_text(json.dumps([
                dict(type='system', subtype='init', model='claude-sonnet-5-5'),
                dict(type='result', usage=dict(input_tokens=10, cache_creation_input_tokens=20, cache_read_input_tokens=300,
                                               output_tokens=4))]))
            codex = Path(tmp, 'codex.jsonl')
            codex.write_text('\n'.join(json.dumps(each) for each in [
                dict(type='turn.started'), dict(type='turn.completed', usage=dict(input_tokens=100, cached_input_tokens=60, output_tokens=5)),
                dict(type='turn.completed', usage=dict(input_tokens=200, cached_input_tokens=0, output_tokens=7))]) + '\nnot json\n')
            failed = Path(tmp, 'failed.jsonl')
            failed.write_text(json.dumps(dict(type='turn.failed')) + '\n')
            version = scorecard.version(prompt)
            claude, codex, failed = (str(each) for each in (claude, codex, failed))
            self.assertEqual(scorecard.measure(claude, prompt, 'gpt-x'), f'builder {version} sonnet-5-5 334')
            self.assertEqual(scorecard.measure(codex, prompt, 'gpt-x'), f'builder {version} gpt-x 312')
            self.assertEqual(scorecard.measure(failed, prompt, 'gpt-x'), f'builder {version} gpt-x -')
            self.assertNotRegex(scorecard.measure(claude, prompt, 'gpt-x'), '[{}]')
            prompt.write_text('Build it twice.\n')
            self.assertNotEqual(scorecard.version(prompt), version)

    def test_l124_each_run_adds_its_row_to_the_one_comment_in_place(self):
        comments = Comments()
        build, review = row('build', 'PR open'), row('review', 'reject')
        self.record(comments, build, review, row('fix', 'review'), row('review', 'approve'))
        self.assertEqual(len(comments.items), 1)
        self.assertEqual([each['run'] for each in comments.rows()[0]], ['build', 'review', 'fix', 'review'])
        self.record(comments, review)  # a rerun of a run already there replaces its row
        self.assertEqual(len(comments.rows()[0]), 4)
        self.assertIn('| [fix 1](', comments.items[0]['body'])

    def test_l124_review_and_critic_ending_together_leave_one_comment_with_both_rows(self):
        comments = Comments(stale=1)
        comments.items.append(dict(id=0, body=scorecard.render([row('critic', 'approve')])))
        comments.next_id = 1
        # The review run read no comment, the critic run's had not been written: it makes a second one.
        self.record(comments, row('review', 'approve'))
        self.assertEqual(len(comments.items), 1)
        self.assertEqual({each['run'] for each in comments.rows()[0]}, {'critic', 'review'})

    def test_l124_the_builder_steps_add_a_row_for_each_kind_of_run(self):
        comments, measured = Comments(), 'builder aaaaaaa sonnet-5-5 10'
        open_pr = dict(number=7, state='OPEN', headRefOid=HEAD, headRefName='build/U1', isDraft=False, isCrossRepository=False,
                       body='')
        with patch.object(orders, 'marked', comments.marked), patch.object(orders, 'call', comments.call), \
                patch.object(orders, 'gh', return_value=[dict(open_pr, isDraft=True)]), patch.object(builder, 'view', return_value=open_pr), \
                patch.object(builder, 'link', side_effect=lambda each, *_: each), patch.object(builder, 'ended'), \
                patch.object(builder, 'parked', return_value=''), patch.object(builder, 'call'), patch.object(builder, 'dispatch_fix'):
            builder.built(1, 'U1', True, '', RUN + 'b', None, measured)
            builder.fixed(7, 'check', True, RUN + 'f', None, True, measured)
            builder.review_post(7, HEAD, 'reviewer-1', json.dumps(dict(verdict='reject', findings='Cut it.')), True, RUN + 'r', measured)
            builder.critic_post(7, HEAD, 'critic-1', json.dumps(dict(verdict='approve', findings='Fine.')), True, RUN + 'c', measured)
        self.assertEqual([(each['run'], each['result']) for each in comments.rows()[0]],
                         [('build', 'draft'), ('fix', 'check: ready'), ('review', 'reject'), ('critic', 'approve')])

    def test_l124_a_failed_scorecard_write_warns_and_never_fails_the_run(self):
        warned = []
        with patch.object(scorecard, 'record', side_effect=RuntimeError('three writes lost')):
            scorecard.add(7, 'builder aaaaaaa sonnet-5-5 9', 'review', 'approve', RUN + '1', warned.append)
        self.assertEqual(len(warned), 1)
        self.assertIn('three writes lost', warned[0])
        with patch.object(scorecard, 'record') as record:
            scorecard.add(7, '', 'review', 'approve', RUN + '1', warned.append)  # no model ran: no row
        record.assert_not_called()

    def test_l124_report_counts_per_builder_version_and_says_what_it_cannot_judge(self):
        old = [(n, 'MERGED' if n % 2 else 'CLOSED', [row('build', 'PR open', 'aaaaaaa', 100), row('fix', 'review', 'aaaaaaa', 100),
                                                    row('review', 'reject', 'aaaaaaa', 100)]) for n in range(1, 7)]
        new = [(10, 'MERGED', [row('build', 'PR open', 'bbbbbbb', None), row('review', 'approve', 'bbbbbbb', 50)]),
               (11, 'OPEN', [row('build', 'PR open', 'bbbbbbb', 50)])]
        lines = scorecard.report(old + new)
        table = {line.split()[0]: line.split() for line in lines[1:3]}
        self.assertEqual(table['aaaaaaa'], ['aaaaaaa', '6', '50%', '1.0', '1.0', '300'])
        self.assertEqual(table['bbbbbbb'][1:4], ['2', '100%', '0.0'])
        self.assertEqual(lines.count(scorecard.HINT), 1)
        self.assertEqual([line for line in lines if line.startswith('warning')],
                         ['warning: builder.md bbbbbbb ran on 2 PRs, fewer than 5: too few to judge'])
        self.assertEqual(len([line for line in lines if line.startswith('note')]), 1)


if __name__ == '__main__':
    unittest.main()
