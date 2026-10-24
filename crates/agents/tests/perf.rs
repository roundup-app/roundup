//! R3696c: allocation work of the ordinary forty-Workstream Rail reply, without a clock.
use std::{alloc::System, sync::Arc};

use rpc::{Bus, Ctx, Module};
use serde_json::{Value, json};
use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};

#[global_allocator]
static ALLOCATOR: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;

#[tokio::test(flavor = "current_thread")]
async fn r3696c_forty_workstreams_avoid_temporary_node_copies() {
    let dir = tempfile::tempdir().unwrap();
    let bus = Bus::new();
    let terminals = Arc::new(terminal::Terminals::open(dir.path(), bus.clone()).unwrap());
    let agents = agents::Agents::open_with(
        dir.path(),
        bus.clone(),
        terminals,
        agents::claude_code::Launcher::new(
            "false",
            dir.path().join("config"),
            dir.path().join("rup"),
            None,
        ),
        agents::worktree::Git::from_env(),
    )
    .unwrap();
    let ctx = Ctx {
        actor: contracts::Actor::user(),
        bus,
        touches: Arc::new(provenance::Touches::in_memory().unwrap()),
    };
    for i in 0..40 {
        agents
            .call(
                &ctx,
                "rail.createWorkstream",
                json!({"name":format!("workstream-{i}")}),
            )
            .await
            .unwrap();
    }
    // Warm only SQLite's prepared statements; no cached Rail result is permitted.
    agents
        .call_reply(&ctx, "rail.tree", Value::Null)
        .await
        .unwrap();
    let region = Region::new(ALLOCATOR);
    let reply = agents
        .call_reply(&ctx, "rail.tree", Value::Null)
        .await
        .unwrap();
    let stats = region.change();
    eprintln!(
        "forty Workstreams: {} allocations, {} allocated bytes",
        stats.allocations, stats.bytes_allocated
    );
    assert!(
        stats.allocations <= 400,
        "forty Workstreams: {} allocations",
        stats.allocations
    );
    std::hint::black_box(reply);
}
