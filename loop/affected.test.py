#!/usr/bin/env python3
"""T7188: a Rust test run compiles only what it names (`loop/affected.py`), on a fixture tree and Cargo metadata that start no cargo."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "affected", Path(__file__).with_name("affected.py")
)
affected = importlib.util.module_from_spec(spec)
spec.loader.exec_module(affected)

# `alpha`'s library looks for a sibling binary; its test binaries share modules through `mod` and `#[path]`. `beta` has a binary
# and no library. `gamma` depends on `alpha`, `plain` on nothing.
FILES = {
    "crates/alpha/src/lib.rs": "mod util;\nfn lib_probe() {}\n",
    "crates/alpha/src/util.rs": 'fn util_probe() { exe.with_file_name("rup"); }\n',
    "crates/alpha/tests/one.rs": '#[path = "shared/mod.rs"]\nmod shared;\nfn one_probe() {}\n',
    "crates/alpha/tests/two.rs": "mod shared;\nfn two_probe() {}\n",
    "crates/alpha/tests/shared/mod.rs": "mod deep;\nfn shared_probe() {}\n",
    "crates/alpha/tests/shared/deep.rs": "fn deep_probe() {}\n",
    "crates/alpha/tests/solo.rs": "fn solo_probe() {}\n",
    "crates/alpha/tests/orphan/stray.rs": "fn stray_probe() {}\n",
    "crates/alpha/tests/data.json": "{}",
    "crates/beta/src/main.rs": "mod cmd;\nfn main() {}\n",
    "crates/beta/src/cmd.rs": "fn beta_unit() {}\n",
    "crates/beta/tests/spawn.rs": 'const BIN: &str = env!("CARGO_BIN_EXE_beta");\nfn spawn_probe() {}\n',
    "crates/beta/tests/calm.rs": "fn calm_probe() {}\n",
    "crates/gamma/src/lib.rs": "",
    "crates/gamma/tests/leaf.rs": "fn leaf_probe() {}\n",
    "crates/plain/src/lib.rs": "",
    "crates/plain/tests/quiet.rs": "fn quiet_probe() {}\n",
}


def cargo_metadata(root):
    """The `cargo metadata` of the fixture workspace."""

    def package(name, deps=(), lib=False, bins=(), tests=()):
        folder = root / "crates" / name
        targets = (
            [dict(kind=["lib"], name=name, src_path=str(folder / "src/lib.rs"))]
            if lib
            else []
        )
        targets += [
            dict(kind=["bin"], name=bin, src_path=str(folder / "src/main.rs"))
            for bin in bins
        ]
        targets += [
            dict(
                kind=["test"], name=test, src_path=str(folder / "tests" / f"{test}.rs")
            )
            for test in tests
        ]
        return dict(
            name=name,
            manifest_path=str(folder / "Cargo.toml"),
            dependencies=[dict(name=dep) for dep in deps] + [dict(name="serde")],
            targets=targets,
        )

    return dict(
        workspace_root=str(root),
        packages=[
            package("alpha", lib=True, tests=["one", "two", "solo"]),
            package("beta", bins=["beta"], tests=["spawn", "calm"]),
            package("gamma", deps=["alpha"], lib=True, tests=["leaf"]),
            package("plain", lib=True, tests=["quiet"]),
        ],
    )


class Fixture(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name).resolve()
        for path, text in FILES.items():
            (self.root / path).parent.mkdir(parents=True, exist_ok=True)
            (self.root / path).write_text(text)
        self.meta = cargo_metadata(self.root)


class RustTargets(Fixture):
    def ids(self, *ids):
        """The exit code, selection lines and stderr of `rust-targets <ids>`."""
        out, err = io.StringIO(), io.StringIO()
        with patch.object(affected, "metadata", return_value=self.meta), patch.object(
            affected, "ROOT", self.root
        ), contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = affected.rust_targets(list(ids))
        return code, out.getvalue().splitlines(), err.getvalue()

    def test_t7188a_an_id_selects_the_one_target_holding_its_fn(self):
        self.assertEqual(self.ids("one_probe")[:2], (0, ["-p alpha --test one"]))
        self.assertEqual(self.ids("util_probe")[:2], (0, ["-p alpha --lib"]))
        self.assertEqual(self.ids("beta_unit")[:2], (0, ["-p beta --bin beta"]))

    def test_t7188a_a_module_selects_every_binary_that_declares_it(self):
        both = ["-p alpha --test one", "-p alpha --test two"]
        self.assertEqual(self.ids("shared_probe")[:2], (0, both))
        self.assertEqual(self.ids("deep_probe")[:2], (0, both))

    def test_t7188a_ids_select_the_targets_of_each_and_an_id_is_a_name_prefix(self):
        self.assertEqual(
            self.ids("solo_pr", "calm")[:2],
            (0, ["-p alpha --test solo", "-p beta --test calm"]),
        )
        self.assertEqual(
            self.ids("probe")[1], ["-p alpha", "-p beta", "-p gamma", "-p plain"]
        )

    def test_t7188a_an_id_no_target_reads_compiles_every_crate_with_a_notice(self):
        for missing in ("no_such_test", "stray_probe"):
            code, lines, err = self.ids("one_probe", missing)
            self.assertEqual(
                (code, lines), (0, ["-p alpha", "-p beta", "-p gamma", "-p plain"])
            )
            self.assertIn(missing, err)

    def test_t7188a_an_id_that_is_no_rust_name_exits_2_and_selects_nothing(self):
        self.assertEqual(self.ids("one-probe")[:2], (2, []))


class RustSelection(Fixture):
    def rust(self, *changed):
        return affected.rust(list(changed), self.meta, self.root)

    def test_t7188b_a_test_file_selects_its_binaries_not_its_crate(self):
        self.assertEqual(
            self.rust("crates/alpha/tests/solo.rs"), ["-p alpha --test solo"]
        )
        self.assertEqual(
            self.rust("crates/alpha/tests/solo.rs", "crates/beta/tests/calm.rs"),
            ["-p alpha --test solo", "-p beta --test calm"],
        )

    def test_t7188b_a_module_file_selects_each_binary_that_declares_it(self):
        self.assertEqual(
            self.rust("crates/alpha/tests/shared/deep.rs"),
            ["-p alpha --test one", "-p alpha --test two"],
        )

    def test_t7188b_any_other_path_keeps_the_crates_and_their_dependants(self):
        self.assertEqual(
            self.rust("crates/alpha/src/util.rs"), ["-p alpha", "-p gamma"]
        )
        self.assertEqual(
            self.rust("crates/alpha/tests/solo.rs", "crates/plain/src/lib.rs"),
            ["-p alpha", "-p gamma", "-p plain"],
        )
        self.assertEqual(
            self.rust("crates/alpha/tests/data.json"), ["-p alpha", "-p gamma"]
        )
        self.assertEqual(self.rust("crates/alpha/tests/solo.rs", "justfile"), "all")

    def test_t7188b_a_test_file_no_binary_reads_keeps_its_crate(self):
        self.assertEqual(
            self.rust("crates/alpha/tests/orphan/stray.rs"), ["-p alpha", "-p gamma"]
        )
        self.assertEqual(
            self.rust("crates/alpha/tests/gone.rs"), ["-p alpha", "-p gamma"]
        )

    def test_t7188b_a_test_file_another_crates_tests_read_keeps_that_crate_too(self):
        with patch.dict(affected.CRATE_READS, {"crates/alpha/tests/solo.rs": "plain"}):
            self.assertEqual(
                self.rust("crates/alpha/tests/solo.rs"),
                ["-p alpha", "-p gamma", "-p plain"],
            )


class RustHelpers(Fixture):
    def helpers(self, args):
        return affected.helpers(args.split(), self.meta, self.root)

    def test_t7188c_every_test_builds_the_helpers(self):
        self.assertEqual(self.helpers("--profile ci1 --test-threads 4"), "build")
        self.assertEqual(self.helpers("--workspace"), "build")

    def test_t7188c_a_selection_builds_them_only_when_a_selected_target_reads_one(self):
        self.assertEqual(self.helpers("-p beta --test spawn"), "build")
        self.assertEqual(self.helpers("-p beta"), "build")
        self.assertEqual(self.helpers("-p beta --test calm"), "skip")
        self.assertEqual(self.helpers("-p plain --no-tests pass"), "skip")
        self.assertEqual(
            self.helpers("--package=plain --test=quiet quiet_probe"), "skip"
        )

    def test_t7188c_a_library_a_selected_crate_depends_on_counts_as_its_source(self):
        self.assertEqual(self.helpers("-p gamma --test leaf"), "build")
        self.assertEqual(self.helpers("-p alpha --test solo"), "build")

    def test_t7188c_the_decision_is_printed(self):
        out = io.StringIO()
        with patch.object(affected, "metadata", return_value=self.meta), patch.object(
            affected, "ROOT", self.root
        ), contextlib.redirect_stdout(out):
            self.assertEqual(
                affected.main(["affected.py", "rust-helpers", "-p", "plain"]), 0
            )
        self.assertEqual(out.getvalue(), "skip\n")


class RustLane(Fixture):
    """CI7295f: a CI lane builds only the test binaries its nextest profile names that the diff reaches."""

    def lane(self, expression, changed=None, features=None):
        config = self.root / ".config/nextest.toml"
        config.parent.mkdir(exist_ok=True)
        config.write_text(f"[profile.lane]\ndefault-filter = '''{expression}'''\n")
        return affected.lane_args("lane", changed, self.meta, self.root, features or {})

    def test_ci7295f_a_lane_builds_the_binaries_its_profile_names_under_the_workspace(self):
        self.assertEqual(
            self.lane("binary_id(=plain::quiet) | (binary_id(=gamma::leaf) & test(=leaf_probe))"),
            "--workspace --test leaf --test quiet",
        )
        self.assertEqual(
            self.lane("package(gamma)"), "--workspace --exclude alpha --exclude beta --exclude plain --lib --test leaf"
        )

    def test_ci7295f_a_not_lane_takes_every_binary_but_those_it_names_alone(self):
        self.assertEqual(
            self.lane(
                "not (binary_id(=alpha::solo) | binary_id(=beta::bin/beta)"
                " | (binary_id(=alpha::one) & test(=one_probe)))"
            ),
            "--workspace --lib --test calm --test leaf --test one --test quiet --test spawn --test two",
        )

    def test_ci7295f_the_diff_narrows_a_lane_and_a_lane_it_misses_builds_nothing(self):
        named = "binary_id(=alpha::solo) | binary_id(=beta::calm)"
        self.assertEqual(self.lane(named, ["crates/alpha/tests/solo.rs"]), "--workspace --test solo")
        self.assertIsNone(self.lane(named, ["crates/plain/src/lib.rs"]))
        self.assertEqual(self.lane(named, ["justfile"]), "--workspace --test calm --test solo")

    def test_ci7295f_tests_that_start_helpers_build_one_uniquely_named_test_of_each_helper_crate(self):
        with patch.object(affected, "HELPER_CRATES", ("alpha",)):
            self.assertEqual(self.lane("binary_id(=beta::spawn)"), "--workspace --test solo --test spawn")
            self.assertEqual(self.lane("binary_id(=plain::quiet)"), "--workspace --test quiet")
            self.assertEqual(
                self.lane("binary_id(=beta::spawn) | binary_id(=alpha::two)"), "--workspace --test spawn --test two"
            )
            (self.root / "crates/plain/tests/solo.rs").write_text("")
            self.meta["packages"][3]["targets"].append(
                dict(kind=["test"], name="solo", src_path=str(self.root / "crates/plain/tests/solo.rs"))
            )
            self.assertEqual(self.lane("binary_id(=beta::spawn)"), "--workspace --test spawn --test two")

    def test_ci7295f_a_target_missing_its_required_features_builds_in_no_lane(self):
        self.meta["packages"][1]["targets"][0]["required-features"] = ["export"]
        self.assertIsNone(self.lane("binary_id(=beta::bin/beta)"))
        self.assertEqual(
            self.lane("binary_id(=beta::bin/beta)", features={"beta": {"export"}}), "--workspace --bin beta"
        )

    def test_ci7295f_the_command_prints_nothing_for_a_lane_the_diff_misses(self):
        self.lane("binary_id(=alpha::solo)")
        out = io.StringIO()
        with patch.object(affected, "metadata", return_value=self.meta), patch.object(
            affected, "ROOT", self.root
        ), patch.object(affected, "resolved_features", return_value={}), patch.object(
            affected, "changed_since", return_value=["crates/plain/src/lib.rs"]
        ), contextlib.redirect_stdout(out):
            self.assertEqual(affected.main(["affected.py", "rust-lane", "lane", "HEAD^1"]), 0)
        self.assertEqual(out.getvalue(), "")


if __name__ == "__main__":
    unittest.main()
