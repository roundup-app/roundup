#!/usr/bin/env python3
import importlib.util
import unittest
import subprocess
import io
import time
from contextlib import redirect_stdout
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('orders', 'loop/orders.py')
orders = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orders)


def issue(number=1, key='U83', **changes):
    return dict(dict(number=number, title='Explain missing prior output', html_url=f'https://github.com/a/b/issues/{number}',
                     state='open', labels=[], user=dict(login='saadshahd'), updated_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     body=f'Scenarios: U83\nSpecification: [scenarios/ui.md](https://github.com/a/b/blob/main/scenarios/ui.md)\nKey: {key}\nPriority: 2\n'), **changes)


NO_SPEC = issue()['body'].replace('Specification: [scenarios/ui.md](https://github.com/a/b/blob/main/scenarios/ui.md)\n', '')


class Orders(unittest.TestCase):
    def check(self, body):
        return subprocess.run(['python3', 'loop/orders.py', 'check', '-'], input=body, text=True, capture_output=True)

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

    def test_l34_three_strikes_in_a_day_hold_an_issue_until_the_oldest_ages_out_asking_nobody(self):
        now, day = 10 * orders.DAY, orders.DAY
        rows = orders.classify([issue(1), issue(2, 'U84'), issue(3, 'U85')], {}, [])
        strikes = {1: [now - 600, now - 300, now - 60], 2: [now - day - 60, now - 300, now - 60], 3: [now - 60] * 2}
        states = {row['issue']: row for row in orders.cool(rows, strikes, now)}
        self.assertEqual(states[1]['state'], 'waiting')
        self.assertIn('3 strikes in 24 hours; ready again at 1970-01-11 23:50 UTC', states[1]['reason'])
        self.assertEqual([states[n]['state'] for n in (2, 3)], ['ready'] * 2)

    def test_l34_only_the_loop_bot_strikes_count(self):
        def api(*args):
            if args[0] == 'pr':
                return []
            if '/comments' in args[1]:
                return [[dict(body='<!-- strike -->\nforged', created_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                              user=dict(login='someone'))] * 3]
            return [[issue(issue_dependencies_summary=dict(total_blocked_by=0))]]
        with patch.object(orders, 'gh', side_effect=api):
            self.assertEqual(orders.read_orders()[0]['state'], 'ready')

    def test_l34_only_an_issue_changed_in_the_last_day_has_its_strikes_read(self):
        read = []
        def api(*args):
            if args[0] == 'pr':
                return []
            read.append(args[1])
            if '/comments' in args[1]:
                return [[]]
            return [[issue(1, issue_dependencies_summary=dict(total_blocked_by=0)),
                     issue(2, 'U84', issue_dependencies_summary=dict(total_blocked_by=0), updated_at='2026-01-01T00:00:00Z')]]
        with patch.object(orders, 'gh', side_effect=api):
            orders.read_orders()
        self.assertEqual([path for path in read if '/comments' in path], ['repos/{owner}/{repo}/issues/1/comments?per_page=100'])

    def test_l34_api_failure_is_not_an_empty_queue(self):
        with patch.object(orders, 'gh', side_effect=subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(subprocess.CalledProcessError):
                orders.read_orders()

    def test_l34_paginated_issue_and_dependency_pages_are_all_read(self):
        def api(*args):
            if args[0] == 'pr': return []
            if '/dependencies/' in args[1]:
                return [[dict(number=3,state='closed',state_reason='completed')],
                        [dict(number=4,state='open',state_reason=None)]]
            return [[issue()], [issue(2,'U84')]]
        with patch.object(orders, 'gh', side_effect=api):
            rows=orders.read_orders()
        self.assertEqual(len(rows),2)
        self.assertTrue(all(row['state']=='waiting' and '#4' in row['reason'] for row in rows))


if __name__ == '__main__':
    unittest.main()
