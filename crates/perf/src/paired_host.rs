//! Process adapter for the paired gate. Only owned checkouts are registered or removed.
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
    async fn command(&mut self, cwd: &Path, program: &str, args: &[&str]) -> Result<String, Error> {
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
            rupd,
            rup,
            hashes,
        })
    }

    async fn measure(&mut self, build: &Build, turn: usize) -> Result<Report, Error> {
        let side = build
            .rupd
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
            &build.rupd,
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
