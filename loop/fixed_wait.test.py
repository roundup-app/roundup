"""L109 acceptance through the lint command, using isolated source trees."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

COMMAND = Path(__file__).with_name('fixed_wait.py')


class L109(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        self.write('sample.test.ts', 'test("ready", async () => {});\n')
        self.commit()

    def write(self, name, source):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source)

    def commit(self):
        subprocess.run(['git', '-C', str(self.root), 'add', '.'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=Lint', '-c',
                        'user.email=lint@example.com', 'commit', '-qm', 'fixture'], check=True)

    def run_lint(self, *args):
        return subprocess.run([sys.executable, str(COMMAND), '--root', str(self.root),
                               *args], text=True, capture_output=True)

    def test_l109_lint_rejects_new_fixed_waits_and_aliases(self):
        self.write('sample.test.ts', '''import {setTimeout as pause} from "node:timers/promises";
import {settle} from "./helper";
test("ready", async () => { await pause(20); await settle(); });
''')
        self.write('helper.ts', 'export const settle = () => new Promise(r => setTimeout(r, 10));')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('sample.test.ts:3', result.stdout)
        self.assertIn('helper.ts:1', result.stdout)
        self.assertIn('awaited state missing', result.stdout)

    def test_l109_rust_alias_helper_rejected(self):
        self.write('tests/ready.rs', '''use tokio::time::{sleep as pause, Duration};
async fn settle() { pause(Duration::from_millis(10)).await; }
#[tokio::test] async fn ready() { settle().await; }
''')
        result = self.run_lint('--language', 'rust')
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('tests/ready.rs:2', result.stdout)

    def test_l109_product_timer_is_allowed(self):
        self.write('product.ts', 'export function dismiss() { setTimeout(() => removeToast(), 20); }')
        self.write('sample.test.ts', 'import {dismiss} from "./product"; test("x", () => dismiss());')
        self.assertEqual(self.run_lint().returncode, 0)


if __name__ == '__main__':
    unittest.main()
