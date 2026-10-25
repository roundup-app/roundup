//! R16 same-job comparison, through the production selection and judgment seams.
use std::collections::BTreeMap;
use perf::machine::{Machine, Provenance};

fn builder() -> Machine {
    perf::machine::parse("ID=ubuntu\nVERSION_ID=24.04", "Architecture: x86_64\nModel name: AMD EPYC 7763 64-Core Processor", "0-3", "Cpus_allowed_list: 0-3", 4)
}

#[test]
fn r16_uncalibrated_builder_selects_pair() {
    let budgets = perf::gate::read_budgets(concat!(env!("CARGO_MANIFEST_DIR"), "/budgets.json").as_ref()).unwrap();
    let class = perf::machine::comparison(&builder(), &Provenance::new(), &budgets).unwrap();
    assert!(matches!(class, perf::machine::Comparison::Paired(_)));
    let mut unknown = builder();
    unknown.cpu_model = Some("other CPU".into());
    assert!(perf::machine::comparison(&unknown, &BTreeMap::new(), &budgets).is_err());
}
