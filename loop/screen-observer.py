#!/usr/bin/env python3
"""L79: replay #1536's full paragraph; external GitHub/model boundaries only are substituted."""
import importlib.util
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder_tests', ROOT / 'loop/builder.test.py')
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
builder = fixtures.builder
ASK = (ROOT / 'loop/l79-native-window.txt').read_text().strip()


class Screen(unittest.TestCase):
    def route(self, ask=ASK, response='loop', failure=None):
        draft = fixtures.pr(isDraft=True, body=f'Scenarios: L79\n\n{ask}\n\nRefs #1584')
        with fixtures.GitHub(prs=[draft]) as github:
            with patch.object(builder.subprocess, 'run') as model:
                if failure:
                    model.side_effect = failure
                else:
                    model.return_value.stdout = json.dumps({'structured_output': response and dict(
                        verdict=response, reason='screen reason', preview='Check traffic-light placement')})
                question = builder.question('', 'build/U1')
                verdict = builder.screen(question, open_pr=True)
            builder.built(1, 'U1', True, '', 'https://run/1', verdict)
        return verdict, github

    def resumed(self, github):
        self.assertFalse(github.flagged(), github.writes)
        self.assertFalse(any('/labels' in str(call) for call in github.writes), github.writes)
        self.assertEqual(github.fixes(), [('-f', 'pr=9', '-f', f'head={fixtures.HEAD}', '-f', 'cause=unfinished')])
        edits = [call[5].removeprefix('body=') for call in github.writes if call[:3] == ('api', '-X', 'PATCH')]
        self.assertEqual(len(edits), 1)
        self.assertEqual(builder.stopped(dict(body=edits[0])), '')
        self.assertIn(ASK.removeprefix('Stopped:').strip(), edits[0])
        self.assertIn('The screen sent it back to the loop', github.bodies()[0])

    def test_l79_open_native_window_ask_returns_to_loop(self):
        for response in ('loop', 'user', 'mac'):
            with self.subTest(response=response):
                verdict, github = self.route(response=response)
                self.assertEqual(verdict['verdict'], 'loop')
                self.resumed(github)
        # Routing must enforce the policy even if it receives an old or incorrect screen verdict.
        for response in ('user', 'mac'):
            with fixtures.GitHub(prs=[fixtures.pr(isDraft=True, body=ASK)]) as github:
                builder.built(1, 'U1', True, '', 'https://run/1', dict(
                    verdict=response, reason='old screen', preview='Check the native window'))
            self.resumed(github)

    def test_l79_native_window_screen_failure_sets_no_waiting_label(self):
        failures = [OSError('missing claude'), subprocess.CalledProcessError(1, 'claude'),
                    subprocess.TimeoutExpired('claude', 300)]
        for failure in failures + [None]:
            with self.subTest(failure=failure):
                _, github = self.route(response=None, failure=failure)
                self.resumed(github)
                self.assertIn('no valid verdict', github.bodies()[0])
                if failure:
                    self.assertIn(str(failure), github.bodies()[0])
        for output in ('not json', '{}', '{"structured_output":{"verdict":"unknown"}}',
                       '{"structured_output":{"verdict":"user"}}'):
            with self.subTest(output=output), fixtures.GitHub(prs=[fixtures.pr(isDraft=True, body=ASK)]) as github:
                with patch.object(builder.subprocess, 'run') as model:
                    model.return_value.stdout = output
                    verdict = builder.screen(ASK, open_pr=True)
                builder.built(1, 'U1', True, '', 'https://run/1', verdict)
            self.resumed(github)

    def test_l79_mixed_native_ask_preserves_product_and_claude_questions(self):
        questions = [('Should the Rail hide archived Agents?', 'user'),
                     ('Should the native window offer two colour themes?', 'user'),
                     ('Does a logged-in real `claude` report its Status?', 'mac')]
        for question, route in questions:
            for response in (route, None):
                with self.subTest(question=question, response=response):
                    _, github = self.route(ASK + '\n' + question, response)
                    labels = [call for call in github.writes if '/labels' in str(call)]
                    self.assertIn('flag:needs-' + ('user' if response is None else route), str(labels))
                    delivered = github.bodies()[-1]
                    self.assertIn(question, delivered)
                    self.assertNotIn('Traffic-light', delivered)
                    self.assertNotIn('traffic-light', delivered)
                    self.assertNotIn('observer', delivered)
                    self.assertNotIn('readiness', delivered)
                    self.assertEqual(github.fixes(), [])

    def test_l79_mixed_questions_share_a_line_or_precede_native_checks(self):
        question = 'Should the Rail hide archived Agents?'
        for ask in (ASK + ' ' + question, 'Stopped: ' + question + ' ' + ASK.removeprefix('Stopped: '),
                    'Stopped: Does the native window drag correctly; and should the Rail hide archived Agents?'):
            with self.subTest(ask=ask):
                _, github = self.route(ask, None)
                self.assertIn(question.lower(), github.bodies()[-1].lower())
                self.assertNotIn('native window', github.bodies()[-1])
                self.assertNotIn('Traffic-light', github.bodies()[-1])

    def test_l79_native_look_and_feel_and_named_window_checks_return_to_loop(self):
        for question in ('Does the native window look right?', 'Check traffic-light placement.',
                         'Are Window menu titles correct?', 'Do Mission Control titles look right?',
                         'Does actual drag / zoom work?', 'Check native modifier clicks.',
                         'Does the Mac title bar feel right?', 'Check `just app` native behaviour.'):
            with self.subTest(question=question):
                _, github = self.route('Stopped: ' + question, None)
                self.assertFalse(github.flagged(), github.writes)
                self.assertEqual(len(github.fixes()), 1)

    def test_l79_logged_in_claude_still_routes_to_mac(self):
        question = 'Stopped: Does a logged-in real `claude` report its Status?'
        verdict, github = self.route(question, 'mac')
        self.assertEqual(verdict['verdict'], 'mac')
        self.assertIn('flag:needs-mac', str(github.writes))
        self.assertIn(question, github.bodies()[-1])

    def test_l79_spec_has_no_native_pr_head_observer(self):
        text = (ROOT / '.agents/builder.md').read_text()
        recipe = text.split('- **Spec**', 1)[1].split('- **Contract**', 1)[0]
        self.assertIn('native window observer', recipe)
        self.assertIn('main', recipe)
        matches = subprocess.run(['rg', '-n', "PR's head", str(ROOT / 'scenarios')],
                                 capture_output=True, text=True, timeout=30)
        self.assertIn(matches.returncode, (0, 1))
        self.assertFalse(any(re.search(r'\bnative\b.{0,80}(?:window|Mac observer)|(?:window|Mac observer).{0,80}\bnative\b', line, re.I) for line in matches.stdout.splitlines()), matches.stdout)


def live():
    """Observe the actual no-tools Haiku classifier, then route it against recorded external delivery."""
    prompt = builder.role('screen') + '\nThis ask belongs to an open PR.\n## Ask\n\n' + ASK + '\n'
    out = subprocess.run(['claude', '-p', '--model', builder.SCREEN_MODEL, '--tools', '', '--max-turns', '3',
                          '--output-format', 'json', '--json-schema', json.dumps(builder.SCREEN_SCHEMA)],
                         input=prompt, capture_output=True, text=True, timeout=50, check=True)
    verdict = json.loads(out.stdout)['structured_output']
    assert verdict['verdict'] == 'loop', verdict
    with fixtures.GitHub(prs=[fixtures.pr(isDraft=True, body=ASK)]) as github:
        builder.built(1, 'U1', True, '', 'https://run/l79-observer', verdict)
    Screen().resumed(github)
    print(json.dumps(dict(verdict=verdict, calls=github.writes), indent=2))


if __name__ == '__main__':
    if sys.argv[1:] == ['--live']:
        live()
    else:
        unittest.main()
