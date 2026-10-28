"""B4522 local Git-tree fixtures: no checkout, database, dependency or network."""
import contextlib
from functools import cache
import io
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import guard


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
        for directory in [b"crates/pads/migrations/", b"new/migrations/", b"crates/rupd/migrations/project/"]:
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
        groups = [
            (b"crates/rupd/migrations/project/", [b"0015-message-results.sql", b"0015-todo-change-actor.sql"]),
            (b"crates/rupd/migrations/project/", [b"0020-continuations.sql", b"0020-todo-refs.sql"]),
            (b"crates/rupd/migrations/project/", [b"0023-agent-finished.sql", b"0023-measurement-no-tokens-or-money.sql", b"0023-remove-decisions.sql"]),
            (b"crates/rupd/migrations/project/", [b"0026-pad-deletions.sql", b"0026-todo-deletions.sql"]),
            (b"crates/messages/migrations/", [b"001/up.sql", b"001-digest/up.sql"]),
        ]
        all_paths = {d + n for d, names in groups for n in names}
        self.assertEqual(self.check(all_paths, all_paths), [])
        for d, names in groups:
            extra = d + names[0].split(b"-")[0].split(b"/")[0].split(b".")[0] + b"-extra.sql"
            self.assertTrue(self.check(all_paths, all_paths | {extra}))
            # Even a base that already contains the extra collision grants no exception.
            self.assertTrue(self.check(all_paths | {extra}, all_paths | {extra}))

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


if __name__ == "__main__":
    unittest.main()
