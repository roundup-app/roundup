#!/usr/bin/env python3
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('event_line', Path(__file__).resolve().parent / 'event_line.py')
event_line = importlib.util.module_from_spec(spec)
spec.loader.exec_module(event_line)


def label(command):
    return event_line.label(dict(type='tool_use', name='Bash', input=dict(command=command)))


class StepLog(unittest.TestCase):
    def test_l23_the_step_log_names_every_tool_and_the_plain_words_of_each_command_behind_cd_and_timeout(self):
        for name, shown in (('Read', 'Read'), ('mcp__roundup__todo_create', 'mcp__roundup__todo_create'), ('say hello', ''), (7, ''),
                            (None, '')):
            with self.subTest(tool=name):
                self.assertEqual(event_line.label(dict(type='tool_use', name=name, input=dict(file_path='/secret'))), shown)
        self.assertEqual(event_line.label(dict(type='text', name='Read')), '')
        commands = {
            'timeout 120 pnpm vitest run src/a.test.ts': 'pnpm vitest run',
            'timeout -k 5 300 cargo nextest run': 'cargo nextest run',
            'timeout 2m just lint-web': 'just lint-web',
            'FOO=1 timeout --kill-after=5 300 git status': 'git status',
            'cd apps/desktop && timeout 90 pnpm vitest related': 'pnpm vitest related',
            'sed -n 1p f && pnpm test': 'sed && pnpm test',
            'git fetch || git pull; cargo build 2>&1 | tail -5': 'git fetch || git pull ; cargo build | tail',
            'git fetch&&git pull;ls|head': 'git fetch && git pull ; ls | head',
            'a && python3 x && b': 'a && b',
            'git log one two three four': 'git log one',
            'a && b && c && d && e': 'a && b && c && d',
            'python3 x.py && git push': 'git push',
            'python3 x.py': 'Bash',
            'timeout 120 ./run.sh --flag word': 'Bash',
            'echo user@host.example': 'echo',
            # A quoted string or an escaped character is part of one word, and no operator inside it splits the command.
            'git commit -m "x; ship it now" && git push': 'git commit && git push',
            "echo 'x; secret words' && just lint-web": 'echo && just lint-web',
            'gh pr create --body="x; secret words"': 'gh pr create',
            'FOO="a; b" cmd': 'cmd',
            'echo "a \\"x; secret words\\" b" && z': 'echo && z',
            'find . -exec rm {} \\; && just lint-web': 'find && just lint-web',
            'echo $(git rev-parse HEAD) && z': 'echo && z',
            'echo hi # x; y words': 'echo hi',
            # What shlex cannot split names the tool, and what it reads wrongly stops the label: a here-document, whose text no
            # command reads, and a command substitution in a quoted string, whose own quotes it pairs with the string's.
            'echo "x; secret words': 'Bash',
            'echo x\\': 'Bash',
            'cat <<EOF\nfix it; ship now\nEOF': 'cat',
            "cd x && cat <<'EOF' | tail\ndon't; stop\nEOF": 'cat',
            'echo "$(echo "x; secret words")" && z': 'echo',
            'echo `echo "x; secret words"` && z': 'echo',
            # A word is read from the first 20,000 characters, since shlex takes time quadratic in the length of one word.
            'git status && echo "' + 'a' * 1_000_000 + '"': 'Bash',
        }
        for command, shown in commands.items():
            with self.subTest(command=command[:80]):
                self.assertEqual(label(command), shown)
        self.assertEqual(event_line.label(dict(type='tool_use', name='Bash', input='ls')), 'Bash')


if __name__ == '__main__':
    unittest.main()
