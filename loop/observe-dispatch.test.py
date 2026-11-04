#!/usr/bin/env python3
import contextlib
import importlib.util
import io
import re
import time
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('observe', ROOT / 'loop/observe-dispatch.py')
observe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observe)
orders = observe.orders

GREEN = [dict(name=n, conclusion='success') for n in
         ('plan', 'rust 1', 'rust 2', 'web 1', 'web 2', 'mac-clippy', 'mac', 'chromium', 'check')] + [dict(name='mac-package', conclusion='skipped')]


def with_job(name, conclusion):
    return [dict(job, conclusion=conclusion) if job['name'] == name else job for job in GREEN]


def block(path, header):
    """The lines indented under the first line equal to `header` in a workflow file."""
    lines = (ROOT / path).read_text().splitlines()
    start = lines.index(header)
    indent = len(header) - len(header.lstrip())
    out = []
    for line in lines[start + 1:]:
        if line.strip() and len(line) - len(line.lstrip()) <= indent:
            break
        out.append(line.strip())
    return out


class Observer(unittest.TestCase):
    def test_l118_only_the_observer_holds_actions_write_and_nothing_a_run_starts_starts_it(self):
        self.assertIn('actions: write', block('.github/workflows/observe-dispatch.yml', 'permissions:'))
        text = (ROOT / '.github/workflows/observe-dispatch.yml').read_text()
        self.assertEqual({'workflow_dispatch', 'push'}, set(re.findall(r'^  (\w+):', text.split('\non:\n')[1].split('\npermissions:')[0], re.M)) - {'inputs'})
        build = block('.github/workflows/build-issue.yml', '  build:')
        self.assertNotIn('actions: write', build[build.index('permissions:') + 1:build.index('permissions:') + 6])
        builder_src = (ROOT / 'loop/builder.py').read_text()
        self.assertIn("RUN_RIGHTS = {**RIGHTS, 'actions': 'read', 'checks': 'read'}", builder_src)
        self.assertNotIn("'actions': 'write'", builder_src)

    def test_l118_a_dispatch_passes_only_with_the_packaging_skip_and_every_other_job_green(self):
        self.assertEqual([], observe.verdict(GREEN))
        for job in GREEN:
            for conclusion in ('failure', 'cancelled', 'skipped', 'success'):
                if conclusion == job['conclusion']:
                    continue
                with self.subTest(job=job['name'], conclusion=conclusion):
                    self.assertEqual(1, len(observe.verdict(with_job(job['name'], conclusion))))
        for gone in ('plan', 'rust', 'web', 'mac-package'):
            with self.subTest(missing=gone):
                self.assertTrue(observe.verdict([j for j in GREEN if not j['name'].startswith(gone)]))


class GitHub:
    def __init__(self, event='workflow_dispatch', jobs=GREEN, status='ahead'):
        self.event, self.jobs, self.status, self.calls = event, jobs, status, []

    def gh(self, *args):
        if args[0] == 'run' and args[1] == 'list':
            old = dict(databaseId=1, createdAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(time.time() - 3600)))
            return [old, dict(databaseId=2, createdAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))]
        if args[0] == 'run':
            assert args[2] == '2', 'observed a run it did not dispatch'
            return dict(status='completed', conclusion='success', url='https://x/runs/2', headSha='b' * 40, event=self.event)
        if '/compare/' in args[1]:
            return dict(status=self.status)
        return [dict(jobs=self.jobs)]

    def call(self, *args):
        self.calls.append(args)
        return ''


class Flow(unittest.TestCase):
    def run_observer(self, **changes):
        github = GitHub(**changes)
        out = io.StringIO()
        with patch.object(orders, 'gh', github.gh), patch.object(orders, 'call', github.call), contextlib.redirect_stdout(out):
            code = observe.observe(5915)
        return code, github, out.getvalue()

    def test_l118_the_observer_dispatches_main_and_posts_the_run_s_evidence(self):
        code, github, out = self.run_observer()
        self.assertEqual(0, code)
        self.assertEqual(('workflow', 'run', 'check.yml', '--ref', 'main'), github.calls[0])
        comment = github.calls[1]
        self.assertEqual(('issue', 'comment', '5915', '--body'), comment[:4])
        for evidence in ('https://x/runs/2', 'b' * 40, 'workflow_dispatch', '| mac-package | skipped |', 'PASS'):
            self.assertIn(evidence, comment[4])

    def test_l118_a_push_run_or_a_head_without_the_fix_fails_loud_with_its_evidence_posted(self):
        for changes in (dict(event='push'), dict(status='behind'), dict(jobs=with_job('mac-package', 'success'))):
            with self.subTest(changes=changes):
                code, github, _ = self.run_observer(**changes)
                self.assertEqual(1, code)
                self.assertIn('FAIL', github.calls[1][4])


if __name__ == '__main__':
    unittest.main()
