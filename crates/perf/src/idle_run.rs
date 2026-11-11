//! R24 native acquisition. Linux never authorizes or opens this window.
use clap::Parser;
use perf::{
    app::{self, Workload},
    idle::{self, Phase, STATES, Settings},
};
use std::{collections::BTreeMap, path::PathBuf, process::ExitCode};
mod idle_native;

#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "target/perf-idle-app/release/roundup")]
    app: PathBuf,
    /// Required JSON object: display model/refresh/scale, power source, Low Power Mode,
    /// renderer/cursor setup, tool accounting verification, and release settings.
    #[arg(long, default_value = "target/perf-idle-host.json")]
    host: PathBuf,
    #[arg(long, default_value = "target/perf-idle.json")]
    out: PathBuf,
}
#[tokio::main]
async fn main() -> ExitCode {
    // No parsing of files, builds, commands or window interaction before these guards.
    if let Err(e) = idle::guard(
        std::env::var("ROUNDUP_ALLOW_WINDOW").ok().as_deref(),
        std::env::consts::OS,
    ) {
        eprintln!("{e}");
        return ExitCode::from(2);
    }
    match run(Args::parse()).await {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("perf-idle: {e}");
            ExitCode::from(2)
        }
    }
}
async fn run(args: Args) -> std::io::Result<u8> {
    let root = args.out.with_extension("evidence");
    // Exclusive directory prevents overwriting earlier failures/repeats.
    if let Some(parent) = root.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::create_dir(&root)?;
    let empty = Settings {
        hashes: BTreeMap::new(),
        release: String::new(),
        renderer: String::new(),
        terminal: String::new(),
        project: String::new(),
        width: 0,
        height: 0,
        scale: 0.0,
        physical_width: 0,
        physical_height: 0,
        display_power: String::new(),
    };
    let mut phases: Vec<_> = [10, 1]
        .into_iter()
        .flat_map(|count| {
            STATES.map(|state| Phase {
                count,
                state,
                settings: empty.clone(),
                members: vec![],
                absent_roles: vec![],
                settle_s: 0.0,
                intervals: vec![],
                footprint_bytes: BTreeMap::new(),
                errors: vec!["phase not collected".into()],
                raw: root.display().to_string(),
            })
        })
        .collect();
    let mut native = idle_native::Native::new(&root)?;
    let mut errors = Vec::new();
    let preparation = native.prepare(&args.app, &args.host).await;
    match preparation {
        Err(e) => errors.push(e.to_string()),
        Ok(()) => {
            native.start();
            let collected = app::run(
                &args.app,
                Workload::Idle,
                Some(&root),
                async |socket, pid, project| {
                    native.collect(socket, pid, project, &mut phases).await
                },
            )
            .await;
            if let Err(e) = collected {
                errors.push(e.to_string());
            }
        }
    }
    let report = idle::conclude(phases, native.provenance, errors);
    let raw = serde_json::to_vec_pretty(&report)?;
    std::fs::write(&args.out, &raw)?;
    println!("{}", String::from_utf8_lossy(&raw));
    Ok(report.exit)
}
