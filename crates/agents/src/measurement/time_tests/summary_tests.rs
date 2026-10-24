use super::*;

#[tokio::test]
async fn u3016c_time_categories_use_observed_intervals() {
    let w = World::new();
    let home = w.home();
    let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
    let point = |seconds: u64| json!({"unix_ms":1000+seconds*1000,"monotonic_ns":(seconds*1_000_000_000).to_string()});
    let observed = |activity: Value, start, end| json!({"kind":"observed","activity":activity,"clock_lifetime":"test","start":point(start),"segments":[{"start":point(start),"end":point(end)}],"state":{"kind":"ended","at":point(end)}});
    let mut facts = vec![
        ("a", observed(json!({"kind":"attempt"}), 0, 10)),
        ("b", observed(json!({"kind":"attempt"}), 0, 10)),
        (
            "a",
            observed(json!({"kind":"decision","decision":"question"}), 6, 8),
        ),
        (
            "a",
            observed(json!({"kind":"coordination","message":1}), 8, 9),
        ),
    ];
    for (agent, category, start, end) in [
        ("a", "agent", 0, 10),
        ("b", "agent", 0, 10),
        ("a", "tool", 2, 6),
        ("a", "tool", 3, 5),
    ] {
        facts.push((agent,json!({"kind":"interval","category":category,"clock":"source-wall","start_unix_ns":((start+1)*1_000_000_000_u64).to_string(),"end_unix_ns":((end+1)*1_000_000_000_u64).to_string()})));
    }
    for (i, (agent, value)) in facts.iter().enumerate() {
        db.execute("INSERT INTO measurement_revisions(identity,source_revision,source,agent,attempt,home,maker,observed,value,coverage) VALUES(?1,'1','fixture',?2,'1',?3,?2,11000,?4,'[]')",rusqlite::params![format!("time-{i}"),agent,home,value.to_string()]).unwrap();
    }
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["elapsed_ns"], "10000000000");
    assert_eq!(read["time"]["summed_ns"], "20000000000");
    assert_eq!(read["time"]["execution_ns"], "13000000000");
    assert_eq!(read["time"]["tools_ns"], "4000000000");
    assert_eq!(read["time"]["human_ns"], "2000000000");
    assert_eq!(read["time"]["coordination_ns"], "1000000000");
    assert_eq!(read["time"]["other_ns"], "0");
    assert_eq!(read["time"]["unmeasured_ns"], "0");
}

#[tokio::test]
async fn u3016c_elapsed_and_parallel_time_are_distinct() {
    let w = World::new();
    let home = w.home();
    let live = w.agent(Some(&home));
    w.fact(&home, "a", "first", &attempt(0, 10, false).to_string());
    w.fact(&home, "b", "parallel", &attempt(0, 10, false).to_string());
    w.fact(&home, &live, "resumed", &attempt(15, 20, true).to_string());
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["elapsed_ns"], "20000000000");
    assert_eq!(read["time"]["summed_ns"], "25000000000");
    assert_eq!(read["time"]["active"], true);
    assert_eq!(read["time"]["unmeasured_ns"], "25000000000");
}

#[tokio::test]
async fn u3016i_unknown_attempt_end_stops_the_clock_once_its_agent_stops() {
    let w = World::new();
    let home = w.home();
    let live = w.agent(Some(&home));
    w.fact(&home, &live, "open", &attempt(0, 10, true).to_string());
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["active"], true);
    w.signal(
        &live,
        json!({"hook_event_name":"SessionEnd","reason":"done"}),
    );
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["active"], false);
    assert!(read["time"]["coverage"].to_string().contains("end unknown"));
}

#[tokio::test]
async fn u3016c_clock_gaps_and_late_intervals_are_honest() {
    let w = World::new();
    let home = w.home();
    let mut a = attempt(0, 10, false);
    a["segments"] = json!([{"start":point(0),"end":point(2)},{"start":point(8),"end":point(10)}]);
    w.fact(&home, "a", "first", &a.to_string());
    let execution = json!({"kind":"interval","category":"agent","clock":"source wall","start_unix_ns":"1000000000","end_unix_ns":"11000000000"});
    w.fact(&home, "a", "execution", &execution.to_string());
    w.fact(&home, "a", "execution", &execution.to_string());
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["execution_ns"], "4000000000");
    assert_eq!(read["time"]["unmeasured_ns"], "6000000000");
    let (reopened, ctx) = w.reopen();
    let read = reopened
        .call(&ctx, "project.measurementSummary", json!({"home":home}))
        .await
        .unwrap();
    assert_eq!(read["time"]["execution_ns"], "4000000000");
    a["segments"][1]["end"]["unix_ms"] = json!(9000);
    w.fact(&home, "a", "first", &a.to_string());
    let read = w.summary(&home).await;
    assert_eq!(read["time"]["elapsed_ns"], Value::Null);
    assert_eq!(read["time"]["execution_ns"], "0");
    assert_eq!(read["time"]["summed_ns"], "10000000000");
}

#[tokio::test]
async fn u3016e_rank_and_totals_share_contributions() {
    let w = World::new();
    let home = w.home();
    let other = w.home();
    w.fact(&home, "a", "a-attempt", &attempt(0, 12, false).to_string());
    w.fact(&home, "a", "a-agent", &interval("agent", 0, 6));
    w.fact(&home, "a", "a-tool", &interval("tool", 6, 10));
    w.fact(&home, "b", "b-attempt", &attempt(0, 3, false).to_string());
    w.fact(&home, "b", "b-agent", &interval("agent", 0, 3));
    // An updated Attempt replaces the older contribution; another Home is excluded.
    w.fact(&home, "c", "c-attempt", &attempt(0, 1, false).to_string());
    w.fact(&home, "c", "c-attempt", &attempt(0, 20, false).to_string());
    w.fact(&other, "a", "later", &attempt(0, 99, false).to_string());
    let read = w.summary(&home).await;
    let order: Vec<_> = read["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["agent"].as_str().unwrap())
        .collect();
    assert_eq!(order, ["c", "a", "b"]);
    assert_eq!(read["contributors"], 3);
    for category in [
        "summed_ns",
        "execution_ns",
        "tools_ns",
        "unmeasured_ns",
        "human_ns",
    ] {
        let rows: u128 = read["rows"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                row["time"][category]
                    .as_str()
                    .unwrap()
                    .parse::<u128>()
                    .unwrap()
            })
            .sum();
        assert_eq!(read["time"][category], rows.to_string(), "{category}");
    }
    assert_eq!(read["rows"][1]["time"]["execution_ns"], "6000000000");
    assert_eq!(read["rows"][1]["time"]["tools_ns"], "4000000000");
}

#[tokio::test]
async fn u3016e_pages_keep_all_contributors_at_one_revision() {
    let w = World::new();
    let home = w.home();
    let expected: Vec<_> = (0..1005).map(|i| format!("former-{i:04}")).collect();
    for agent in &expected {
        w.fact(&home, agent, agent, &attempt(0, 3, false).to_string());
    }
    let measured = std::time::Instant::now();
    let mut page = w.summary(&home).await;
    assert_eq!(page["contributors"], 1005);
    assert_eq!(page["time"]["summed_ns"], "3015000000000");
    let revision = page["revision"].clone();
    let mut ids = Vec::new();
    loop {
        let rows = page["rows"].as_array().unwrap();
        assert!(rows.len() <= 20);
        ids.extend(
            rows.iter()
                .map(|row| row["agent"].as_str().unwrap().to_owned()),
        );
        if page["next_offset"].is_null() {
            break;
        }
        page = w
            .agents
            .call(
                &w.ctx,
                "project.measurementSummary",
                json!({"home":home,"offset":page["next_offset"],"revision":revision}),
            )
            .await
            .unwrap();
        assert_eq!(page["revision"], revision);
    }
    eprintln!(
        "U3016e: 1,005 contributors, 51 coherent public pages: {:?}",
        measured.elapsed()
    );
    assert_eq!(ids, expected);
    w.fact(&home, "new", "new", &attempt(0, 1, false).to_string());
    let stale = w
        .agents
        .call(
            &w.ctx,
            "project.measurementSummary",
            json!({"home":home,"offset":20,"revision":revision}),
        )
        .await
        .unwrap_err();
    assert_eq!(stale.code, rpc::code::CONFLICT);
}

#[tokio::test]
async fn u3016e_unbound_pages_and_missing_workstreams_are_refused() {
    let w = World::new();
    let home = w.home();
    for params in [
        json!({"home":home,"offset":20}),
        json!({"home":home,"offset":1,"revision":"0"}),
        json!({"home":home,"category":"total"}),
    ] {
        assert_eq!(
            w.agents
                .call(&w.ctx, "project.measurementSummary", params)
                .await
                .unwrap_err()
                .code,
            rpc::code::INVALID_PARAMS
        );
    }
    assert_eq!(
        w.agents
            .call(
                &w.ctx,
                "project.measurementSummary",
                json!({"home":"missing"})
            )
            .await
            .unwrap_err()
            .code,
        rpc::code::NOT_FOUND
    );
}

#[tokio::test]
async fn u3016d_summary_keeps_a_source_failure_before_first_measurement() {
    let w = World::new();
    let home = w.home();
    let id = w.agent(Some(&home));
    let db = rusqlite::Connection::open(w.dir.path().join("agents.db")).unwrap();
    db.execute("DELETE FROM measurement_revisions", []).unwrap();
    db.execute("INSERT INTO measurement_positions(source,file,position,last_good,cause) VALUES(?1,'fixture','{}',NULL,'fixture collection refused')", [format!("roundup:{id}")]).unwrap();
    let summary = w.summary(&home).await;
    assert!(
        summary["cause"]
            .as_str()
            .unwrap()
            .contains("fixture collection refused")
    );
    assert_eq!(summary["rows"][0]["agent"], id);
    assert_eq!(summary["last_observed"], Value::Null);
}
