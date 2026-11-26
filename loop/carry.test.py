#!/usr/bin/env python3
import importlib.util
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('builder', ROOT / 'loop/builder.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
carry = builder.carry

HEAD, JUDGED_HEAD = 'a' * 40, 'b' * 40
# Recorded GitHub diffs (L103). JUDGED is copy.ts of #7910's head 1955d6b8e8, the diff at the head the critic last judged.
# #7907's third head (5a47d06cae) changed only the Rust test inside `mod tests` of resume.rs; #7910's second head (e332328aa1)
# changed restart.rs and two test files. Test hunks are cut after their first lines: the filter reads no further.
JUDGED = r'''diff --git a/apps/desktop/src/app/copy.ts b/apps/desktop/src/app/copy.ts
index e74afd6b70..9701604e6e 100644
--- a/apps/desktop/src/app/copy.ts
+++ b/apps/desktop/src/app/copy.ts
@@ -51,5 +51,5 @@ export const copy = {
   coreFailure_core_protocol: "Terminals answered in a way the App cannot read.",
   coreFailure_core_io: "Terminals could not be reached.",
   coreFailure_named: (label: string, agent: string, address: string) =>
-    address === "none" ? `${label} Agent ${agent}.` : `${label} Agent ${agent} was on Terminal ${address}.`,
+    address === "none" ? `${label} Agent ${agent} was affected.` : `${label} Agent ${agent} was on Terminal ${address}.`,
 } as const;
'''
INLINE_TEST_7907 = r'''diff --git a/crates/agents/src/resume.rs b/crates/agents/src/resume.rs
index 2b047a772e..90f7c78319 100644
--- a/crates/agents/src/resume.rs
+++ b/crates/agents/src/resume.rs
@@ -735,11 +735,53 @@ mod tests {
     use super::*;
     use crate::tests::*;
 
-    #[test]
-    fn u7191d_resume_cleanup_frees_after_a_failure() {
-        let lost = RpcError::internal("core_closed: the core closed");
-        assert!(core_lost(&lost));
-        assert!(!core_lost(&RpcError::internal("core_silent: no answer")));
+    #[tokio::test]
+    async fn u7191d_resume_cleanup_frees_after_a_failure() {
+        for (failure, freed) in [
'''
TEST_FILES_7910 = r'''diff --git a/crates/messages/src/tests/a35_tests/retirement.rs b/crates/messages/src/tests/a35_tests/retirement.rs
index ea7538460c..f8cf7147ee 100644
--- a/crates/messages/src/tests/a35_tests/retirement.rs
+++ b/crates/messages/src/tests/a35_tests/retirement.rs
@@ -304,25 +304,3 @@ async fn u7191d_the_retirement_hold_frees_after_a_failure() {
     h.messages.take_over_restart("door", "r").await.unwrap();
     h.messages.reserve_restart("door", "r", None).await.unwrap();
 }
-
-#[tokio::test]
-async fn u7191d_a_start_failure_that_typed_nothing_frees_the_hold() {
-    let dir = tempfile::tempdir().unwrap();
diff --git a/crates/rupd/tests/support/mode_prompt.rs b/crates/rupd/tests/support/mode_prompt.rs
index 45435b8709..4ee4ee3e55 100644
--- a/crates/rupd/tests/support/mode_prompt.rs
+++ b/crates/rupd/tests/support/mode_prompt.rs
@@ -754,7 +754,7 @@ fn project_db(run: &Run) -> std::path::PathBuf {
         .expect("the Project database")
 }
 
-/// Fail one Restart on the missing program, leaving its hold `Reserved` under `key`.
+/// Fail one Restart on the missing program.
 async fn fail_start(run: &mut Run, key: &str) {
     let fake = run.dir.path().join("claude");
'''
SOURCE_7910 = r'''diff --git a/crates/rupd/src/restart.rs b/crates/rupd/src/restart.rs
index c062e658b0..baf711654c 100644
--- a/crates/rupd/src/restart.rs
+++ b/crates/rupd/src/restart.rs
@@ -88,9 +88,9 @@ impl Daemon {
                 Ok(fresh) => fresh,
                 Err(error) => {
                     // The lifecycle result confirms cleanup; an interrupted/unknown launch
-                    // keeps Starting. Retain the reservation and its original prompt bytes.
+                    // keeps Starting. Any other failure typed nothing, so the hold frees at once.
                     if error.code != code::UNKNOWN_OUTCOME {
-                        messages.set_session_restart(&p.id, &key, SessionRestart::Reserved)?;
+                        messages.free_restart(&p.id, &key).await?;
                     }
                     return Err(self.named_failure(node, None, error));
                 }
'''
MIXED_7907 = r'''diff --git a/crates/agents/src/resume.rs b/crates/agents/src/resume.rs
--- a/crates/agents/src/resume.rs
+++ b/crates/agents/src/resume.rs
@@ -10,2 +10,3 @@ mod tests {
     }
+fn production() {}
 }
'''


class Heads:
    """The PR's diffs by head, its `CRITIC:` comments (oldest first) and the statuses builder.py writes."""

    def __init__(self, notes, diffs):
        self.notes, self.diffs, self.writes = notes, diffs, []

    def compare(self, *args):
        diff = self.diffs[args[1].rsplit('...', 1)[1]]
        if isinstance(diff, Exception):
            raise diff
        return diff

    def __enter__(self):
        self.patches = [patch.object(carry.orders, 'marked', return_value=self.notes), patch.object(carry.orders, 'call', side_effect=self.compare),
                        patch.object(builder, 'call', side_effect=lambda *args: self.writes.append(args))]
        for p in self.patches:
            p.start()
        return self

    def __exit__(self, *_):
        for p in self.patches:
            p.stop()


def critic(verdict, head=JUDGED_HEAD, created='2026-11-25T10:00:00Z'):
    return dict(body=f'CRITIC: {verdict}\nHead: {head}\n\nthe finding', created_at=created)


class Carry(unittest.TestCase):
    def test_l103_a_head_that_changes_only_tests_carries_the_last_verdict_with_no_model(self):
        for name, verdict, tests in (('#7907 third head', 'reject', INLINE_TEST_7907), ('#7910 second head less restart.rs', 'reject', TEST_FILES_7910),
                                     ('an approve', 'approve', INLINE_TEST_7907)):
            with self.subTest(name), Heads([critic(verdict)], {HEAD: JUDGED + tests, JUDGED_HEAD: JUDGED}) as heads:
                self.assertTrue(builder.carried_over_tests(dict(number=9, headRefOid=HEAD), 'https://run/7'))
                self.assertEqual(heads.writes, [('api', f'repos/{{owner}}/{{repo}}/statuses/{HEAD}',
                                                 '-f', f'state={"success" if verdict == "approve" else "failure"}', '-f', 'context=critic',
                                                 '-f', f'description=Only tests changed since {JUDGED_HEAD[:9]}, which the critic run answered {verdict}',
                                                 '-f', 'target_url=https://run/7')])

    def test_l103_a_head_that_changes_source_or_is_judged_again_runs_the_critic(self):
        for name, now in (('#7910 second head', JUDGED + TEST_FILES_7910 + SOURCE_7910), ('a mod tests hunk that reaches production', JUDGED + MIXED_7907),
                          ('GitHub cannot diff the head', subprocess.CalledProcessError(1, 'gh')), ('a rerun on the judged head', None)):
            head = JUDGED_HEAD if now is None else HEAD
            with self.subTest(name), Heads([critic('reject')], {HEAD: now, JUDGED_HEAD: JUDGED}) as heads:
                self.assertFalse(builder.carried_over_tests(dict(number=9, headRefOid=head), 'https://run/7'))
                self.assertEqual(heads.writes, [])

    def test_l103_a_carried_reject_reaches_its_fix_run_unless_the_source_changed(self):
        for now, wanted in ((JUDGED + INLINE_TEST_7907, True), (JUDGED + SOURCE_7910, False)):
            with Heads([], {HEAD: now, JUDGED_HEAD: JUDGED}):
                self.assertEqual(carry.open_reject(HEAD, [critic('reject')], 0), wanted)
        self.assertFalse(carry.open_reject(HEAD, [critic('approve')], 0))
        self.assertFalse(carry.open_reject(JUDGED_HEAD, [critic('reject')], carry.orders.created('2026-11-25T11:00:00Z')), 'a fix run began after it')


if __name__ == '__main__':
    unittest.main()
