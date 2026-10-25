use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::Parser;
use perf::gate::{conclude, read_budgets};
use perf::measure::one_run;
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

// Build orchestration delegates all Daemon launches to sample and its owned one_run launcher.
mod paired_host {
    use perf::budget::Report;
    use perf::paired::{Build, Environment, Error, Identity};
    use std::path::{Path, PathBuf};
    use std::time::Duration;
    use tokio::process::Command;

    #[derive(serde::Serialize)]
    pub struct Observer {
        pub hash: String,
        pub rustc: String,
        pub toolchain: String,
        pub manifest: String,
        pub settings: String,
        pub rustflags: Option<String>,
        pub encoded_rustflags: Option<String>,
    }

    pub struct Host<'a> {
        pub args: &'a super::Args,
        pub root: PathBuf,
        pub owned: tempfile::TempDir,
        pub checkouts: Vec<PathBuf>,
        pub commands: Vec<String>,
        pub observer: Option<Observer>,
    }

    impl Host<'_> {
        async fn command(
            &mut self,
            cwd: &Path,
            program: &str,
            args: &[&str],
        ) -> Result<String, Error> {
            let command = format!("{}: {program} {args:?}", cwd.display());
            self.commands.push(command.clone());
            let log = self.args.out.with_extension("commands.json");
            std::fs::write(log, serde_json::to_vec_pretty(&self.commands)?)?;
            let mut process = Command::new(program);
            if let Some(observer) = &self.observer {
                process.env("RUSTUP_TOOLCHAIN", &observer.toolchain);
            }
            let output = tokio::time::timeout(
                Duration::from_secs(900),
                process
                    .args(args)
                    .current_dir(cwd)
                    .env_remove("CARGO_TARGET_DIR")
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .map_err(|_| format!("{command}: timed out"))??;
            let log = self
                .args
                .out
                .with_extension(format!("command-{}.log", self.commands.len()));
            let mut bytes = output.stdout.clone();
            bytes.extend_from_slice(&output.stderr);
            std::fs::write(log, bytes)?;
            if !output.status.success() {
                return Err(format!(
                    "{command}: {}: {}",
                    output.status,
                    String::from_utf8_lossy(&output.stderr)
                )
                .into());
            }
            Ok(String::from_utf8(output.stdout)?.trim().into())
        }
    }

    impl Environment for Host<'_> {
        async fn references(&mut self) -> Result<[String; 2], Error> {
            let root = self.root.clone();
            let head = self
                .command(&root, "git", &["rev-parse", "--verify", "HEAD^{commit}"])
                .await?;
            let base = self
                .command(&root, "git", &["merge-base", "origin/main", &head])
                .await?;
            // Metadata belongs to the actual common observer and toolchain, never either source tree's perf binary.
            let observer = std::env::current_exe()?;
            let hash = self
                .command(
                    &root,
                    "sha256sum",
                    &[observer.to_str().ok_or("observer path is not UTF-8")?],
                )
                .await?;
            let rustc = self.command(&root, "rustc", &["-Vv"]).await?;
            let toolchain = self
                .command(&root, "rustup", &["show", "active-toolchain"])
                .await?;
            let toolchain = toolchain
                .split_whitespace()
                .next()
                .ok_or("missing active release toolchain")?
                .to_string();
            self.observer = Some(Observer {
                hash,
                rustc,
                toolchain,
                manifest: std::fs::read_to_string(root.join("Cargo.toml"))?,
                settings: "cargo build --locked --release -p rupd -p rup".into(),
                rustflags: std::env::var("RUSTFLAGS").ok(),
                encoded_rustflags: std::env::var("CARGO_ENCODED_RUSTFLAGS").ok(),
            });
            std::fs::write(
                self.args.out.with_extension("observer.json"),
                serde_json::to_vec_pretty(&self.observer)?,
            )?;
            Ok([base, head])
        }

        fn identity(&mut self) -> Result<Identity, Error> {
            Ok(Identity {
                host: std::fs::read_to_string("/etc/hostname")?.trim().into(),
                boot: std::fs::read_to_string("/proc/sys/kernel/random/boot_id")?
                    .trim()
                    .into(),
                job: format!(
                    "{}/{}/{}",
                    std::env::var("GITHUB_RUN_ID").unwrap_or_else(|_| "local".into()),
                    std::env::var("GITHUB_RUN_ATTEMPT").unwrap_or_default(),
                    std::env::var("GITHUB_JOB").unwrap_or_else(|_| std::process::id().to_string())
                ),
            })
        }

        async fn build(&mut self, reference: &str, side: &str) -> Result<Build, Error> {
            let root = self.root.clone();
            let checkout = self.owned.path().join(side);
            let path = checkout.to_str().ok_or("checkout path is not UTF-8")?;
            // Register before attempting checkout so a partial failure is also cleaned up.
            self.checkouts.push(checkout.clone());
            self.command(
                &root,
                "git",
                &["worktree", "add", "--detach", path, reference],
            )
            .await?;
            self.command(
                &checkout,
                "pnpm",
                &["install", "--frozen-lockfile", "--ignore-scripts"],
            )
            .await?;
            self.command(
                &checkout,
                "cargo",
                &["build", "--locked", "--release", "-p", "rupd", "-p", "rup"],
            )
            .await?;
            self.command(
                &checkout,
                "bash",
                &["tools/sidecar/bundle.sh", "target/release/sidecar"],
            )
            .await?;
            let rupd = checkout.join("target/release/rupd");
            let rup = checkout.join("target/release/rup");
            let node = checkout.join("target/release/sidecar/node");
            let hashes = self
                .command(
                    &root,
                    "sha256sum",
                    &[
                        rupd.to_str().ok_or("rupd path")?,
                        rup.to_str().ok_or("rup path")?,
                        node.to_str().ok_or("node path")?,
                    ],
                )
                .await?;
            Ok(Build {
                reference: reference.into(),
                daemon: rupd,
                rup,
                hashes,
            })
        }

        async fn measure(&mut self, build: &Build, turn: usize) -> Result<Report, Error> {
            let side = build
                .daemon
                .parent()
                .and_then(|p| p.parent())
                .and_then(|p| p.parent())
                .and_then(|p| p.file_name())
                .ok_or("binary location")?;
            let out = self
                .args
                .out
                .with_extension(format!("{}-{turn}.json", side.to_string_lossy()));
            let mut report = super::sample(
                self.args.runs,
                self.args.calls,
                &build.daemon,
                &build.rup,
                &out,
            )
            .await?;
            report.class = None;
            std::fs::write(&out, serde_json::to_vec_pretty(&report)?)?;
            Ok(report)
        }
    }

    impl Drop for Host<'_> {
        fn drop(&mut self) {
            for checkout in &self.checkouts {
                let result = std::process::Command::new("git")
                    .current_dir(&self.root)
                    .args(["worktree", "remove", "--force"])
                    .arg(checkout)
                    .output();
                if let Err(error) = result {
                    eprintln!("owned checkout cleanup {}: {error}", checkout.display());
                }
            }
        }
    }

    #[cfg(all(test, target_os = "linux"))]
    mod tests {
        use super::*;
        use clap::Parser;

        #[tokio::test]
        async fn r16_references_resolve_the_git_merge_base_and_full_head() {
            let repo = tempfile::tempdir().unwrap();
            let git = |args: &[&str]| {
                let out = std::process::Command::new("git")
                    .current_dir(repo.path())
                    .args(args)
                    .output()
                    .unwrap();
                assert!(
                    out.status.success(),
                    "{}",
                    String::from_utf8_lossy(&out.stderr)
                );
                String::from_utf8(out.stdout).unwrap().trim().to_string()
            };
            git(&["init", "-q"]);
            std::fs::write(repo.path().join("Cargo.toml"), "[workspace]\n").unwrap();
            git(&[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.com",
                "commit",
                "--allow-empty",
                "-qm",
                "base",
            ]);
            let base = git(&["rev-parse", "HEAD"]);
            git(&["update-ref", "refs/remotes/origin/main", &base]);
            git(&[
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.com",
                "commit",
                "--allow-empty",
                "-qm",
                "head",
            ]);
            let head = git(&["rev-parse", "HEAD"]);
            let args = super::super::Args::parse_from([
                "perf",
                "--out",
                repo.path().join("perf.json").to_str().unwrap(),
            ]);
            let mut host = Host {
                args: &args,
                root: repo.path().into(),
                owned: tempfile::tempdir().unwrap(),
                checkouts: vec![],
                commands: vec![],
                observer: None,
            };
            assert_eq!(host.references().await.unwrap(), [base, head]);
            git(&["update-ref", "-d", "refs/remotes/origin/main"]);
            assert!(
                host.references()
                    .await
                    .unwrap_err()
                    .to_string()
                    .contains("merge-base")
            );
        }
    }
}
