//! Scenario R16 (`scenarios/perf.md`): a Linux run compares only the baseline measured on its own machine class.

use std::collections::BTreeMap;

use perf::budget::{Budget, Budgets, Miss, Report, judge_all};
use perf::machine::{BOXD, LINUX_METRICS, Machine, Provenance, parse, select};

const MODELS: [(&str, &str); 5] = [
    ("linux-9v45", "AMD EPYC 9V45 96-Core Processor"),
    ("linux-7763", "AMD EPYC 7763 64-Core Processor"),
    ("linux-9v74", "AMD EPYC 9V74 80-Core Processor"),
    ("linux-8573c", "INTEL(R) XEON(R) PLATINUM 8573C"),
    (
        "linux-8370c",
        "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz",
    ),
];

fn machine(model: &str, online: &str, cpus: usize, affinity: &str) -> Machine {
    parse(
        "NAME=\"Ubuntu\"\nID=ubuntu\nVERSION_ID=\"24.04\"\n",
        &format!("Architecture:    x86_64\nModel name:      {model}\n"),
        &format!("{online}\n"),
        &format!("Name:\tperf\nCpus_allowed_list:\t{affinity}\n"),
        cpus,
    )
}

fn builder(model: &str) -> Machine {
    machine(model, "0-3", 4, "0-3")
}

/// Every class measured, each with a distinct value per metric so reuse across classes shows.
fn budgets() -> Budgets {
    LINUX_METRICS
        .iter()
        .map(|name| {
            let mut baseline: BTreeMap<String, f64> = MODELS
                .iter()
                .enumerate()
                .map(|(i, (key, _))| (key.to_string(), 1.0 + i as f64))
                .collect();

            baseline.insert(BOXD.into(), 0.5);

            (
                name.to_string(),
                Budget {
                    limit: Some(150.0),
                    noise: 0.0,
                    baseline,
                    max_load_per_cpu: BTreeMap::from([("linux".to_string(), 2.0)]),
                },
            )
        })
        .collect()
}

fn provenance() -> Provenance {
    MODELS
        .iter()
        .map(|(key, _)| *key)
        .chain([BOXD])
        .map(|key| (key.to_string(), format!("measured on {key}")))
        .collect()
}

fn select_in(
    machine: &Machine,
    budgets: &Budgets,
    provenance: &Provenance,
) -> Result<String, String> {
    select(machine, provenance, |metric, key| {
        budgets[metric].baseline.contains_key(key)
    })
    .map(|class| format!("{}|{}", class.key, class.provenance))
}

#[test]
fn r16_builder_selects_its_measured_class() {
    let (budgets, provenance) = (budgets(), provenance());

    for (key, model) in MODELS {
        let class = select(&builder(model), &provenance, |metric, k| {
            budgets[metric].baseline.contains_key(k)
        })
        .unwrap();

        assert_eq!(class.key, key);
        assert_eq!(class.provenance, format!("measured on {key}"));
        assert_eq!(class.machine.cpu_model.as_deref(), Some(model));
        assert_eq!(class.machine.version_id.as_deref(), Some("24.04"));

        let report = Report {
            os: "linux".into(),
            class: Some(class),
            cpus: 4,
            runs: 1,
            loads: vec![0.0],
            metrics: LINUX_METRICS.iter().map(|m| (m.to_string(), 0.0)).collect(),
            per_run: BTreeMap::new(),
            skipped: vec![],
        };
        let json = serde_json::to_value(&report).unwrap();

        assert_eq!(json["class"]["key"], key);
        assert_eq!(json["class"]["machine"]["affinity"], "0-3");
    }

    let boxd = machine("AMD EPYC 7B13", "0-1", 2, "0-1");

    assert_eq!(
        select_in(&boxd, &budgets, &provenance).unwrap(),
        "linux-boxd|measured on linux-boxd"
    );
}

#[test]
fn r16_selected_class_judges_only_its_own_baseline() {
    let budgets = budgets();
    let class = |model| select(&builder(model), &provenance(), |_, _| true).unwrap();
    let metrics = || LINUX_METRICS.iter().map(|m| (m.to_string(), 2.0)).collect();
    let report = |class| Report {
        os: "linux".into(),
        class: Some(class),
        cpus: 4,
        runs: 1,
        loads: vec![0.0],
        metrics: metrics(),
        per_run: BTreeMap::new(),
        skipped: vec![],
    };

    // 9V45 measured 1.0 (ceiling 1.1); 9V74 measured 3.0 (ceiling 3.3): the same 2.0 fails on one and passes on the other.
    let slow = judge_all(&report(class(MODELS[0].1)), &budgets).unwrap();
    let fast = judge_all(&report(class(MODELS[2].1)), &budgets).unwrap();

    assert!(matches!(slow.misses[0].1, Miss::Regressed { baseline, .. } if baseline == 1.0));
    assert!(fast.misses.is_empty());
}

#[test]
fn r16_affinity_does_not_reclassify_the_host() {
    let (budgets, provenance) = (budgets(), provenance());
    let narrowed = machine("AMD EPYC 7763 64-Core Processor", "0-3", 2, "0-1");
    let err = select_in(&narrowed, &budgets, &provenance).unwrap_err();

    assert!(err.contains("matches no measured class"), "{err}");
}

#[test]
fn r16_unknown_or_incomplete_linux_class_is_an_observer_error() {
    let (budgets, provenance) = (budgets(), provenance());
    let model = MODELS[2].1;

    for wrong in [
        "amd epyc 9v74 80-core processor",
        "AMD EPYC 9V74",
        "Intel(R) Xeon(R) Platinum 8573C",
    ] {
        let err = select_in(&builder(wrong), &budgets, &provenance).unwrap_err();

        assert!(
            err.contains("not a supported Builder model"),
            "{wrong}: {err}"
        );
    }

    let mut other_os = builder(model);
    other_os.version_id = Some("22.04".into());
    assert!(select_in(&other_os, &budgets, &provenance).is_err());

    let mut missing = builder(model);
    missing.cpu_model = None;
    assert!(
        select_in(&missing, &budgets, &provenance)
            .unwrap_err()
            .contains("cpu model is missing")
    );

    let mut no_affinity = builder(model);
    no_affinity.affinity = None;
    assert!(
        select_in(&no_affinity, &budgets, &provenance)
            .unwrap_err()
            .contains("Cpus_allowed_list")
    );

    let mut no_baseline = self::budgets();
    no_baseline
        .get_mut("ping_p95_ms")
        .unwrap()
        .baseline
        .remove("linux-9v74");
    let err = select_in(&builder(model), &no_baseline, &provenance).unwrap_err();
    assert!(
        err.contains("linux-9v74") && err.contains("ping_p95_ms"),
        "{err}"
    );

    let mut no_provenance = provenance.clone();
    no_provenance.insert("linux-9v74".into(), " ".into());
    let err = select_in(&builder(model), &budgets, &no_provenance).unwrap_err();
    assert!(err.contains("provenance"), "{err}");
}

#[test]
fn r16_class_baselines_have_pinned_provenance() {
    let path = |name: &str| format!("{}/{name}", env!("CARGO_MANIFEST_DIR"));
    let committed: Budgets =
        serde_json::from_slice(&std::fs::read(path("budgets.json")).unwrap()).unwrap();
    let provenance = perf::machine::read_provenance(path("classes.json").as_ref()).unwrap();

    assert_eq!(
        provenance.keys().collect::<Vec<_>>(),
        ["linux-7763", "linux-boxd"],
        "a class gained or lost provenance"
    );

    for key in provenance.keys() {
        assert!(!provenance[key].trim().is_empty(), "{key}");
    }

    // Every committed Linux baseline sits under a class that has provenance.
    for (name, budget) in &committed {
        for key in budget.baseline.keys().filter(|k| k.starts_with("linux")) {
            assert!(
                provenance.contains_key(key),
                "{name}: {key} has no provenance"
            );
        }
    }

    for metric in LINUX_METRICS {
        assert!(committed[metric].baseline.contains_key(BOXD), "{metric}");
        assert!(
            !committed[metric].baseline.contains_key("linux"),
            "{metric}"
        );
    }
}
