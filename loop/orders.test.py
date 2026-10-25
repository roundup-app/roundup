#!/usr/bin/env python3
import importlib.util
import json
import unittest
import subprocess
import io
import os
import re
import tempfile
import time
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('orders', 'loop/orders.py')
orders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orders)


def issue(number=1, key='U83', **changes):
    return dict(dict(number=number, title='Explain missing prior output', html_url=f'https://github.com/a/b/issues/{number}',
                     state='open', labels=[], user=dict(login='saadshahd'), updated_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     body=f'Scenarios: U83\nSpecification: [scenarios/ui.md](https://github.com/a/b/blob/main/scenarios/ui.md)\nKey: {key}\nPriority: 2\n'), **changes)


NO_SPEC = issue()['body'].replace('Specification: [scenarios/ui.md](https://github.com/a/b/blob/main/scenarios/ui.md)\n', '')


class Call(unittest.TestCase):
    def test_l23_gh_retries_a_github_5xx_and_never_a_4xx(self):
        def gh(*replies):
            return Mock(side_effect=[subprocess.CompletedProcess([], code, out, err) for code, out, err in replies])

        with patch.object(orders.time, 'sleep'), redirect_stderr(io.StringIO()):
            with patch.object(orders.subprocess, 'run', gh((1, '', 'gh: Server Error (HTTP 502)'), (0, 'ok', ''))) as run:
                self.assertEqual(orders.call('api', 'x'), 'ok')
                self.assertEqual(run.call_count, 2)
            with patch.object(orders.subprocess, 'run', gh((1, '', 'gh: Not Found (HTTP 404)'), (0, 'ok', ''))) as run:
                with self.assertRaises(subprocess.CalledProcessError):
                    orders.call('api', 'x')
                self.assertEqual(run.call_count, 1)

    def test_l23_gh_waits_out_one_rate_limit_then_fails_loud(self):
        limited = (1, '', 'gh: API rate limit exceeded for installation ID 1. (HTTP 403)')

        def quota(remaining, reset):
            return 0, json.dumps(dict(resources=dict(core=dict(remaining=remaining, reset=reset)))), ''

        def gh(*replies):
            return Mock(side_effect=[subprocess.CompletedProcess([], code, out, err) for code, out, err in replies])

        with patch.object(orders.time, 'sleep') as sleep, redirect_stderr(io.StringIO()):
            with patch.object(orders.subprocess, 'run', gh(limited, quota(0, time.time() + 90), (0, 'ok', ''))) as run:
                self.assertEqual(orders.call('api', 'x'), 'ok')
                self.assertEqual(run.call_args_list[1].args[0], ['gh', 'api', 'rate_limit'])
            self.assertTrue(80 <= sleep.call_args.args[0] <= 91)
            with patch.object(orders.subprocess, 'run', gh(limited, quota(0, time.time() + 3600), (0, 'ok', ''))):
                orders.call('api', 'x')
            self.assertEqual(sleep.call_args.args[0], 300)
            with patch.object(orders.subprocess, 'run', gh(limited, quota(0, time.time() + 1), limited)) as run:
                with self.assertRaises(subprocess.CalledProcessError):
                    orders.call('api', 'x')
                self.assertEqual(run.call_count, 3)
            secondary = (1, '', 'gh: You have exceeded a secondary rate limit. (HTTP 403)\nRetry-After: 42')
            with patch.object(orders.subprocess, 'run', gh(secondary, (0, 'ok', ''))) as run:
                orders.call('api', 'x')
                self.assertEqual(run.call_count, 2)
            self.assertEqual(sleep.call_args.args[0], 42)


class Orders(unittest.TestCase):
    def check(self, body):
        return subprocess.run(['python3', 'loop/orders.py', 'check', '-'], input=body, text=True, capture_output=True)

    def test_l34_an_empty_rest_issue_list_reads_issues_through_graphql(self):
        item = dict(number=7, url='https://github.com/a/b/issues/7', title='Explain missing prior output',
                    body=issue()['body'], state='OPEN', stateReason=None, labels=[], updatedAt=issue()['updated_at'],
                    author=dict(login='app/claude', is_bot=True))
        with patch.object(orders, 'gh', side_effect=[[[]], [item]]), redirect_stderr(io.StringIO()):
            issues = orders.list_issues()
        rows = orders.classify(issues, {}, [])
        self.assertEqual([(row['issue'], row['state']) for row in rows], [(7, 'ready')])

    def test_l34_a_cached_closed_issue_still_blocks_a_duplicate_key_and_a_reopened_one_leaves_the_cache(self):
        closed = issue(1, 'U83', state='closed', state_reason='completed')
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {orders.CLOSED_CACHE: f'{directory}/closed.json'}):
            with patch.object(orders, 'gh', side_effect=[[[issue(2, 'U83'), closed]]]):  # no file yet: every page
                orders.list_issues()
            with patch.object(orders, 'gh', side_effect=[[[issue(2, 'U83')]], [[]]]) as gh:  # warm: open, then closed since
                issues = orders.list_issues()
            self.assertEqual(gh.call_count, 2)
            rows = orders.classify(issues, {}, [])
            self.assertEqual([(row['issue'], row['state']) for row in rows], [(1, 'done'), (2, 'blocked')])
            self.assertIn('duplicate work Key', rows[1]['reason'])
            with patch.object(orders, 'gh', side_effect=[[[issue(1, 'U83'), issue(3, 'U84')]], [[]]]):  # #1 reopened
                issues = orders.list_issues()
            self.assertEqual(sorted(i['number'] for i in issues), [1, 3])

    def test_l96_check_refuses_a_key_without_a_specification(self):
        result = self.check(NO_SPEC)
        self.assertEqual(result.returncode, 2)
        self.assertIn('work orders: invalid work order: needs one Specification: line', result.stderr)

    def test_l96_check_accepts_a_valid_body(self):
        self.assertEqual(self.check(issue()['body']).returncode, 0)
        self.assertEqual(self.check('A bug report with no fields').returncode, 0)

    def test_l96_task_for_an_invalid_order_is_a_repair(self):
        output = io.StringIO()
        with patch.object(orders, 'gh', return_value=issue(body=NO_SPEC)), redirect_stdout(output):
            orders.task(1)
        self.assertIn('needs one Specification: line', output.getvalue())
        self.assertIn('Open no PR; edit Issue #1', output.getvalue())

    def test_l96_a_repaired_order_is_classified_by_l34(self):
        self.assertEqual(orders.classify([issue(body=NO_SPEC)], {}, [])[0]['state'], 'blocked')
        self.assertEqual(orders.classify([issue()], {}, [])[0]['state'], 'ready')

    def test_l96_ready_counts_the_invalid_orders(self):
        rows = orders.classify([issue(body=NO_SPEC), issue(2, key='U84')], {}, [])
        self.assertEqual(orders.count_invalid(rows), 'invalid orders: 1')

    def test_l96_a_closed_malformed_issue_is_not_an_invalid_order(self):
        rows = orders.classify([issue(body=NO_SPEC, state='closed', state_reason='completed')], {}, [])
        self.assertEqual(orders.invalid(rows), [])
        self.assertEqual(orders.count_invalid(rows), 'invalid orders: 0')

    def test_l34_only_known_modes_are_executable(self):
        row=orders.classify([issue(body=issue()['body']+'Mode: skip-review\n')],{},[])[0]
        self.assertEqual(row['state'],'blocked')
        self.assertEqual(orders.order(issue(body=issue()['body']+'Mode: specify\n'))['mode'],'specify')

    def test_l34_task_renders_the_authorized_issue_and_mode(self):
        output = io.StringIO()
        with patch.object(orders, 'gh', return_value=issue()), \
             patch.object(orders, 'read_orders', return_value=orders.classify([issue()], {}, [])), \
             redirect_stdout(output):
            orders.task(1)
        self.assertIn('Mode: implement', output.getvalue())
        self.assertIn('Refs #1', output.getvalue())

    def test_l34_task_rechecks_new_pr_ownership_before_starting(self):
        with patch.object(orders, 'gh', return_value=issue()), \
             patch.object(orders, 'read_orders', return_value=[dict(issue=1,state='in-flight')]):
            with self.assertRaisesRegex(orders.NotReady, 'no longer ready'):
                orders.task(1)

    def test_l34_an_issue_that_is_no_longer_ready_exits_3_and_starts_no_run(self):
        with patch.object(orders, 'task', side_effect=orders.NotReady('taken')), \
             patch.object(orders.sys, 'argv', ['orders.py', 'task', '1']):
            with self.assertRaises(SystemExit) as stop:
                orders.main()
        self.assertEqual(stop.exception.code, 3)

    def test_l34_specification_delivery_can_release_implementation(self):
        specification = issue(body=issue()['body']+'Mode: specify\n')
        output = io.StringIO()
        with patch.object(orders, 'gh', return_value=specification), \
             patch.object(orders, 'read_orders', return_value=orders.classify([specification], {}, [])), \
             redirect_stdout(output):
            orders.task(1)
        self.assertIn('Close this specification Issue', output.getvalue())
        self.assertNotIn('specification-only PR does not close', output.getvalue())

    def test_l34_ready_issue_does_not_consult_test_names_or_work_tables(self):
        self.assertEqual(orders.classify([issue()], {}, [])[0]['state'], 'ready')

    def test_l34_every_open_issue_the_user_or_a_loop_app_filed_is_work(self):
        for login in ('saadshahd', 'claude[bot]', 'github-actions[bot]'):
            with self.subTest(login=login):
                self.assertEqual(orders.classify([issue(user=dict(login=login))], {}, [])[0]['state'], 'ready')

    def test_l34_no_one_elses_issue_runs_whatever_its_labels(self):
        for author in ('COLLABORATOR', 'MEMBER', 'NONE'):
            with self.subTest(author=author):
                other = issue(author_association=author, user=dict(login='someone'), labels=[{'name': 'loop:work'}])
                self.assertEqual(orders.classify([other], {}, [])[0]['state'], 'unspecified')
        outside = issue(user=dict(login='stranger'))
        self.assertEqual([r['state'] for r in orders.classify([issue(), dict(outside, number=2)], {}, [])],
                         ['ready', 'unspecified'])
        with patch.object(orders, 'gh', return_value=outside):
            with self.assertRaisesRegex(orders.NotReady, 'no longer authorized'):
                orders.task(1)

    def test_l79_an_issue_waiting_on_the_user_or_the_mac_is_held_and_a_stall_waits_on_the_user(self):
        for label, who in [('flag:needs-user', 'the user'), ('flag:needs-mac', "an agent on the user's Mac")]:
            row = orders.classify([issue(labels=[{'name': label}])], {}, [])[0]
            self.assertEqual((row['state'], row['reason']), ('waiting', f'waits on {who} ({label})'))
        held = [{'name': 'flag:needs-user'}]
        stall = issue(key='stall-20261010-03', labels=held, body=issue(key='stall-20261010-03')['body'].replace(
            'U83', 'L94').replace('ui.md', 'loop-rules.md'))
        self.assertEqual(orders.classify([stall], {}, [])[0]['state'], 'waiting')

    def test_l118_a_loop_machinery_issue_waits_on_the_user_and_never_runs(self):
        loop = issue(body=issue()['body'].replace('U83', 'L94').replace('ui.md', 'loop-rules.md'))
        row = orders.classify([loop, issue(number=2, key='U84')], {}, [])
        self.assertEqual([(r['issue'], r['state'], r['reason']) for r in row],
                         [(1, 'waiting', 'loop machinery; only the user changes it (L118)'), (2, 'ready', '')])

    def test_l118_the_user_s_open_pr_for_a_loop_issue_shows_it_in_flight(self):
        loop = issue(body=issue()['body'].replace('U83', 'L94').replace('ui.md', 'loop-rules.md'))
        pr = dict(number=9, headRefName='loop/x', body='Refs #1', isCrossRepository=False)
        self.assertEqual(orders.classify([loop], {}, [pr])[0]['state'], 'in-flight')

    def test_l34_an_implementation_without_acceptance_on_main_is_specified_first(self):
        for scenarios, file in [('U9999', 'ui.md'), ('U83', 'nowhere.md'), ('the drawer flow', 'ui.md')]:
            with self.subTest(scenarios=scenarios, file=file):
                body = issue()['body'].replace('Scenarios: U83', f'Scenarios: {scenarios}').replace('ui.md', file)
                row = orders.classify([issue(body=body)], {}, [])[0]
                self.assertEqual((row['state'], row['mode'], row['respecify']), ('ready', 'specify', True))
                output = io.StringIO()
                with patch.object(orders, 'gh', return_value=issue(body=body)), \
                     patch.object(orders, 'read_orders', return_value=[row]), redirect_stdout(output):
                    orders.task(1)
                self.assertIn('Mode: specify', output.getvalue())
                self.assertIn('keeps Mode: implement', output.getvalue())
                self.assertNotIn('Closes #1', output.getvalue())

    def test_l34_a_lettered_scenario_on_main_is_implemented(self):
        for scenarios, mode in [('V4b', 'implement'), ('V4z', 'specify'), ('V1, V4b', 'implement')]:
            with self.subTest(scenarios=scenarios):
                body = issue()['body'].replace('Scenarios: U83', f'Scenarios: {scenarios}').replace('ui.md', 'proofs.md')
                row = orders.classify([issue(body=body)], {}, [])[0]
                self.assertEqual((row['state'], row['mode']), ('ready', mode))

    def test_l34_a_scenario_id_with_a_multi_letter_prefix_is_read_like_any_other(self):
        for scenarios, mode in [('LC1', 'implement'), ('LC11-LC13', 'implement'), ('LC11–LC13', 'implement'),
                                ('LC11 to LC13', 'implement'), ('LC11–13', 'implement'), ('LC1, LC14', 'implement'),
                                ('LC15', 'specify'), ('LC13–LC15', 'specify')]:
            with self.subTest(scenarios=scenarios):
                body = issue()['body'].replace('Scenarios: U83', f'Scenarios: {scenarios}').replace('ui.md', 'lean-child-start.md')
                row = orders.classify([issue(body=body)], {}, [])[0]
                self.assertEqual((row['state'], row['mode']), ('ready', mode))

    def test_l34_a_one_letter_range_still_expands(self):
        for scenarios in ['U83', 'U83-U84', 'U83 to 84', 'U83–84']:
            with self.subTest(scenarios=scenarios):
                body = issue()['body'].replace('Scenarios: U83', f'Scenarios: {scenarios}')
                self.assertEqual(orders.classify([issue(body=body)], {}, [])[0]['mode'], 'implement')

    def test_l34_explicit_pr_link_preserves_a_manual_agents_owner(self):
        prs=[dict(number=12,headRefName='codex/fix',body='Refs #1',isCrossRepository=False)]
        self.assertEqual(orders.classify([issue()],{},prs)[0]['state'],'in-flight')
        prs[0]['body']='Refs #10'
        self.assertEqual(orders.classify([issue()],{},prs)[0]['state'],'ready')
        prs[0].update(body='Refs #1',isCrossRepository=True)
        self.assertEqual(orders.classify([issue()],{},prs)[0]['state'],'ready')

    def test_l34_existing_branch_owner_survives_migration(self):
        row = orders.classify([issue()], {}, [{'number':12,'headRefName':'build/U83'}])[0]
        self.assertEqual((row['state'], row['reason']), ('in-flight', '#12'))

    def test_l34_only_completed_dependencies_unblock_work(self):
        for state, reason, expected in [('open',None,'waiting'),('closed','completed','ready')]:
            with self.subTest(state=state, reason=reason):
                rows = orders.classify([issue()], {1:[dict(number=2,state=state,state_reason=reason)]}, [])
                self.assertEqual(rows[0]['state'], expected)

    def test_l34_a_cancelled_blocker_holds_nothing_and_is_reported_to_the_builder(self):
        cancelled = {1: [dict(number=2, state='closed', state_reason='not_planned')]}
        row = orders.classify([issue()], cancelled, [])[0]
        self.assertEqual((row['state'], row['cancelled']), ('ready', [2]))
        self.assertIn('#2', row['reason'])
        both = {1: cancelled[1] + [dict(number=3, state='open', state_reason=None)]}
        self.assertEqual(orders.classify([issue()], both, [])[0]['state'], 'waiting')
        output = io.StringIO()
        with patch.object(orders, 'gh', return_value=issue()), \
             patch.object(orders, 'read_orders', return_value=orders.classify([issue()], cancelled, [])), \
             redirect_stdout(output):
            orders.task(1)
        self.assertIn('Blocker #2 was closed as not planned', output.getvalue())
        self.assertIn('flag:needs-user', output.getvalue())

    def test_l34_a_cancelled_blocker_in_a_loop_is_no_cycle(self):
        loop = {1: [dict(number=2, state='closed', state_reason='not_planned')], 2: [dict(number=1, state='open')]}
        self.assertEqual(orders.classify([issue()], loop, [])[0]['state'], 'ready')

    def test_l34_duplicate_keys_block_both_orders(self):
        self.assertEqual([r['state'] for r in orders.classify([issue(),issue(2)],{},[])], ['blocked','blocked'])

    def test_l34_malformed_order_is_visible_and_not_ready(self):
        row = orders.classify([issue(body='Key: U83\nsomething to do')],{},[])[0]
        self.assertEqual(row['state'],'blocked')
        self.assertIn('Specification',row['reason'])

    def test_l34_a_request_without_queue_fields_is_specified_first(self):
        request = issue(7, body='The send button stays enabled without a Door.')
        row = orders.classify([request],{},[])[0]
        self.assertEqual((row['state'],row['mode'],row['slug'],row['priority']),('ready','specify','issue-7',50))
        output = io.StringIO()
        with patch.object(orders, 'gh', return_value=request), \
             patch.object(orders, 'read_orders', return_value=[row]), \
             redirect_stdout(output):
            orders.task(7)
        self.assertIn('Mode: implement, so the queue builds it', output.getvalue())
        self.assertNotIn('Closes #7', output.getvalue())

    def test_l34_priority_comes_from_issues(self):
        urgent = issue(2,'U84',body=issue(2,'U84')['body'].replace('Priority: 2','Priority: 0'))
        self.assertEqual([r['issue'] for r in orders.classify([issue(),urgent],{},[])],[2,1])

    def test_l34_dependency_cycle_never_dispatches(self):
        rows = orders.classify([issue(),issue(2,'U84')],
                               {1:[issue(2,'U84')],2:[issue()]},[])
        self.assertEqual([row['state'] for row in rows],['blocked','blocked'])
        self.assertTrue(all('cycle' in row['reason'] for row in rows))

    def test_l34_a_struck_issue_waits_fifteen_minutes_doubled_per_strike_in_a_day_up_to_four_hours_asking_nobody(self):
        now, day = 10 * orders.DAY, orders.DAY
        latest = [now - 60]
        waits = {1: ([], '00:14'), 3: ([now - 3000] * 2, '00:59'), 5: ([now - 3000] * 4, '03:59'), 6: ([now - 3000] * 5, '03:59')}
        for k, (earlier, ready_at) in waits.items():
            with self.subTest(strikes=k):
                row, = orders.cool(orders.classify([issue()], {}, []), {1: [now - day - 60] + earlier + latest}, now)
                self.assertEqual((row['state'], row['reason']),
                                 ('waiting', f'{k} strike{"s" * (k > 1)}; ready again at 1970-01-11 {ready_at} UTC'))
        ended = {2: [now - 16 * 60], 3: [now - 3 * 3600] + [now - 2 * 3600 - 60] * 2, 4: [now - day - 60] * 6}
        rows = orders.cool(orders.classify([issue(2, 'U84'), issue(3, 'U85'), issue(4, 'U86')], {}, []), ended, now)
        self.assertEqual([row['state'] for row in rows], ['ready'] * 3)

    def read_with(self, issues, comments=None, blockers=None):
        """`read_orders` over REST `issues`, GraphQL `comments` and `blockers` (each {Issue: nodes}); returns the rows and the
        GraphQL queries made."""
        queries = []

        def api(*args):
            if args[0] == 'pr':
                return []
            if args[1] == 'graphql':
                queries.append(args[-1])
                field, found = ('comments', comments) if 'comments(' in args[-1] else ('blockedBy', blockers)
                return dict(data=dict(repository={f'i{n}': {field: dict(totalCount=len((found or {}).get(n, [])), nodes=(found or {}).get(n, []))}
                                                  for n in map(int, re.findall(r'i(\d+):', args[-1]))}))
            return [issues]
        with patch.object(orders, 'gh', side_effect=api):
            return orders.read_orders(), queries

    def test_l34_only_the_loop_bot_strikes_count(self):
        now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())

        def strike(login, kind):
            return dict(author=dict(login=login, __typename=kind), body='<!-- strike -->\nx', createdAt=now)

        for login, kind, state in (('github-actions', 'Bot', 'waiting'), ('github-actions', 'User', 'ready'), ('someone', 'Bot', 'ready')):
            with self.subTest(login=login, kind=kind):
                rows, _ = self.read_with([issue(issue_dependencies_summary=dict(total_blocked_by=0))], comments={1: [strike(login, kind)]})
                self.assertEqual(rows[0]['state'], state)

    def test_l34_one_call_reads_every_blocker_list_and_one_every_strike_list_and_only_a_recent_issue_has_strikes_read(self):
        issues = [issue(n, f'U{n}') for n in (1, 2, 3)] + [issue(4, 'U4', updated_at='2026-01-01T00:00:00Z')]
        rows, queries = self.read_with(issues, blockers={1: [dict(number=9, state='OPEN', stateReason=None)]})
        self.assertEqual(len(queries), 2)
        self.assertTrue(all(f'i{n}:' in queries[0] for n in (1, 2, 3, 4)))
        self.assertTrue(all(f'i{n}:' in queries[1] for n in (2, 3)) and 'i1:' not in queries[1] and 'i4:' not in queries[1])
        self.assertEqual({row['issue']: row['state'] for row in rows}, {1: 'waiting', 2: 'ready', 3: 'ready', 4: 'ready'})

    def test_l34_api_failure_is_not_an_empty_queue(self):
        with patch.object(orders, 'gh', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                orders.read_orders()

    def test_l34_only_an_open_blocker_holds_and_a_cancelled_one_is_reported(self):
        blockers = {1: [dict(number=3, state='CLOSED', stateReason='COMPLETED'), dict(number=4, state='OPEN', stateReason=None)],
                    2: [dict(number=5, state='CLOSED', stateReason='NOT_PLANNED')]}
        rows, _ = self.read_with([issue(), issue(2, 'U84')], blockers=blockers)
        self.assertEqual([(row['state'], row.get('cancelled')) for row in rows], [('waiting', []), ('ready', [5])])
        self.assertIn('#4', rows[0]['reason'])

    def test_l34_more_blockers_than_one_call_returns_fail_loud(self):
        with patch.object(orders, 'gh', return_value=dict(data=dict(repository=dict(i1=dict(blockedBy=dict(totalCount=101, nodes=[])))))):
            with self.assertRaises(ValueError):
                orders.blockers([1])

    def test_l23_a_call_that_stays_rate_limited_waits_for_the_reset_once_more_and_any_other_failure_does_not(self):
        limited = subprocess.CalledProcessError(1, ['gh'], stderr='gh: API rate limit exceeded for installation ID 1. (HTTP 403)')
        reset = (0, json.dumps(dict(resources=dict(core=dict(remaining=0, reset=time.time() + 1800)))), '')
        with patch.object(orders.time, 'sleep') as sleep, patch.object(orders.subprocess, 'run', Mock(side_effect=[
                subprocess.CompletedProcess([], *reset)])):
            self.assertEqual(orders.after_rate_limit(Mock(side_effect=[limited, 'done'])), 'done')
        self.assertTrue(1700 < sleep.call_args.args[0] <= 1800)
        attempt = Mock(side_effect=[limited, limited])
        with patch.object(orders.time, 'sleep'), patch.object(orders, 'rate_wait', return_value=1), self.assertRaises(subprocess.CalledProcessError):
            orders.after_rate_limit(attempt)
        self.assertEqual(attempt.call_count, 2)
        broken = Mock(side_effect=subprocess.CalledProcessError(1, ['gh'], stderr='gh: Not Found (HTTP 404)'))
        with self.assertRaises(subprocess.CalledProcessError):
            orders.after_rate_limit(broken)
        self.assertEqual(broken.call_count, 1)


if __name__ == '__main__':
    unittest.main()
