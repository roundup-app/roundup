use super::baseline;
use serde_json::{Value, json};
use std::collections::BTreeMap;

fn budgets(value: Option<f64>) -> String {
    let baseline = value.map(|v| json!({"linux-9v45": v})).unwrap_or(json!({}));
    json!({"ping_p95_ms": {"baseline": baseline}}).to_string()
}

fn pair(old: Option<f64>, new: Option<f64>) -> Value {
    let observation = json!({
        "metric": "ping_p95_ms", "class": "linux-9v45", "measurement": 0.025,
        "unit": "ms", "reference": "a".repeat(40), "command": "just perf --runs 11",
        "host": "vm-123", "session": "round-1", "report": "crates/perf/evidence/before.json"
    });
    let mut after = observation.clone();
    after["measurement"] = json!(0.026);
    after["reference"] = json!("b".repeat(40));
    after["report"] = json!("crates/perf/evidence/after.json");
    json!({"metric":"ping_p95_ms", "class":"linux-9v45", "old":old, "new":new, "before":observation, "after":after})
}

fn files(pair: &Value) -> BTreeMap<String, String> {
    BTreeMap::from([
        (
            "crates/perf/baseline-pairs.json".into(),
            json!([pair]).to_string(),
        ),
        (
            "crates/perf/evidence/before.json".into(),
            pair["before"].to_string(),
        ),
        (
            "crates/perf/evidence/after.json".into(),
            pair["after"].to_string(),
        ),
    ])
}

#[test]
fn r26_baseline_edits_require_same_host_pair() {
    for (old, new) in [
        (Some(0.025), Some(0.026)),
        (None, Some(0.026)),
        (Some(0.025), None),
    ] {
        let complete = pair(old, new);
        let mut cases = vec![("complete", files(&complete), None)];
        let mut absent = files(&complete);
        absent.remove("crates/perf/baseline-pairs.json");
        cases.push(("absent pair", absent, Some("missing pair")));
        for field in ["class", "host", "session", "command", "unit", "metric"] {
            let mut changed = complete.clone();
            changed["after"][field] = json!("different");
            cases.push((field, files(&changed), Some(field)));
        }
        for field in ["class", "metric", "old", "new", "after"] {
            let mut changed = complete.clone();
            if field == "after" {
                changed.as_object_mut().unwrap().remove(field);
            } else if field == "old" || field == "new" {
                changed[field] = json!(9.0);
            } else {
                changed[field] = json!("another");
            }
            cases.push((
                field,
                files(&changed),
                Some(if field == "after" { "after" } else { "old/new" }),
            ));
        }
        for field in ["old", "new"] {
            let mut changed = complete.clone();
            changed.as_object_mut().unwrap().remove(field);
            cases.push(("implicit absence", files(&changed), Some(field)));
        }
        for field in ["measurement", "reference", "report"] {
            let mut changed = complete.clone();
            changed["after"].as_object_mut().unwrap().remove(field);
            cases.push(("incomplete measurement", files(&changed), Some(field)));
        }
        let mut absent_report = files(&complete);
        absent_report.remove("crates/perf/evidence/after.json");
        cases.push(("absent report", absent_report, Some("report")));
        let mut wrong_report = files(&complete);
        let mut report = complete["after"].clone();
        report["host"] = json!("different-host");
        wrong_report.insert("crates/perf/evidence/after.json".into(), report.to_string());
        cases.push(("wrong report", wrong_report, Some("report")));
        for (case, files, failure) in cases {
            let result = baseline::validate(&budgets(old), &budgets(new), |path| {
                files
                    .get(path)
                    .cloned()
                    .ok_or_else(|| format!("unreadable {path}"))
            });
            match failure {
                None => assert_eq!(result, Ok(()), "{case}"),
                Some(field) => {
                    let error = result.expect_err(case);
                    assert!(
                        error.contains("ping_p95_ms/linux-9v45") && error.contains(field),
                        "{case}: {error}"
                    );
                }
            }
        }
    }
    assert_eq!(
        baseline::validate(&budgets(Some(0.025)), &budgets(Some(0.025)), |_| panic!(
            "unchanged budgets read evidence"
        )),
        Ok(())
    );
}

#[test]
fn r26_unreadable_budget_inputs_fail() {
    for (base, head, name) in [("bad", "{}", "base"), ("{}", "bad", "head")] {
        assert!(
            baseline::validate(base, head, |_| unreachable!())
                .unwrap_err()
                .contains(name)
        );
    }
}

#[test]
fn r26_git_baseline_edits_cannot_pass_by_editing_pins_or_uncommitted_evidence() {
    use std::{fs, process::Command};
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path();
    let git = |args: &[&str]| {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("GIT_AUTHOR_NAME", "Fixture")
            .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
            .env("GIT_COMMITTER_NAME", "Fixture")
            .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        String::from_utf8(output.stdout).unwrap().trim().to_string()
    };
    git(&["init", "--quiet"]);
    fs::create_dir_all(root.join("crates/perf/tests")).unwrap();
    fs::write(root.join("crates/perf/budgets.json"), budgets(Some(0.025))).unwrap();
    git(&["add", "."]);
    git(&[
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "base",
    ]);
    let base = git(&["rev-parse", "HEAD"]);
    fs::write(root.join("crates/perf/budgets.json"), budgets(Some(0.026))).unwrap();
    fs::write(
        root.join("crates/perf/tests/budget.rs"),
        "// updated R8 pin: 0.026",
    )
    .unwrap();
    git(&["add", "."]);
    git(&[
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "edited budget and pin",
    ]);
    let error = baseline::validate_git(root, &base, "HEAD").unwrap_err();
    assert!(
        error.contains("ping_p95_ms/linux-9v45") && error.contains("missing pair"),
        "{error}"
    );
    for (path, text) in files(&pair(Some(0.025), Some(0.026))) {
        fs::create_dir_all(root.join(&path).parent().unwrap()).unwrap();
        fs::write(root.join(path), text).unwrap();
    }
    assert!(
        baseline::validate_git(root, &base, "HEAD").is_err(),
        "uncommitted evidence passed"
    );
    git(&["add", "."]);
    git(&[
        "-c",
        "core.hooksPath=/dev/null",
        "commit",
        "--quiet",
        "-m",
        "committed pair",
    ]);
    assert_eq!(baseline::validate_git(root, &base, "HEAD"), Ok(()));
    for (base_ref, head_ref, missing) in [
        ("absent-base", "HEAD", "absent-base"),
        (&base, "absent-head", "absent-head"),
    ] {
        assert!(
            baseline::validate_git(root, base_ref, head_ref)
                .unwrap_err()
                .contains(missing)
        );
    }
}
