//! R24: recorded evidence is separate from native acquisition.
mod journal;
mod samples;
pub use journal::{Journal, View};
pub use samples::{Interval, TopSamples, parse_footprint, parse_top};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub fn guard(allow: Option<&str>, host: &str) -> Result<(), String> {
    if allow != Some("1") {
        return Err("perf-idle opens a native window and requires focus/hide interaction for six phases; ROUNDUP_ALLOW_WINDOW=1 is required before build or launch".into());
    }
    if host != "macos" {
        return Err(format!(
            "perf-idle unsupported host: {host}; macos required"
        ));
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    Focused,
    Unfocused,
    Hidden,
}
pub const STATES: [State; 3] = [State::Focused, State::Unfocused, State::Hidden];

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Member {
    pub pid: u32,
    pub started: u64,
    pub parent: Option<u32>,
    pub name: String,
    pub role: String,
    /// Platform responsibility lookup, not a parent guess. None is unknown.
    pub responsible: Option<u32>,
}

fn role(name: &str) -> Option<&'static str> {
    ["WebContent", "GPU", "Networking"]
        .into_iter()
        .find(|r| name.starts_with(&format!("com.apple.WebKit.{r}")))
}

/// A complete inventory includes unrelated WebKit helpers with resolved ownership.
pub fn membership(inventory: &[Member], app: u32, daemon: u32) -> Result<Vec<Member>, String> {
    let mut seen = BTreeSet::new();
    let mut included = Vec::new();
    for p in inventory {
        if !seen.insert(p.pid) || p.started == 0 {
            return Err(format!("PID {} duplicate or missing start identity", p.pid));
        }
        if p.pid == app || p.pid == daemon {
            let mut member = p.clone();
            member.role = if p.pid == app { "App" } else { "Daemon" }.into();
            included.push(member);
        } else if role(&p.name).is_some() {
            let owner = p
                .responsible
                .ok_or_else(|| format!("PID {} unresolved WebKit ownership", p.pid))?;
            if owner == app || p.parent == Some(app) {
                let mut member = p.clone();
                member.role = role(&p.name).expect("classified helper").into();
                included.push(member);
            }
        } else if p.name.starts_with("com.apple.WebKit.")
            && (p.responsible == Some(app) || p.parent == Some(app))
        {
            return Err(format!(
                "PID {} unidentifiable WebKit role {}",
                p.pid, p.name
            ));
        }
    }
    if !included.iter().any(|p| p.pid == app) || !included.iter().any(|p| p.pid == daemon) {
        return Err("missing App or Daemon PID".into());
    }
    if !included.iter().any(|p| role(&p.name) == Some("WebContent")) {
        return Err("missing associated WebContent".into());
    }
    included.sort_by_key(|p| p.pid);
    Ok(included)
}

pub fn same_members(before: &[Member], after: &[Member]) -> Result<(), String> {
    let ids = |ps: &[Member]| {
        ps.iter()
            .map(|p| (p.pid, p.started))
            .collect::<BTreeSet<_>>()
    };
    if ids(before) != ids(after) {
        return Err("PID loss/reuse or changed associated process set".into());
    }
    Ok(())
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    pub hashes: BTreeMap<String, String>,
    pub release: String,
    pub renderer: String,
    pub terminal: String,
    pub project: String,
    pub width: u64,
    pub height: u64,
    pub scale: f64,
    pub physical_width: u64,
    pub physical_height: u64,
    pub display_power: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Phase {
    pub count: usize,
    pub state: State,
    pub settings: Settings,
    pub members: Vec<Member>,
    pub absent_roles: Vec<String>,
    pub settle_s: f64,
    pub intervals: Vec<Interval>,
    pub footprint_bytes: BTreeMap<u32, u64>,
    pub errors: Vec<String>,
    pub raw: String,
}
#[derive(Debug, Serialize)]
pub struct Finding {
    pub exit: u8,
    pub phase: String,
    pub result: String,
}
#[derive(Debug, Serialize)]
pub struct Values {
    pub phase: String,
    pub cpu_one_core_percent: f64,
    pub wakeups_per_second: BTreeMap<u32, f64>,
    pub footprint_bytes: u64,
    pub footprint_decimal_mb: f64,
}
#[derive(Debug, Serialize)]
pub struct Pair {
    pub state: State,
    pub ten_bytes: u64,
    pub one_bytes: u64,
    pub extra_bytes_per_agent: f64,
}
#[derive(Debug, Serialize)]
pub struct Report {
    pub exit: u8,
    pub native_validation: &'static str,
    pub memory_status: &'static str,
    pub limits: BTreeMap<&'static str, f64>,
    pub provenance: BTreeMap<String, String>,
    pub phases: Vec<Phase>,
    pub values: Vec<Values>,
    pub pairs: Vec<Pair>,
    pub findings: Vec<Finding>,
}

pub fn conclude(
    phases: Vec<Phase>,
    provenance: BTreeMap<String, String>,
    errors: Vec<String>,
) -> Report {
    let mut report = Report {
        exit: 0,
        native_validation: "pending Activity Monitor agreement and focused cursor attribution",
        memory_status: "provisional; initial real calibration pending",
        limits: BTreeMap::from([
            ("tree_cpu_percent_strict", 0.5),
            ("pid_wakeups_per_second_inclusive", 1.0),
            ("ten_tree_decimal_mb_strict", 300.0),
            ("extra_agent_decimal_mb_strict", 10.0),
        ]),
        provenance,
        phases,
        values: vec![],
        pairs: vec![],
        findings: vec![],
    };
    for error in errors {
        report.find(2, "round", error);
    }
    for key in [
        "commit",
        "hardware",
        "macos",
        "display_power",
        "tools",
        "commands",
        "release",
        "evidence",
        "clock_correlation",
    ] {
        if report
            .provenance
            .get(key)
            .is_none_or(|v| v.trim().is_empty())
        {
            report.find(2, "round", format!("missing provenance {key}"));
        }
    }
    let expected: Vec<_> = [10, 1]
        .into_iter()
        .flat_map(|n| STATES.map(|s| (n, s)))
        .collect();
    if report
        .phases
        .iter()
        .map(|p| (p.count, p.state))
        .collect::<Vec<_>>()
        != expected
    {
        report.find(2, "round", "incomplete or reordered six-phase protocol");
    }
    for p in report.phases.clone() {
        let label = format!("{} {:?}", p.count, p.state);
        for error in &p.errors {
            report.find(2, &label, error.clone());
        }
        if !p.settle_s.is_finite() || p.settle_s < 5.0 {
            report.find(2, &label, "settle below 5 seconds");
        }
        if p.raw.is_empty()
            || p.settings.hashes.len() < 3
            || p.settings.hashes.values().any(String::is_empty)
            || p.settings.release.is_empty()
            || p.settings.terminal.is_empty()
            || p.settings.project.is_empty()
            || !["webgl", "dom"].contains(&p.settings.renderer.as_str())
            || p.settings.width == 0
            || p.settings.physical_width == 0
            || p.settings.physical_height == 0
            || p.settings.height == 0
            || !p.settings.scale.is_finite()
            || p.settings.scale <= 0.0
            || p.settings.display_power.is_empty()
        {
            report.find(2, &label, "missing phase provenance/settings/raw evidence");
        }
        match samples::summarize(&p.members, &p.intervals, &p.footprint_bytes) {
            Err(e) => report.find(2, &label, e),
            Ok((cpu, wakes, bytes)) => {
                if p.state != State::Focused {
                    if cpu >= 0.5 {
                        report.find(1, &label, format!("tree CPU {cpu}% >= 0.5% of one core"));
                    }
                    for (pid, rate) in &wakes {
                        if *rate > 1.0 {
                            report.find(
                                1,
                                &label,
                                format!("PID {pid}: {rate} idle wake-ups/s > 1"),
                            );
                        }
                    }
                }
                report.values.push(Values {
                    phase: label,
                    cpu_one_core_percent: cpu,
                    wakeups_per_second: wakes,
                    footprint_bytes: bytes,
                    footprint_decimal_mb: bytes as f64 / 1_000_000.0,
                });
            }
        }
    }
    for state in STATES {
        let ten = report
            .phases
            .iter()
            .find(|p| p.count == 10 && p.state == state);
        let one = report
            .phases
            .iter()
            .find(|p| p.count == 1 && p.state == state);
        if let (Some(ten), Some(one)) = (ten, one) {
            if ten.settings != one.settings {
                report.find(
                    2,
                    "pair",
                    format!("{state:?}: mismatched binaries/settings/Terminal"),
                );
                continue;
            }
            if !ten.errors.is_empty() || !one.errors.is_empty() {
                continue;
            }
            let sums = |p: &Phase| {
                samples::summarize(&p.members, &p.intervals, &p.footprint_bytes).map(|v| v.2)
            };
            if let (Ok(t), Ok(o)) = (sums(ten), sums(one)) {
                let extra = (t as f64 - o as f64) / 9.0;
                if t >= 300_000_000 || extra >= 10_000_000.0 {
                    report.find(1, "pair", format!("{state:?}: ten {t} bytes, one {o} bytes, extra {extra} bytes/Agent; provisional aims <300000000 and <10000000"));
                }
                report.pairs.push(Pair {
                    state,
                    ten_bytes: t,
                    one_bytes: o,
                    extra_bytes_per_agent: extra,
                });
            }
        } else {
            report.find(2, "pair", format!("{state:?}: missing matching states"));
        }
    }
    report
}
impl Report {
    fn find(&mut self, exit: u8, phase: &str, result: impl Into<String>) {
        self.exit = self.exit.max(exit);
        self.findings.push(Finding {
            exit,
            phase: phase.into(),
            result: result.into(),
        });
    }
}

/// Initial/final authoritative snapshots plus every streamed Status transition.
pub fn activity(
    count: usize,
    statuses: &[contracts::common::Kind],
    cursors: &[(u64, u64)],
    transitions: &[contracts::common::Kind],
) -> Result<(), String> {
    if statuses.len() != count * 2
        || cursors.len() != count
        || statuses
            .iter()
            .chain(transitions)
            .any(|k| *k != contracts::common::Kind::Idle)
    {
        return Err("non-idle Agent or incomplete authoritative Status observations".into());
    }
    if cursors.iter().any(|(a, b)| a != b) {
        return Err("Terminal output during phase".into());
    }
    Ok(())
}
