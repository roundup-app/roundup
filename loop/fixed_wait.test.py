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

    def test_l109_rust_macro_wait_is_rejected(self):
        self.write('tests/ready.rs', '''
#[tokio::test] async fn ready() {
  tokio::select! { _ = tokio::time::sleep(Duration::from_secs(1)) => {} }
}
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn('tests/ready.rs:3', result.stdout)

    def test_l109_namespace_and_local_timer_aliases_rejected(self):
        self.write('sample.test.ts', '''
import * as timers from "node:timers/promises";
import * as helper from "./helper";
const pause = timers.setTimeout;
test("ready", async () => { await pause(20); await helper.settle(); });
''')
        self.write('helper.ts', 'export function settle() { return new Promise(r => setTimeout(r, 10)); }')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('sample.test.ts:5', result.stdout)
        self.assertIn('helper.ts:1', result.stdout)

    def test_l109_rust_imported_helper_alias_rejected(self):
        self.write('tests/ready.rs', '''
use crate::helper::settle as pause;
#[test] fn ready() { pause(); }
''')
        self.write('src/helper.rs', 'pub fn settle() { std::thread::sleep(Duration::from_secs(1)); }')
        self.write('src/other.rs', 'pub fn settle() {}')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('src/helper.rs:1', result.stdout)

    def test_l109_default_and_reexported_helper_rejected(self):
        self.write('sample.test.ts', 'import pause from "./barrel"; test("ready", () => pause());')
        self.write('barrel.ts', 'export {default} from "./helper";')
        self.write('helper.ts', 'export default function settle() { return new Promise(r => setTimeout(r, 20)); }')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn('helper.ts:1', result.stdout)

    def test_l109_poll_interval_helper_is_allowed(self):
        self.write('sample.test.ts', '''
import {pause} from "./helper";
test("ready", async () => { while (!reply.ready) { await pause(); } });
''')
        self.write('helper.ts', 'export const pause = () => new Promise(r => setTimeout(r, 20));')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_real_delay_is_not_a_fake_clock_subject(self):
        self.write('sample.test.ts', '''
import {setTimeout as pause} from "node:timers/promises";
test("x", async () => { vi.useFakeTimers(); await pause(20); vi.advanceTimersByTime(20); });
''')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_guard_requires_diagnostic_not_comment(self):
        self.write('sample.test.ts', '''
test("x", () => { setTimeout(() => { reject(new Error("timeout")); /* waiting for ready */ }, 20); });
''')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_rust_product_timer_is_allowed(self):
        self.write('src/expiry.rs', '''
pub fn expire() {
  tokio::spawn(async { tokio::time::sleep(EXPIRY).await; remove_toast(); });
}
''')
        self.write('tests/ready.rs', '#[test] fn ready() { expiry::expire(); }')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_rust_select_hang_guard_names_awaited_state(self):
        self.write('tests/ready.rs', '''
#[tokio::test] async fn ready() {
  tokio::select! {
    reply = receive_reply() => assert!(reply.is_ok()),
    _ = tokio::time::sleep(TIMEOUT) => panic!("waiting for daemon reply"),
  }
}
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_fake_clock_comment_cannot_allow_real_timer(self):
        self.write('sample.test.ts', '''
test("x", (done) => { /* vi.useFakeTimers(); vi.advanceTimersByTime(20); */ setTimeout(() => done(), 20); });
''')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_rust_aliases_are_lexically_scoped(self):
        self.write('tests/ready.rs', '''
#[test] fn first() { use std::thread::sleep as pause; pause(Duration::from_secs(1)); }
#[test] fn second() { use crate::product::pause; pause(); }
''')
        self.write('src/product.rs', 'pub fn pause() {}')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn('tests/ready.rs:2', result.stdout)

    def test_l109_rust_fake_clock_subject_allows_scoped_aliases(self):
        self.write('tests/ready.rs', '''
#[tokio::test(start_paused = true)] async fn clock_subject() {
  use tokio::time::{sleep as timer, advance as tick};
  use std::time::Duration;
  let subject = timer(Duration::from_secs(1));
  tick(Duration::from_secs(1)).await;
  subject.await;
}
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_imported_object_and_class_helpers_are_rejected(self):
        self.write('sample.test.ts', '''
import {waits, Harness} from "./helper";
test("ready", async () => { const harness = new Harness(); await waits.settle(); await harness.pause(); });
''')
        self.write('helper.ts', '''
export const waits = {settle: () => new Promise(r => setTimeout(r, 20))};
export class Harness { pause() { return new Promise(r => setTimeout(r, 30)); } }
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn('helper.ts:2', result.stdout)
        self.assertIn('helper.ts:3', result.stdout)

    def test_l109_typescript_module_extensions_are_checked(self):
        for extension in ('mts', 'cts'):
            with self.subTest(extension=extension):
                path = f'added.test.{extension}'
                self.write(path, 'import {setTimeout as pause} from "node:timers/promises"; test("x", () => pause(20));')
                result = self.run_lint()
                self.assertEqual(result.returncode, 1, result.stdout)
                self.assertIn(path + ':1', result.stdout)
                (self.root / path).unlink()

    def test_l109_non_ascii_source_paths_are_checked(self):
        self.write('日本語.test.ts', 'test("x", () => new Promise(r => setTimeout(r, 20)));')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stdout)
        self.assertIn('日本語.test.ts:1', result.stdout)

    def test_l109_named_timeout_guard_is_allowed(self):
        self.write('sample.test.ts', '''
test("reply", () => {
  setTimeout(() => reject(new Error("owner call timed out")), 1000);
  setTimeout(() => reject(new Error(`${method} timed out before its reply`)), 1000);
});
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_rust_error_guard_is_allowed(self):
        self.write('tests/ready.rs', """
#[tokio::test] async fn ready() {
  tokio::select! {
    reply = receive_reply() => reply,
    _ = tokio::time::sleep(BOUND) => Err(format!("no acknowledgement within {}s", 10)),
  };
}
""")
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_paused_clock_elapsed_subject_is_allowed(self):
        self.write('tests/ready.rs', """
#[tokio::test(start_paused = true)] async fn timer_subject() {
  let start = Instant::now();
  tokio::time::sleep(HOLD / 2).await;
  send_second_star();
  receive_idle().await;
  assert_eq!(start.elapsed(), HOLD);
}
""")
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_callback_product_timer_and_reply_guards_are_allowed(self):
        self.write('product.ts', """
export function schedule(action) { setTimeout(action, 0); }
export function call() { return new Promise(resolve => {
  setTimeout(() => settle(failure(`${method} did not answer within 100 ms`)), 100);
}); }
export function boot() { return new Promise(resolve => {
  setTimeout(() => reject(new Error("the Door did not start in time; retry Door")), 100);
}); }
""")
        self.write('sample.test.ts', 'import {schedule,call,boot} from "./product"; test("x", () => {schedule(action);call();boot();});')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_paused_clock_cannot_allow_blocking_sleep(self):
        self.write('tests/ready.rs', """
#[tokio::test(start_paused = true)] async fn timer_subject() {
  let start = Instant::now();
  std::thread::sleep(HOLD);
  assert_eq!(start.elapsed(), HOLD);
}
""")
        result = self.run_lint()
        self.assertEqual(result.returncode, 1, result.stdout)

    def baseline(self):
        self.commit()
        result = self.run_lint('--inventory')
        inventory = json.loads(result.stdout)
        self.write('loop/fixed-wait-baseline.json', json.dumps({
            'base_sha': inventory['base_sha'],
            'active': sorted(row['id'] for row in inventory['waits'])}))

    def test_l109_lint_baseline_cannot_grow_or_move(self):
        original = 'test("ready", async () => { await new Promise(r => setTimeout(r, 20)); });\n'
        self.write('sample.test.ts', original)
        self.baseline()
        self.assertEqual(self.run_lint().returncode, 0)
        for changed in [original.replace('20', '30'), original + original, '\n' + original]:
            with self.subTest(source=changed):
                self.write('sample.test.ts', changed)
                self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_baselined_helper_cannot_gain_callers(self):
        self.write('sample.test.ts', 'import {pause} from "./helper"; test("x", () => pause(20));')
        self.write('helper.ts', 'export const pause = (ms: number) => new Promise(r => setTimeout(r, ms));')
        self.baseline()
        self.write('added.test.ts', 'import {pause} from "./helper"; test("y", () => pause(20));')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_shifted_helper_caller_keeps_exemption(self):
        self.write('sample.test.ts', 'import {pause} from "./helper"; test("x", () => pause(20));')
        self.write('helper.ts', 'export const pause = (ms: number) => new Promise(r => setTimeout(r, ms));')
        self.baseline()
        self.write('sample.test.ts', '\n\nimport {pause} from "./helper"; test("x", () => pause(20));')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_baselined_helper_cannot_gain_identical_calls(self):
        self.write('sample.test.ts', 'import {pause} from "./helper"; test("x", () => { pause(20); });')
        self.write('helper.ts', 'export const pause = (ms: number) => new Promise(r => setTimeout(r, ms));')
        self.baseline()
        self.write('sample.test.ts', 'import {pause} from "./helper"; test("x", () => { pause(20); pause(20); });')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_baselined_duration_constant_cannot_change(self):
        self.write('sample.test.ts', 'const MS = 20; test("x", () => new Promise(r => setTimeout(r, MS)));')
        self.baseline()
        self.write('sample.test.ts', 'const MS = 30; test("x", () => new Promise(r => setTimeout(r, MS)));')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_unrelated_shadowed_constant_does_not_change_wait(self):
        original = 'const MS = 20; test("x", () => new Promise(r => setTimeout(r, MS)));\nfunction unrelated() { const MS = 50; return MS; }'
        self.write('sample.test.ts', original)
        self.baseline()
        self.write('sample.test.ts', original.replace('50', '60'))
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_l109_rust_shadowed_duration_cannot_change(self):
        original = '#[test] fn ready() { let ms = 20; let ms = 30; std::thread::sleep(Duration::from_millis(ms)); }'
        self.write('tests/ready.rs', original)
        self.baseline()
        self.write('tests/ready.rs', original.replace('30', '40'))
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_removed_baseline_is_retired(self):
        self.write('sample.test.ts', 'test("x", () => new Promise(r => setTimeout(r, 20)));')
        self.baseline()
        self.write('sample.test.ts', 'test("x", () => {});')
        self.assertEqual(self.run_lint('--retire').returncode, 0)
        self.assertEqual(json.loads((self.root / 'loop/fixed-wait-baseline.json').read_text())['active'], [])
        self.write('sample.test.ts', 'test("x", () => new Promise(r => setTimeout(r, 20)));')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_lost_exemption_fails_only_its_language(self):
        waits = {'typescript': ('sample.test.ts', 'test("x", () => new Promise(r => setTimeout(r, 20)));'),
                 'rust': ('tests/ready.rs', '#[test] fn ready() { std::thread::sleep(Duration::from_millis(20)); }')}
        for path, source in waits.values():
            self.write(path, source)
        self.baseline()
        for language, (path, source) in waits.items():
            with self.subTest(language=language):
                self.write(path, source.replace('20', '30'))
                results = {lane: self.run_lint('--language', lane).returncode for lane in waits}
                self.write(path, source)
                self.assertEqual(results, {lane: int(lane == language) for lane in waits})

    def test_l109_committed_retirement_cannot_be_restored(self):
        source = 'test("x", () => new Promise(r => setTimeout(r, 20)));'
        self.write('sample.test.ts', source)
        self.baseline()
        old_baseline = (self.root / 'loop/fixed-wait-baseline.json').read_text()
        self.commit()
        self.write('sample.test.ts', 'test("x", () => {});')
        self.assertEqual(self.run_lint('--retire').returncode, 0)
        self.commit()
        self.write('sample.test.ts', source)
        self.write('loop/fixed-wait-baseline.json', old_baseline)
        self.assertNotEqual(self.run_lint().returncode, 0)

    def test_l109_unparseable_changed_source_fails(self):
        self.write('sample.test.ts', 'test("x", async () => { await setTimeout(')
        result = self.run_lint()
        self.assertEqual(result.returncode, 1)
        self.assertIn('cannot parse changed source', result.stdout)

    def test_l109_inventory_cannot_omit_base_waits(self):
        self.write('sample.test.ts', 'test("x", () => new Promise(r => setTimeout(r, 20)));')
        self.baseline()
        export = json.loads(self.run_lint('--inventory').stdout)
        self.assertEqual(len(export['waits']), 1)
        self.assertEqual(export['waits'][0]['awaited_state'], 'missing')
        export['waits'] = []
        self.write('loop/fixed-wait-inventory.json', json.dumps(export))
        self.assertNotEqual(self.run_lint().returncode, 0)

    def test_l109_lint_allows_guards_state_polling_and_fake_clock(self):
        self.write('sample.test.ts', '''
test("reply", async () => {
  const guard = setTimeout(() => reject(new Error("waiting for daemon reply")), 1000);
  while (!reply.ready) { await new Promise(r => setTimeout(r, 20)); }
});
test("timer", () => {
  vi.useFakeTimers(); setTimeout(() => dismiss(), 200); vi.advanceTimersByTime(200);
});
''')
        self.write('tests/ready.rs', '''
#[tokio::test] async fn ready() {
  loop { if reply.ready() { break; } tokio::time::sleep(Duration::from_millis(20)).await; }
  tokio::time::timeout(Duration::from_secs(1), reply.recv()).await.expect("waiting for daemon reply");
}
''')
        result = self.run_lint()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_l109_elapsed_loop_is_not_state_polling(self):
        self.write('tests/ready.rs', '''
#[test] fn ready() {
  while start.elapsed() < Duration::from_secs(1) { std::thread::sleep(Duration::from_millis(20)); }
}
''')
        self.assertEqual(self.run_lint().returncode, 1)

    def test_l109_state_polling_with_timeout_and_numeric_arguments_is_allowed(self):
        self.write('tests/ready.rs', '''
#[test] fn ready() {
  while Instant::now() < deadline && matches!(child.try_wait(), Ok(None)) {
    std::thread::sleep(Duration::from_millis(20));
  }
  while child.try_wait().unwrap().is_none() && started.elapsed() < bound {
    std::thread::sleep(Duration::from_millis(20));
  }
  for _ in 0..500 {
    if text.lines().any(|line| line.split_whitespace().skip(1).any(|word| word == "ready")) {
      return;
    }
    std::thread::sleep(Duration::from_millis(20));
  }
}
''')
        result = self.run_lint('--language', 'rust')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_l109_numeric_counter_loop_is_not_state_polling(self):
        self.write('tests/ready.rs', '''
#[test] fn ready() {
  loop {
    if steps >= 5 { break; }
    std::thread::sleep(Duration::from_millis(20));
    steps += 1;
  }
}
''')
        self.assertEqual(self.run_lint('--language', 'rust').returncode, 1)

    def test_l109_check_runs_typescript_and_rust_wait_lints(self):
        repository = COMMAND.parent.parent
        recipes = (repository / 'justfile').read_text()
        self.assertIn('check-rust:\n    just lint-rust\n', recipes)
        self.assertIn('lint-rust:\n    loop/fixed-wait.sh --language rust', recipes)
        self.assertIn('check-web:\n    loop/fixed-wait.sh --language typescript', recipes)
        workflow = (repository / '.github/workflows/check.yml').read_text()
        self.assertIn('run: just lint-rust\n', workflow)
        self.assertIn('run: just check-web\n', workflow)


if __name__ == '__main__':
    unittest.main()
