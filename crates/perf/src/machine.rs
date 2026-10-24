//! R16: which measured machine class this run is on, so a baseline is compared only with values measured on that class.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// The five Linux baseline metrics every class must hold before its baselines count as measured.
pub const LINUX_METRICS: [&str; 5] = [
    "ping_p95_ms",
    "rail_tree_40_p95_ms",
    "rss_extra_mb",
    "terminal_write_p95_ms",
    "write_to_output_p95_ms",
];

/// What a class is called in `budgets.json`'s `baseline` maps, and its exact identity.
const BUILDERS: [(&str, &str); 5] = [
    ("linux-9v45", "AMD EPYC 9V45 96-Core Processor"),
    ("linux-7763", "AMD EPYC 7763 64-Core Processor"),
    ("linux-9v74", "AMD EPYC 9V74 80-Core Processor"),
    ("linux-8573c", "INTEL(R) XEON(R) PLATINUM 8573C"),
    (
        "linux-8370c",
        "Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz",
    ),
];

pub const BOXD: &str = "linux-boxd";

/// The machine facts R16 records; a field the host did not give is `None`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Machine {
    pub distro_id: Option<String>,
    pub version_id: Option<String>,
    pub arch: Option<String>,
    pub cpu_model: Option<String>,
    pub online_cpus: Option<String>,
    pub available_cpus: Option<usize>,
    pub affinity: Option<String>,
    pub kernel: Option<String>,
    pub shell: Option<String>,
}

/// The class a run selected and the provenance of its baseline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Class {
    pub key: String,
    pub provenance: String,
    pub machine: Machine,
}

/// `classes.json`: class key to the provenance of its baseline. A class absent here, or with an empty provenance, has no measured baseline.
pub type Provenance = BTreeMap<String, String>;

pub fn read_provenance(path: &Path) -> Result<Provenance, Box<dyn std::error::Error>> {
    serde_json::from_slice(
        &std::fs::read(path).map_err(|err| format!("{}: {err}", path.display()))?,
    )
    .map_err(|err| format!("{}: {err}", path.display()).into())
}

fn os_release_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        line.strip_prefix(key)?
            .strip_prefix('=')
            .map(|value| value.trim().trim_matches('"').to_string())
    })
}

fn labelled(text: &str, label: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (head, value) = line.split_once(':')?;

        (head.trim() == label).then(|| value.trim().to_string())
    })
}

/// Parses the outputs of `/etc/os-release`, `LC_ALL=C lscpu`, `/sys/devices/system/cpu/online` and `/proc/self/status`.
pub fn parse(
    os_release: &str,
    lscpu: &str,
    online: &str,
    status: &str,
    available_cpus: usize,
) -> Machine {
    Machine {
        distro_id: os_release_value(os_release, "ID"),
        version_id: os_release_value(os_release, "VERSION_ID"),
        arch: labelled(lscpu, "Architecture"),
        cpu_model: labelled(lscpu, "Model name"),
        online_cpus: Some(online.trim().to_string()).filter(|text| !text.is_empty()),
        available_cpus: Some(available_cpus),
        affinity: labelled(status, "Cpus_allowed_list"),
        kernel: None,
        shell: None,
    }
}

/// Reads this host (Linux only); a source that cannot be read leaves its fields absent, which `classify` rejects.
pub fn read() -> Machine {
    let file = |path: &str| std::fs::read_to_string(path).unwrap_or_default();
    let lscpu = std::process::Command::new("lscpu")
        .env("LC_ALL", "C")
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default();
    let cpus = std::thread::available_parallelism().map_or(0, |n| n.get());
    let mut machine = parse(
        &file("/etc/os-release"),
        &lscpu,
        &file("/sys/devices/system/cpu/online"),
        &file("/proc/self/status"),
        cpus,
    );

    machine.kernel =
        Some(file("/proc/sys/kernel/osrelease").trim().to_string()).filter(|k| !k.is_empty());
    machine.shell = std::env::var("SHELL").ok();
    machine
}

fn require<'a>(field: &'a Option<String>, name: &str) -> Result<&'a str, String> {
    field
        .as_deref()
        .ok_or_else(|| format!("machine class: {name} is missing"))
}

fn builder_key(machine: &Machine) -> Result<Option<&'static str>, String> {
    let model = require(&machine.cpu_model, "cpu model")?;

    Ok(BUILDERS
        .iter()
        .find_map(|(key, exact)| (*exact == model).then_some(*key)))
}

/// Which class the machine is: a Builder by exact identity, or the boxd VM by its two CPUs. Anything else is an error naming the mismatch.
pub fn classify(machine: &Machine) -> Result<&'static str, String> {
    let distro = require(&machine.distro_id, "ID in /etc/os-release")?;
    let version = require(&machine.version_id, "VERSION_ID in /etc/os-release")?;
    let arch = require(&machine.arch, "architecture")?;
    let model = require(&machine.cpu_model, "cpu model")?;
    let online = require(&machine.online_cpus, "online cpu set")?;
    let affinity = require(&machine.affinity, "Cpus_allowed_list")?;
    let available = machine
        .available_cpus
        .filter(|&n| n > 0)
        .ok_or("machine class: available cpu count is missing")?;

    if distro != "ubuntu" || arch != "x86_64" {
        return Err(format!(
            "machine class: unsupported host {distro} {version} {arch}"
        ));
    }

    if online == "0-3" && available == 4 && affinity == "0-3" && version == "24.04" {
        return builder_key(machine)?.ok_or_else(|| {
            format!("machine class: cpu model {model:?} is not a supported Builder model")
        });
    }

    if online == "0-1" && available == 2 && affinity == "0-1" && model.starts_with("AMD EPYC") {
        return Ok(BOXD);
    }

    Err(format!(
        "machine class: {distro} {version} {arch} {model:?} with online cpus {online}, {available} available, affinity {affinity} matches no measured class"
    ))
}

/// Selects the class for `machine` and checks its baseline is measured: a provenance, and a `baseline` entry under its key for every Linux metric in `has_baseline`.
pub fn select(
    machine: &Machine,
    provenance: &Provenance,
    has_baseline: impl Fn(&str, &str) -> bool,
) -> Result<Class, String> {
    let key = classify(machine)?;
    let source = provenance
        .get(key)
        .filter(|text| !text.trim().is_empty())
        .ok_or_else(|| format!("machine class {key}: baseline provenance is missing"))?;

    if let Some(metric) = LINUX_METRICS
        .iter()
        .find(|metric| !has_baseline(metric, key))
    {
        return Err(format!(
            "machine class {key}: no measured baseline for {metric}"
        ));
    }

    Ok(Class {
        key: key.to_string(),
        provenance: source.clone(),
        machine: machine.clone(),
    })
}
