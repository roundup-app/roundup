"""C4 exercises the real freshness command in an isolated, clean checkout."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class Freshness(unittest.TestCase):
    def test_c4_contracts_fresh_detects_drift(self):
        with tempfile.TemporaryDirectory(prefix="c4-fresh-") as directory:
            checkout = Path(directory) / "checkout"
            subprocess.run(["git", "worktree", "add", "--detach", str(checkout), "HEAD"], cwd=ROOT, check=True, capture_output=True)
            try:
                env = {**os.environ, "CARGO_TARGET_DIR": str(ROOT / "target/c4-fresh")}

                def run():
                    result = subprocess.run(["just", "contracts-fresh"], cwd=checkout, env=env, text=True, capture_output=True)
                    return result.returncode, result.stdout + result.stderr

                def reset():
                    subprocess.run(["git", "reset", "--hard", "HEAD"], cwd=checkout, check=True, capture_output=True)
                    subprocess.run(["git", "clean", "-fdx", "--", "contracts/generated"], cwd=checkout, check=True, capture_output=True)

                def tree():
                    return {p.relative_to(checkout).as_posix(): p.read_bytes() for p in (checkout / "contracts/generated").rglob("*") if p.is_file()}

                code, output = run()
                self.assertEqual(code, 0, output)
                before = tree()
                code, output = run()
                self.assertEqual(code, 0, output)
                self.assertEqual(tree(), before, "second generation must be byte-identical")
                path = checkout / "contracts/generated/Actor.ts"
                declaration = checkout / "crates/contracts/src/declarations.rs"
                generator = checkout / "crates/contracts/src/bin/contracts.rs"
                for case in ("hand-edited", "missing", "missing-rust", "extra", "stale-declaration", "generator-failure"):
                    with self.subTest(case=case):
                        reset()
                        named = "Actor.ts"
                        if case == "hand-edited":
                            path.write_text(path.read_text() + "\n// hand edit\n")
                        elif case == "missing":
                            path.unlink()
                        elif case == "missing-rust":
                            (path.parent / "methodTypes.rs").unlink()
                            named = "methodTypes.rs"
                        elif case == "extra":
                            (path.parent / "extra.ts").write_text("export type Extra = null;\n")
                            named = "extra.ts"
                        elif case == "stale-declaration":
                            declaration.write_text(declaration.read_text().replace('"todo.list":', '"todo.contractProbeFresh":'))
                            named = "methods.ts"
                        else:
                            generator.write_text("fn main() { this_does_not_compile() }\n")
                            named = "failed generation step: just contracts"
                        code, output = run()
                        self.assertEqual(code, 1, output)
                        self.assertIn(named, output)
                        if case == "missing-rust":
                            self.assertEqual((path.parent / "methodTypes.rs").read_bytes(), before["contracts/generated/methodTypes.rs"])
                        if case in ("missing", "hand-edited"):
                            self.assertEqual(path.read_bytes(), before["contracts/generated/Actor.ts"], "generation must repair before reporting drift")
            finally:
                subprocess.run(["git", "worktree", "remove", "--force", str(checkout)], cwd=ROOT, check=True)


if __name__ == "__main__":
    unittest.main()
