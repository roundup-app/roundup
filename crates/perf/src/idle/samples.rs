use super::Member;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Only the auxiliary ledger is accepted; never a derived total or peak.
pub fn parse_footprint(raw: &str) -> Result<u64, String> {
    let rows: Vec<_> = raw
        .lines()
        .filter_map(|line| {
            line.trim()
                .strip_prefix("phys_footprint:")
                .or_else(|| line.trim().strip_prefix("phys_footprint "))
        })
        .collect();
    if rows.len() != 1 {
        return Err("missing/duplicate phys_footprint ledger".into());
    }
    let words: Vec<_> = rows[0].split_whitespace().collect();
    if words.len() == 1 {
        return words[0]
            .parse::<u64>()
            .map_err(|_| "invalid forced-byte phys_footprint ledger".into());
    }
    if words.len() != 2 {
        return Err("unsupported phys_footprint value/unit".into());
    }
    let value: f64 = words[0]
        .parse()
        .map_err(|_| "invalid phys_footprint number")?;
    // footprint's formatted K/M/G suffixes are binary; -f bytes avoids rounding on native runs.
    let factor = match words[1] {
        "B" | "bytes" => 1.0,
        "K" | "KB" | "KiB" => 1024.0,
        "M" | "MB" | "MiB" => 1_048_576.0,
        "G" | "GB" | "GiB" => 1_073_741_824.0,
        _ => return Err("unsupported footprint unit".into()),
    };
    let bytes = value * factor;
    if !bytes.is_finite() || bytes < 0.0 || bytes >= u64::MAX as f64 || bytes.fract() != 0.0 {
        return Err("invalid phys_footprint bytes".into());
    }
    Ok(bytes as u64)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Interval {
    pub start_s: f64,
    pub end_s: f64,
    pub cpu: BTreeMap<u32, f64>,
    pub idlew: BTreeMap<u32, u64>,
}

/// Parse one logging-mode sample, selected columns only, with PID decorations refused.
type Counters = (BTreeMap<u32, f64>, BTreeMap<u32, u64>);
pub fn parse_top(raw: &str) -> Result<Counters, String> {
    let mut cpu = BTreeMap::new();
    let mut wakes = BTreeMap::new();
    let mut header = false;
    for line in raw.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.first() == Some(&"PID") {
            if header || fields != ["PID", "COMMAND", "%CPU", "IDLEW"] {
                return Err("unsupported top header/accounting".into());
            }
            header = true;
        } else if header && !fields.is_empty() {
            if fields.len() < 4 {
                return Err("incomplete top row".into());
            }
            let pid: u32 = fields[0].parse().map_err(|_| "invalid top PID")?;
            let c: f64 = fields[fields.len() - 2]
                .parse()
                .map_err(|_| "invalid top CPU")?;
            let w: u64 = fields[fields.len() - 1]
                .parse()
                .map_err(|_| "invalid top IDLEW interval count")?;
            if !c.is_finite() || c < 0.0 || cpu.insert(pid, c).is_some() {
                return Err(format!("PID {pid}: invalid/duplicate top CPU"));
            }
            wakes.insert(pid, w);
        }
    }
    if !header || cpu.is_empty() {
        return Err("missing top sample/metrics".into());
    }
    Ok((cpu, wakes))
}

pub(super) fn summarize(
    members: &[Member],
    intervals: &[Interval],
    memory: &BTreeMap<u32, u64>,
) -> Result<(f64, BTreeMap<u32, f64>, u64), String> {
    let ids: BTreeSet<_> = members.iter().map(|p| p.pid).collect();
    if ids.is_empty()
        || ids.len() != members.len()
        || memory.keys().copied().collect::<BTreeSet<_>>() != ids
    {
        return Err("missing/duplicate PID footprint".into());
    }
    let mut elapsed = 0.0;
    let mut cpu = 0.0;
    let mut wakes = BTreeMap::<u32, f64>::new();
    for interval in intervals {
        if !interval.start_s.is_finite()
            || !interval.end_s.is_finite()
            || interval.start_s != elapsed
            || interval.end_s <= interval.start_s
            || interval.end_s - interval.start_s > 2.5
        {
            return Err("top sample gap, non-finite time or invalid interval".into());
        }
        if interval.cpu.keys().copied().collect::<BTreeSet<_>>() != ids
            || interval.idlew.keys().copied().collect::<BTreeSet<_>>() != ids
        {
            return Err("top sample missing PID/metric".into());
        }
        let dt = interval.end_s - interval.start_s;
        for pid in &ids {
            let c = interval.cpu[pid];
            if !c.is_finite() || c < 0.0 {
                return Err(format!("PID {pid}: invalid CPU"));
            }
            cpu += c * dt;
            *wakes.entry(*pid).or_default() += interval.idlew[pid] as f64;
        }
        elapsed = interval.end_s;
    }
    if elapsed < 60.0 {
        return Err(
            "incomplete CPU/wake duration (requires 60 seconds after discarded initial sample)"
                .into(),
        );
    }
    for rate in wakes.values_mut() {
        *rate /= elapsed;
    }
    let bytes = memory
        .values()
        .try_fold(0_u64, |n, v| n.checked_add(*v))
        .ok_or("footprint sum overflow")?;
    Ok((cpu / elapsed, wakes, bytes))
}

/// Logging-mode blocks are delimited by the next Processes header. The first
/// block has invalid since-launch counters and is never parsed as an interval.
#[derive(Default)]
pub struct TopSamples {
    block: String,
    current: Option<f64>,
    previous: Option<f64>,
    origin: Option<f64>,
    intervals: Vec<Interval>,
}
impl TopSamples {
    pub fn push(&mut self, at_s: f64, line: &str) -> Result<bool, String> {
        if !at_s.is_finite() || at_s < 0.0 {
            return Err("invalid top receipt time".into());
        }
        if line.starts_with("Processes:") {
            if let Some(current) = self.current {
                if at_s <= current {
                    return Err("top receipt time did not advance".into());
                }
                if let Some(previous) = self.previous {
                    let (cpu, idlew) = parse_top(&self.block)?;
                    let origin = *self.origin.get_or_insert(previous);
                    self.intervals.push(Interval {
                        start_s: previous - origin,
                        end_s: current - origin,
                        cpu,
                        idlew,
                    });
                    if current - origin >= 60.0 {
                        return Ok(true);
                    }
                }
                self.previous = Some(current);
            }
            self.current = Some(at_s);
            self.block.clear();
        }
        self.block.push_str(line);
        self.block.push('\n');
        Ok(false)
    }
    pub fn finish(self) -> Result<Vec<Interval>, String> {
        if self.intervals.last().is_none_or(|i| i.end_s < 60.0) {
            return Err("incomplete top sample duration".into());
        }
        Ok(self.intervals)
    }
}
