use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use perf::gate::{conclude, read_budgets};
use perf::measure::one_run;
mod paired_host;
use sysinfo::System;

/// Measure the Daemon against rule 7 and fail when a metric misses `budgets.json`.
#[derive(Parser)]
struct Args {
    /// Run only X14’s isolated flood observation (exit 1 until output is isolated).
    #[arg(long)]
    flood: bool,
    /// Flood collection deadline in seconds; cleanup has a separate ten-second bound.
    #[arg(long, default_value_t = 60)]
    flood_timeout: u64,
    /// Fresh Daemons to measure; each metric is the median over them.
    #[arg(long, default_value_t = 11)]
    runs: usize,
    /// Alternating base/head invocations on an uncalibrated Builder.
    #[arg(long, default_value_t = 1)]
    pairs: usize,
    /// Calls per latency measurement.
    #[arg(long, default_value_t = 1000)]
    calls: usize,
    #[arg(long, default_value = "target/release/rupd", value_parser = absolute)]
    rupd: PathBuf,
    /// The built `rup`, run as Claude Code's hook command (H15's `hook_loop_ms`).
    #[arg(long, default_value = "target/release/rup", value_parser = absolute)]
    rup: PathBuf,
    #[arg(long, default_value = "crates/perf/budgets.json")]
    budgets: PathBuf,
    #[arg(long, default_value = "target/perf.json")]
    out: PathBuf,
}

/// The launcher takes only an absolute `rup` (R14), so a relative path is joined to the current directory.
fn absolute(path: &str) -> std::io::Result<PathBuf> {
    std::path::absolute(path)
}

async fn sample(
    runs: usize,
    calls: usize,
    rupd: &std::path::Path,
    rup: &std::path::Path,
    out: &std::path::Path,
) -> Result<perf::budget::Report, perf::paired::Error> {
    let cpus = std::thread::available_parallelism()?.get();
    let mut loads = Vec::new();
    let mut per_run: BTreeMap<String, Vec<f64>> = BTreeMap::new();

    for turn in 1..=runs {
        let load = System::load_average().one;

        let log = out.with_extension(format!("startup-{turn}.log"));
        if let Some(parent) = log.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Open before the cold-start timer; a direct file descriptor needs no collector
        // task or pipe drain and survives an observer error before perf.json is written.
        let stderr = std::fs::File::create(&log)?;
        eprintln!(
            "run {turn}/{}: load {load:.1} on {cpus} cpus; Daemon log {}",
            runs,
            log.display()
        );
        loads.push(load);

        for (name, value) in one_run(rupd, rup, calls, stderr.into()).await? {
            per_run.entry(name).or_default().push(value);
        }
    }

    if loads.is_empty() {
        return Err("no load figures recorded".into());
    }
    Ok(perf::budget::Report {
        os: std::env::consts::OS.into(),
        class: None,
        cpus,
        runs: loads.len(),
        loads,
        metrics: per_run
            .iter()
            .map(|(name, values)| (name.clone(), perf::budget::median(values)))
            .collect(),
        per_run,
        skipped: Vec::new(),
    })
}

async fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    if args.flood {
        let report = perf::flood::observe(std::time::Duration::from_secs(args.flood_timeout)).await;
        if let Some(dir) = args.out.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let evidence = serde_json::json!({"flood": report, "passed": report.passed(), "load": System::load_average().one});
        std::fs::write(&args.out, serde_json::to_vec_pretty(&evidence)?)?;
        println!("{}", serde_json::to_string_pretty(&evidence)?);
        if let Some(error) = report.error {
            return Err(error.into());
        }
        return Ok(report.passed());
    }
    let budgets = read_budgets(&args.budgets)?;
    if args.runs == 0 {
        return Err("no load figures recorded".into());
    }
    // Keep R10's missing binary error before machine selection.
    if !args.rupd.is_file() {
        return Err(format!("rupd not found at {}", args.rupd.display()).into());
    }
    let default_rupd = absolute("target/release/rupd")?;
    if cfg!(target_os = "linux") && args.rupd == default_rupd {
        let classes = args.budgets.with_file_name("classes.json");
        let provenance = if classes.try_exists()? {
            perf::machine::read_provenance(&classes)?
        } else {
            perf::machine::Provenance::new()
        };
        let selection = perf::machine::comparison(&perf::machine::read(), &provenance, &budgets)?;
        if matches!(selection, perf::machine::Comparison::Paired(_)) {
            if let Some(parent) = args.out.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut host = paired_host::Host {
                args,
                root: std::env::current_dir()?,
                owned: tempfile::tempdir()?,
                checkouts: Vec::new(),
                commands: Vec::new(),
                observer: None,
            };
            let result = perf::paired::collect(selection, &budgets, args.pairs, &mut host).await;
            match result {
                Ok(Some(pair)) => {
                    #[derive(serde::Serialize)]
                    struct Evidence<'a> {
                        #[serde(flatten)]
                        pair: &'a perf::paired::Pair,
                        observer: &'a Option<paired_host::Observer>,
                        commands: &'a [String],
                        calls: usize,
                        runs_per_invocation: usize,
                        exit: u8,
                    }
                    let evidence = Evidence {
                        pair: &pair,
                        observer: &host.observer,
                        commands: &host.commands,
                        calls: args.calls,
                        runs_per_invocation: args.runs,
                        exit: u8::from(!pair.passed),
                    };
                    std::fs::write(&args.out, serde_json::to_vec_pretty(&evidence)?)?;
                    println!(
                        "class {:?} observer {} commands {:?}",
                        pair.class,
                        serde_json::to_string(&host.observer)?,
                        host.commands
                    );
                    for build in &pair.builds {
                        println!("{} hashes {}", build.reference, build.hashes);
                    }
                    for line in perf::paired::render(&pair) {
                        println!("{line}");
                    }
                    return Ok(pair.passed);
                }
                Err(error) => {
                    std::fs::write(
                        &args.out,
                        serde_json::to_vec_pretty(
                            &serde_json::json!({"mode": "paired", "exit": 2, "error": error.to_string(), "commands": host.commands}),
                        )?,
                    )?;
                    return Err(error);
                }
                Ok(None) => unreachable!("paired selection"),
            }
        }
    }
    let measured = sample(args.runs, args.calls, &args.rupd, &args.rup, &args.out).await?;
    let per_run = measured.per_run;
    let loads = measured.loads;

    let class = if cfg!(target_os = "linux") {
        // R16: each class's baseline provenance sits beside the budgets.
        let provenance =
            perf::machine::read_provenance(&args.budgets.with_file_name("classes.json"))?;

        Some(perf::machine::select(
            &perf::machine::read(),
            &provenance,
            |metric, key| {
                budgets
                    .get(metric)
                    .is_some_and(|budget| budget.baseline.contains_key(key))
            },
        )?)
    } else {
        None
    };
    conclude(per_run, loads, &budgets, class, &args.out)
}

#[tokio::main]
async fn main() -> ExitCode {
    match run(&Args::parse()).await {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::FAILURE,
        Err(err) => {
            eprintln!("perf: {err}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn r14_the_default_rupd_and_rup_paths_are_absolute_and_name_the_same_files() {
        let args = Args::parse_from(["perf"]);
        let cwd = std::env::current_dir().unwrap();

        assert!(args.rupd.is_absolute(), "{}", args.rupd.display());
        assert!(args.rup.is_absolute(), "{}", args.rup.display());
        assert_eq!(args.rupd, cwd.join("target/release/rupd"));
        assert_eq!(args.rup, cwd.join("target/release/rup"));
    }

    #[test]
    fn r14_a_relative_flag_becomes_absolute_under_the_current_directory() {
        let args = Args::parse_from(["perf", "--rup", "bin/rup", "--rupd", "/opt/rupd"]);

        assert_eq!(args.rup, std::env::current_dir().unwrap().join("bin/rup"));
        assert_eq!(args.rupd, PathBuf::from("/opt/rupd"));
    }
}
