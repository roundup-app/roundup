"""B4522 local Git trees and disposable rename checkouts; no database or network."""
import contextlib
from functools import cache
import io
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import guard

FIXTURES = json.loads(Path(__file__).with_name("fixtures.json").read_text())


class Guard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.directory = tempfile.TemporaryDirectory()
        cls.cwd = os.getcwd()
        os.chdir(cls.directory.name)
        guard.git("init", "--quiet")
        cls.blob = subprocess.check_output(["git", "hash-object", "-w", "--stdin"], input=b"-- SQL is never parsed\n").strip()

    @classmethod
    def tearDownClass(cls):
        os.chdir(cls.cwd)
        cls.directory.cleanup()

    @cache
    def tree(self, paths):
        # write-tree creates real local objects from a disposable index, without a commit.
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "GIT_INDEX_FILE": str(Path(directory) / "index")}
            data = b"".join(b"100644 " + self.blob + b"\t" + p + b"\0" for p in sorted(paths))
            subprocess.run(["git", "update-index", "-z", "--index-info"], input=data, env=env, check=True)
            return subprocess.check_output(["git", "write-tree"], env=env).decode().strip()

    def check(self, before, after):
        argv = sys.argv
        sys.argv = ["guard.py", self.tree(frozenset(before)), self.tree(frozenset(after))]
        output = io.StringIO()
        try:
            with contextlib.redirect_stderr(output):
                status = guard.main()
        finally:
            sys.argv = argv
        errors = output.getvalue().splitlines()
        self.assertEqual(status, 1 if errors else 0, errors)
        return errors

    def layouts(self):
        for path in FIXTURES["layouts"]:
            directory = path.encode()
            for suffix in [b".sql", b"/up.sql"]:
                yield directory, suffix

    def test_b4522_guard_accepts_appended_migrations(self):
        for d, s in self.layouts():
            with self.subTest(directory=d, suffix=s):
                old = {d + b"001-a" + s}
                self.assertEqual(self.check(old, old | {d + b"002-b" + s, d + b"003-c" + s}), [])

    def test_b4522_guard_rejects_inserted_migrations(self):
        for d, s in self.layouts():
            for new in [b"000-earlier", b"001-a"]:
                with self.subTest(directory=d, suffix=s, new=new):
                    errors = self.check({d + b"001-z" + s}, {d + b"001-z" + s, d + new + s})
                    self.assertTrue(any(os.fsdecode(d + new + s) in e.replace(": ", "/") and "base maximum 001-z" in e for e in errors), errors)

    def test_b4522_guard_rejects_duplicate_prefixes(self):
        for d, s in self.layouts():
            for old in [set(), {d + b"001-a" + s}]:
                with self.subTest(directory=d, suffix=s, old=old):
                    paths = {d + b"001-a" + s, d + b"01-z" + s}
                    errors = self.check(old, paths)
                    self.assertTrue(any(all(os.fsdecode(p) in e for p in paths) for e in errors), errors)
        # Audit an unchanged directory even if only another directory changed.
        collision = {b"other/migrations/1.sql", b"other/migrations/01.sql"}
        self.assertTrue(self.check(collision, collision | {b"new/migrations/1.sql"}))
        self.assertEqual(self.check(set(), {b"one/migrations/1.sql", b"two/migrations/1.sql"}), [])

    def test_b4522_guard_accepts_only_recorded_duplicates(self):
        # Literal inventory is independent of the implementation's exception map.
        groups = [(d.encode(), [n.encode() for n in names]) for d, names in FIXTURES["groups"]]
        all_paths = {d + n for d, names in groups for n in names}
        self.assertEqual(self.check(all_paths, all_paths), [])
        for d, names in groups:
            extra = d + names[0].split(b"-")[0].split(b"/")[0].split(b".")[0] + b"-extra.sql"
            self.assertTrue(self.check(all_paths, all_paths | {extra}))
            # Even a base that already contains the extra collision grants no exception.
            self.assertTrue(self.check(all_paths | {extra}, all_paths | {extra}))

    def test_b4522_guard_accepts_recorded_duplicates_moved_whole(self):
        d, names = next((d.encode(), [n.encode() for n in names]) for d, names in FIXTURES["groups"])
        old = {d + n for n in names}
        moved = {b"moved/migrations/" + n for n in names}
        self.assertEqual(self.check(old, moved), [])
        self.assertTrue(self.check(old, moved | {b"moved/migrations/" + names[0].split(b"-")[0] + b"-extra.sql"}))
        self.assertTrue(self.check(old, {b"moved/migrations/" + n for n in names[:1]} | {b"moved/migrations/" + names[0].split(b"-")[0] + b"-other.sql"}))

    def test_b4522_guard_refuses_missing_base(self):
        tree = self.tree(frozenset({b"new/migrations/1.sql"}))
        argv = sys.argv
        sys.argv = ["guard.py", "missing-base", tree]
        output = io.StringIO()
        try:
            with contextlib.redirect_stderr(output):
                self.assertNotEqual(guard.main(), 0)
        finally:
            sys.argv = argv
        self.assertIn("missing-base", output.getvalue())

    def test_b4522_renumber_parallel_additions_after_each_new_base(self):
        for d, s in self.layouts():
            with self.subTest(directory=d, suffix=s):
                base = {d + b"0042-rail" + s}
                additions = {d + b"0042-a" + s, d + b"0043-a" + s}
                expected = {d + b"0043-a" + s, d + b"0044-a" + s}
                errors = self.check(base, base | additions)
                commands = [shlex.split(e.split("repository root: ")[1]) for e in errors if "repository root: " in e]
                paths = set(base | additions)
                for command in commands:
                    self.assertEqual(command[:3], ["git", "mv", "--"])
                    source, target = (os.fsencode(p) for p in command[3:])
                    if s == b"/up.sql":
                        source, target = source + s, target + s
                    self.assertIn(source, additions)
                    self.assertNotIn(target, paths)
                    paths.remove(source)
                    paths.add(target)
                self.assertEqual(paths, base | expected)
                before, after = guard.entries(self.tree(frozenset(base))), guard.entries(self.tree(frozenset(paths)))
                self.assertEqual(guard.audit(before, after), [])
                self.assertEqual(guard.renames(before, after), [])
                # Another PR lands before this branch: recompute from that base, not a guessed +1.
                next_base = base | {d + b"0043-other" + s}
                moved = guard.renames(guard.entries(self.tree(frozenset(next_base))), guard.entries(self.tree(frozenset(next_base | expected))))
                self.assertEqual({target + (s if s == b"/up.sql" else b"") for _, target in moved}, {d + b"0044-a" + s, d + b"0045-a" + s})

    def test_b4522_renumber_preserves_recorded_names_and_handles_new_sets(self):
        before = {d: set(names) for (d, _), names in guard.RECORDED.items()}
        # Collect all groups in a directory, including its applied duplicate prefixes.
        for (d, _), names in guard.RECORDED.items():
            before[d].update(names)
        after = {d: names | {b"0001-new.sql"} for d, names in before.items()}
        after[b"new/migrations"] = {b"001-first.sql", b"001-second.sql"}
        moves = guard.renames(before, after)
        for source, target in moves:
            d, name = source.rsplit(b"/", 1)
            self.assertNotIn(name, before.get(d, set()))
            after[d].remove(name)
            after[d].add(target.rsplit(b"/", 1)[1])
        self.assertEqual(guard.audit(before, after), [])
        self.assertTrue(all(names <= after[d] for d, names in before.items()))

    def test_b4522_renumber_refuses_missing_applied_names_and_width_overflow(self):
        d = next(self.layouts())[0].rstrip(b"/")
        for before, after, message in [
            ({b"0042-main.sql"}, {b"0042-branch.sql"}, "merge/rebase"),
            ({b"9999-main.sql"}, {b"9999-main.sql", b"9999-branch.sql"}, "width exhausted"),
            ({b"0042-a.sql", b"0042-b.sql"}, {b"0042-a.sql", b"0042-b.sql"}, "cannot repair"),
        ]:
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                guard.renames({d: before}, {d: after})

    def test_b4522_renumber_stages_whole_directories_without_changing_sql(self):
        # Exercise real git mv, including a destination that is another rename's source.
        cwd = os.getcwd()
        with tempfile.TemporaryDirectory() as directory:
            try:
                os.chdir(directory)
                guard.git("init", "--quiet")
                d = Path("with space's/migrations")
                for name in ["0042-main", "0042-new", "0043-new"]:
                    (d / name).mkdir(parents=True)
                    for file in ["up.sql", "down.sql"]:
                        (d / name / file).write_text(name + file)
                    if name != "0042-new":
                        guard.git("add", ".")
                        guard.git("-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", "commit", "-qm", "fixture")
                        if name == "0042-main":
                            base = guard.git("rev-parse", "HEAD").decode().strip()
                before = guard.entries(base)
                after = guard.entries("HEAD")
                # Refuse dirty state before moving anything.
                (d / "0042-new/up.sql").write_text("unfinished SQL")
                with self.assertRaisesRegex(ValueError, "clean worktree"):
                    guard.renumber(before, after)
                self.assertTrue((d / "0042-new").is_dir())
                (d / "0042-new/up.sql").write_text("0042-newup.sql")
                # Even an ignored destination must not be overwritten or nested into.
                (Path(".git") / "info/exclude").write_text("0044-new/\n")
                (d / "0044-new").mkdir()
                with self.assertRaisesRegex(ValueError, "occupied destination"):
                    guard.renumber(before, after)
                (d / "0044-new").rmdir()
                head = guard.git("rev-parse", "HEAD")
                with patch.object(sys, "argv", ["guard.py", "--renumber", base]), contextlib.redirect_stdout(io.StringIO()) as output, contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(guard.main(), 0)
                commands = [shlex.split(line) for line in output.getvalue().splitlines() if line.startswith("git mv")]
                self.assertEqual(len(commands), 2)
                for source, target in [("0042-main", "0042-main"), ("0042-new", "0043-new"), ("0043-new", "0044-new")]:
                    for file in ["up.sql", "down.sql"]:
                        self.assertEqual((d / target / file).read_text(), source + file)
                staged = guard.entries(guard.git("write-tree").decode().strip())
                self.assertEqual(guard.audit(before, staged), [])
                self.assertEqual(guard.renames(before, staged), [])
                self.assertEqual(guard.git("diff", "--name-only"), b"")
                self.assertEqual(guard.git("rev-parse", "HEAD"), head)
            finally:
                os.chdir(cwd)


if __name__ == "__main__":
    unittest.main()
