//! Execution intervals from the vendor's trace export. The Adapter owns the HTTP receiver and
//! every vendor string; only Attempt-bound intervals cross back into Project storage.
use crate::measurement::Contribution;
use contracts::project::MeasurementValue;
use serde::Deserialize;
use sha2::{Digest, Sha256};

/// HTTP belongs to this Adapter. The random per-launch path is a local capability; payloads
/// supply no Project or roundup Agent. The caller verifies its pre-bound Attempt association.
pub(crate) async fn listen(
    accept: impl Fn(String, Vec<Contribution>) -> Result<(), String> + Send + Sync + 'static,
    failed: impl Fn(String) + Send + Sync + 'static,
    alive: impl Fn() -> bool + Send + 'static,
) -> Result<std::collections::BTreeMap<String, String>, rpc::RpcError> {
    use axum::{Json, Router, extract::rejection::JsonRejection, http::StatusCode, routing::post};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(rpc::RpcError::internal)?;
    let address = listener.local_addr().map_err(rpc::RpcError::internal)?;
    let mut secret = [0u8; 32];
    getrandom::fill(&mut secret).map_err(rpc::RpcError::internal)?;
    let capability = secret
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let route = format!("/{capability}/v1/traces");
    let accept = std::sync::Arc::new(accept);
    let failed = std::sync::Arc::new(failed);
    let app = Router::new().route(
        &route,
        post(move |body: Result<Json<Export>, JsonRejection>| {
            let accept = accept.clone();
            let failed = failed.clone();
            async move {
                let body = match body {
                    Ok(Json(body)) => body,
                    Err(rejection) => {
                        failed(rejection.body_text());
                        return (rejection.status(), "interval export unavailable");
                    }
                };
                match spans(body).and_then(|(source, contributions)| accept(source, contributions))
                {
                    Ok(()) => (StatusCode::OK, "{}"),
                    Err(cause) => {
                        failed(cause);
                        (
                            StatusCode::UNPROCESSABLE_ENTITY,
                            "source ownership or interval unavailable",
                        )
                    }
                }
            }
        }),
    );
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async move {
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    if !alive() {
                        break;
                    }
                }
            })
            .await
            .expect("Adapter interval receiver");
    });
    Ok([
        ("CLAUDE_CODE_ENABLE_TELEMETRY", "1".to_owned()),
        ("CLAUDE_CODE_ENHANCED_TELEMETRY_BETA", "1".to_owned()),
        ("OTEL_TRACES_EXPORTER", "otlp".to_owned()),
        ("OTEL_EXPORTER_OTLP_TRACES_PROTOCOL", "http/json".to_owned()),
        (
            "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
            format!("http://{address}/{capability}/v1/traces"),
        ),
        ("OTEL_TRACES_EXPORT_INTERVAL", "500".to_owned()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v))
    .collect())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Export {
    resource_spans: Vec<Resource>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Resource {
    scope_spans: Vec<Scope>,
}
#[derive(Deserialize)]
struct Scope {
    spans: Vec<Span>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Span {
    name: String,
    trace_id: String,
    span_id: String,
    start_time_unix_nano: String,
    end_time_unix_nano: String,
    #[serde(default)]
    attributes: Vec<Attribute>,
}
#[derive(Deserialize)]
struct Attribute {
    key: String,
    value: AttributeValue,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttributeValue {
    string_value: Option<String>,
}

fn spans(export: Export) -> Result<(String, Vec<Contribution>), String> {
    use contracts::project::Execution;
    let mut contributions = Vec::new();
    let mut source = None;
    for span in export
        .resource_spans
        .into_iter()
        .flat_map(|r| r.scope_spans)
        .flat_map(|s| s.spans)
    {
        let root = span
            .attributes
            .iter()
            .find(|a| a.key == "session.id")
            .and_then(|a| a.value.string_value.as_ref())
            .ok_or("interval has no enclosing ownership identity")?;
        if source.as_ref().is_some_and(|s| s != root) {
            return Err("mixed interval ownership".into());
        }
        source = Some(root.clone());
        let category = match span.name.as_str() {
            "claude_code.llm_request" => Execution::Agent,
            "claude_code.tool.execution" => Execution::Tool,
            // Permission probes, tool wrappers and interactions are not execution evidence.
            _ => continue,
        };
        let start = span
            .start_time_unix_nano
            .parse::<u64>()
            .map_err(|_| "invalid source start")?;
        let end = span
            .end_time_unix_nano
            .parse::<u64>()
            .map_err(|_| "invalid source end")?;
        if end < start || span.trace_id.is_empty() || span.span_id.is_empty() {
            return Err("invalid source interval identity or clock".into());
        }
        let value = MeasurementValue::Interval {
            category,
            clock: "source Unix wall nanoseconds; clock lifetime unavailable".into(),
            start_unix_ns: start.to_string(),
            end_unix_ns: end.to_string(),
        };
        let revision = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&value).map_err(|e| e.to_string())?)
        );
        contributions.push(Contribution {identity:format!("interval:{}:{}",span.trace_id,span.span_id),revision,value,coverage:vec!["completed source wall-clock interval; no monotonic continuity or active execution inferred; Home move cannot split source interval".into()]});
    }
    Ok((source.ok_or("no interval ownership")?, contributions))
}

#[cfg(test)]
mod recovery_tests {
    use crate::measurement::Contribution;
    use crate::*;
    use contracts::project::{Execution, MeasurementValue};
    const SOURCE: &str = "11111111-1111-4111-8111-111111111111";

    struct Recovery {
        agents: Agents,
        ctx: Ctx,
        dir: tempfile::TempDir,
        agent: String,
    }

    fn interval(id: &str) -> Contribution {
        Contribution {
            identity: format!("interval:{id}"),
            revision: id.into(),
            value: MeasurementValue::Interval {
                category: Execution::Agent,
                clock: "source".into(),
                start_unix_ns: "1000000000".into(),
                end_unix_ns: "2000000000".into(),
            },
            coverage: Vec::new(),
        }
    }

    impl Recovery {
        fn new() -> Self {
            let (dir, bus, shared) = crate::tests::shared_over_temp_dir(Arc::new(|| 1000));
            let launcher = Launcher::new(
                "false",
                dir.path().join("config"),
                dir.path().join("rup"),
                None,
            );
            let home = shared
                .rail()
                .insert(NodeKind::Workstream, "home", None, None)
                .unwrap()
                .id;
            let agent = shared
                .rail()
                .insert(NodeKind::Agent, "maker", Some(&home), Some("1"))
                .unwrap()
                .id;
            shared.rail().observe_measurement_owner(
                &agent,
                SOURCE,
                dir.path().to_str().unwrap(),
                "1",
            );
            let agents = Agents {
                shared,
                dir: dir.path().into(),
                launcher,
            };
            let ctx = Ctx {
                actor: Actor::user(),
                bus,
                touches: Arc::new(provenance::Touches::in_memory().unwrap()),
            };
            Self {
                agents,
                ctx,
                dir,
                agent,
            }
        }

        /// The exporter's push: an unaccepted interval is sent again until it is.
        fn push(&self, id: &str) -> Result<(), rpc::RpcError> {
            self.agents.shared.rail().accept_intervals(
                &self.agent,
                "1",
                SOURCE,
                vec![interval(id)],
                1000,
            )
        }

        async fn read(&self) -> Value {
            self.agents
                .call(&self.ctx, "project.measurements", Value::Null)
                .await
                .unwrap()
        }

        fn reopen(&mut self) {
            let bus = Bus::new();
            let terms = Arc::new(Terminals::open(self.dir.path(), bus.clone()).unwrap());
            self.agents = Agents::open_with(
                self.dir.path(),
                bus.clone(),
                terms,
                self.agents.launcher.clone(),
                worktree::Git::from_env(),
            )
            .unwrap();
            self.ctx.bus = bus;
        }

        fn db(&self) -> rusqlite::Connection {
            rusqlite::Connection::open(self.dir.path().join("agents.db")).unwrap()
        }
    }

    fn intervals(read: &Value) -> Vec<Value> {
        read["contributions"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|fact| fact["value"]["kind"] == "interval")
            .cloned()
            .collect()
    }

    fn revision(read: &Value) -> u64 {
        read["revision"].as_str().unwrap().parse().unwrap()
    }

    fn recovered_intervals(good: &Value, recovered: &Value) {
        let before = intervals(good);
        let after = intervals(recovered);
        assert_eq!(before.len(), 1);
        assert_eq!(after.len(), 2);
        assert!(
            after.contains(&before[0]),
            "the original interval and attribution survive"
        );
        for fact in &after {
            for field in ["agent", "home", "maker", "attempt"] {
                assert_eq!(fact[field], before[0][field]);
            }
        }
        assert!(revision(recovered) > revision(good));
    }

    #[tokio::test(start_paused = true)]
    async fn u3119a_revision_write_recovery_publishes_the_request() {
        let w = Recovery::new();
        w.push("first").unwrap();
        let good = w.read().await;
        let mut events = w.ctx.bus.subscribe();
        w.agents.observe_measurements();
        tokio::task::yield_now().await;
        let db = w.db();
        db.execute_batch("ALTER TABLE measurement_state RENAME TO held_measurement_state")
            .unwrap();
        assert!(w.push("second").is_err());
        assert!(
            w.agents
                .call(&w.ctx, "project.measurements", Value::Null)
                .await
                .is_err()
        );
        db.execute_batch("ALTER TABLE held_measurement_state RENAME TO measurement_state")
            .unwrap();
        let restored = w.read().await;
        assert_eq!(
            intervals(&restored).len(),
            1,
            "a failed write leaves no half-retained interval under the old revision"
        );
        w.push("second").unwrap();
        let recovered = w.read().await;
        recovered_intervals(&good, &recovered);
        tokio::time::advance(crate::measurement::OBSERVATION_PERIOD).await;
        loop {
            let event = tokio::time::timeout(Duration::from_secs(2), events.recv())
                .await
                .unwrap()
                .unwrap();
            if let EventData::MeasurementsChanged { revision: notified } = event.data
                && notified.parse::<u64>().unwrap() > revision(&good)
            {
                let read = w.read().await;
                assert!(revision(&read) >= notified.parse::<u64>().unwrap());
                assert_eq!(intervals(&read), intervals(&recovered));
                break;
            }
        }
    }

    #[tokio::test]
    async fn u3119b_revision_write_recovery_survives_reopen() {
        for (fail, restore) in [
            (
                "ALTER TABLE measurement_state RENAME TO held_measurement_state",
                "ALTER TABLE held_measurement_state RENAME TO measurement_state",
            ),
            (
                "CREATE TRIGGER refuse_interval BEFORE INSERT ON measurement_revisions BEGIN SELECT RAISE(ABORT,'retention refused'); END;",
                "DROP TRIGGER refuse_interval",
            ),
        ] {
            let mut w = Recovery::new();
            w.push("first").unwrap();
            let good = w.read().await;
            let db = w.db();
            db.execute_batch(fail).unwrap();
            assert!(w.push("second").is_err());
            db.execute_batch(restore).unwrap();
            w.reopen();
            w.push("first").unwrap();
            w.push("second").unwrap();
            let recovered = w.read().await;
            recovered_intervals(&good, &recovered);
            w.reopen();
            w.push("first").unwrap();
            w.push("second").unwrap();
            let replayed = w.read().await;
            assert_eq!(intervals(&replayed), intervals(&recovered));
            assert_eq!(replayed["revision"], recovered["revision"]);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn u3016d_initial_storage_failure_stays_visible_until_collection_recovers() {
        let (dir, bus, shared) = crate::tests::shared_over_temp_dir(Arc::new(|| 1000));
        let agents = Agents {
            shared,
            dir: dir.path().into(),
            launcher: Launcher::new(
                "false",
                dir.path().join("config"),
                dir.path().join("rup"),
                None,
            ),
        };
        let ctx = Ctx {
            actor: Actor::user(),
            bus: bus.clone(),
            touches: Arc::new(provenance::Touches::in_memory().unwrap()),
        };
        let read = || agents.call(&ctx, "project.measurements", Value::Null);
        let db = rusqlite::Connection::open(dir.path().join("agents.db")).unwrap();
        db.execute_batch("ALTER TABLE measurement_state RENAME TO held_measurement_state")
            .unwrap();
        // Failure at start must neither panic the caller nor permanently hold a dead claim.
        for _ in 0..4 {
            agents.observe_measurements();
        }
        tokio::task::yield_now().await;
        assert!(read().await.is_err());
        db.execute_batch("ALTER TABLE held_measurement_state RENAME TO measurement_state")
            .unwrap();
        let stale = read().await.unwrap();
        assert!(
            stale["cause"]
                .as_str()
                .unwrap()
                .contains("measurement_state")
        );
        assert!(stale["contributions"].as_array().unwrap().is_empty());
        assert!(stale["sources"].as_array().unwrap().is_empty());
        assert_eq!(stale["revision"], "0");
        let mut events = bus.subscribe();
        tokio::time::advance(crate::measurement::OBSERVATION_PERIOD).await;
        assert!(
            matches!(tokio::time::timeout(Duration::from_secs(2), events.recv()).await.unwrap().unwrap().data, EventData::MeasurementsChanged {revision} if revision == "0")
        );
        let recovered = read().await.unwrap();
        assert!(recovered["cause"].is_null());
        assert_eq!(
            recovered["revision"], stale["revision"],
            "recovery is not a new observation"
        );
    }
}
