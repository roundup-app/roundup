#!/usr/bin/env python3
"""L112 source/input relocation audit, without requiring generated evidence."""
import ast
import json
import os
import runpy
import re
import shutil
import tempfile
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class L112(unittest.TestCase):
    def test_l112_removed_files_have_no_test_readers(self):
        manifest = json.loads((ROOT / 'loop/evidence-paths.json').read_text())
        paths = subprocess.check_output(['git', 'ls-tree', '-r', '--name-only', manifest['revision'],
                                         'artifacts', 'crates/rpc/r16', 'crates/rupd/evidence'], cwd=ROOT, text=True).splitlines()
        self.assertEqual(len(paths), 4992)
        self.assertTrue(set(manifest['relocated']).issubset(paths))
        self.assertEqual(manifest['default'], 'generated')
        for path in paths:
            if Path(path).suffix in ('.py', '.sh'):
                self.assertEqual(manifest['relocated'][path]['kind'], 'observer', path)
        for prefix, count in manifest['counts'].items():
            self.assertEqual(sum(path.startswith(prefix + '/') for path in paths), count)
        for old, row in manifest['relocated'].items():
            self.assertIn(row['kind'], ('observer', 'input'))
            target = ROOT / row['destination']
            self.assertTrue(target.is_file(), old)
            self.assertFalse(row['destination'].startswith(('artifacts/', 'crates/rpc/r16/', 'crates/rupd/evidence/')))
        self.assertEqual(len(manifest['relocated']), 23)
        for old, row in manifest['relocated'].items():
            target = ROOT / row['destination']
            if target.suffix == '.py':
                before = subprocess.check_output(['git', 'show', f"{manifest['revision']}:{old}"], cwd=ROOT, text=True)
                def assertions(text):
                    return [ast.dump(node) for node in ast.walk(ast.parse(text))
                            if isinstance(node, ast.Assert) or
                            (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                             and node.func.attr.startswith('assert'))]
                self.assertEqual(assertions(before), assertions(target.read_text()), old)
            elif target.suffix == '.sh':
                result = subprocess.run(['bash', '-n', str(target)], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
            elif target.name == 'observer.ts.txt':
                for module in re.findall(r'from "(\./[^"\n]+)"', target.read_text()):
                    source = ROOT / 'apps/desktop/src/testing' / module
                    self.assertTrue(source.with_suffix('.ts').is_file(), module)
        for row in manifest['relocated'].values():
            target = ROOT / row['destination']
            if row['kind'] == 'observer':
                for old in manifest['relocated']:
                    self.assertNotIn(old, target.read_text(), f'{target} still names a removed input')


    def test_l112_regression_readers_run_without_evidence_directories(self):
        with tempfile.TemporaryDirectory(prefix='l112-readers-') as folder:
            checkout = Path(folder)
            shutil.copytree(ROOT / 'loop', checkout / 'loop')
            shutil.copytree(ROOT / 'apps/desktop/observers', checkout / 'apps/desktop/observers')
            (checkout / 'target').symlink_to(ROOT / 'target', target_is_directory=True)
            for command in [
                ['python3', 'loop/builder.test.py',
                 'Critic.test_l103_replay_of_an_undesigned_pr_rejects_with_a_named_cause',
                 'Critic.test_l103_replay_of_an_accepted_pr_approves'],
                ['python3', 'apps/desktop/observers/U346/observe.test.py'],
            ]:
                result = subprocess.run(command, cwd=checkout, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for path in ('artifacts', 'crates/rpc/r16', 'crates/rupd/evidence'):
                self.assertFalse((checkout / path).exists())

    def test_l112_j14_installs_its_owned_input_and_restores_the_checkout(self):
        with tempfile.TemporaryDirectory(prefix='l112-j14-') as folder:
            checkout = Path(folder)
            desktop = checkout / 'apps/desktop'
            shutil.copytree(ROOT / 'apps/desktop/observers', desktop / 'observers')
            (desktop / 'src/testing').mkdir(parents=True)
            package = desktop / 'package.json'
            original = b'{"scripts":{"test":"original"}}\n'
            package.write_bytes(original)
            def capture(command, cwd, check):
                self.assertEqual(command, ['just', 'capture', 'J14'])
                self.assertEqual(cwd, checkout)
                self.assertEqual((desktop / 'src/testing/j14_audit.test.ts').read_bytes(),
                                 (desktop / 'observers/journey/J14/observer.ts.txt').read_bytes())
                return subprocess.CompletedProcess(command, 7)
            with patch('subprocess.run', side_effect=capture):
                with self.assertRaises(SystemExit) as exit:
                    runpy.run_path(str(desktop / 'observers/journey/J14/reproduce.py'))
            self.assertEqual(exit.exception.code, 7)
            self.assertEqual(package.read_bytes(), original)
            self.assertFalse((desktop / 'src/testing/j14_audit.test.ts').exists())

    def test_l112_comparators_read_generated_inputs_outside_source(self):
        manifest = json.loads((ROOT / 'loop/evidence-paths.json').read_text())
        for row in manifest['relocated'].values():
            if not row['destination'].endswith('/compare.py'):
                continue
            with self.subTest(observer=row['destination']), tempfile.TemporaryDirectory(prefix='l112-pairs-') as folder:
                output = Path(folder)
                pairs = [dict(name=f'{i}-{kind}', qualification='clean', exit=1,
                              median_load_per_cpu=0.5, report={'metrics': {'rss_extra_mb': value}})
                         for i in range(9) for kind, value in [('historical', 2), ('repaired', 3)]]
                rows = output / ('observations/pairs.jsonl' if '/rupd/' in row['destination'] else 'pairs.jsonl')
                rows.parent.mkdir(exist_ok=True)
                rows.write_text(''.join(json.dumps(pair) + '\n' for pair in pairs))
                budgets = {'rss_extra_mb': {'baseline': {'linux': 2}, 'noise': 0, 'limit': 150}}
                budget_file = output / 'budgets.json'
                budget_file.write_text(json.dumps(budgets))
                read = Path.read_text
                def read_input(path, *args, **kwargs):
                    if str(path) == '/tmp/rpc-1374-history/crates/perf/budgets.json':
                        return budget_file.read_text()
                    return read(path, *args, **kwargs)
                with patch.dict(os.environ, ROUNDUP_OBSERVER_OUTPUT=str(output)), \
                     patch('sys.argv', ['compare.py', str(budget_file)]), \
                     patch.object(Path, 'read_text', read_input), patch('builtins.print'):
                    runpy.run_path(str(ROOT / row['destination']))
                result = json.loads((output / 'comparison.json').read_text())
                metric = result['metrics']['rss_extra_mb']
                if '/rupd/' in row['destination']:
                    self.assertEqual(metric['ceiling_misses'], 9)
                else:
                    self.assertEqual(len(metric['regression_misses_at_any_load']), 9)


if __name__ == '__main__':
    unittest.main()
