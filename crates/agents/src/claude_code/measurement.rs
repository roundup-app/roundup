//! Completed requests supply consumption; inclusive conversation money stays separate.
use super::Launcher;
use crate::measurement::{Batch, Contribution, Position};
use contracts::project::{CacheWrites, Consumed, MeasurementValue, ReferenceRates, RequestCost};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type")]
    kind: String,
    session_id: Option<String>,
    request_id: Option<String>,
    message: Option<Message>,
    #[serde(rename = "totalCostUSD")]
    total_cost_usd: Option<Box<serde_json::value::RawValue>>,
    has_unknown_model_cost: Option<bool>,
}
#[derive(Deserialize)]
struct Message {
    model: Option<String>,
    usage: Option<Usage>,
}
#[derive(Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_creation: Option<CacheCreation>,
}
#[derive(Deserialize)]
struct CacheCreation {
    ephemeral_5m_input_tokens: Option<u64>,
    ephemeral_1h_input_tokens: Option<u64>,
}

impl Launcher {
    /// Positions are opaque outside the Adapter and commit with accepted revisions.
    pub(crate) fn collect_measurements(
        &self,
        cwd: &Path,
        source: &str,
        positions: &HashMap<String, Position>,
    ) -> Result<Vec<Batch>, String> {
        let path = self.conversation_path(cwd, source).map_err(|e| e.message)?;
        let mut files = vec![path.clone()];
        let children = path.with_extension("").join("subagents");
        match std::fs::read_dir(children) {
            Ok(entries) => {
                for entry in entries {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entry.file_type().map_err(|e| e.to_string())?.is_file()
                        && entry.path().extension().is_some_and(|s| s == "jsonl")
                    {
                        files.push(entry.path());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        files.sort();
        let files_main = path;
        files
            .into_iter()
            .map(|path| {
                let file = format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()));
                let position = positions.get(&file).cloned().unwrap_or_default();
                read(&path, file, position, source, path == files_main)
            })
            .collect()
    }
}

fn read(
    path: &Path,
    file: String,
    mut position: Position,
    source: &str,
    include_money: bool,
) -> Result<Batch, String> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|e| format!("local request records: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("local request source is not a regular file".into());
    }
    let incarnation = format!("{}:{}", metadata.dev(), metadata.ino());
    // A bounded one-time replay enriches previously collected requests without moving ownership.
    if position.format != 1
        || position.incarnation != incarnation
        || metadata.len() < position.offset
    {
        position.format = 1;
        position.incarnation = incarnation;
        position.offset = 0;
    }
    let mut input = std::fs::File::open(path).map_err(|e| e.to_string())?;
    input
        .seek(SeekFrom::Start(position.offset))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(input);
    let mut contributions = Vec::new();
    let mut cause = None;
    let mut consumed = 0;
    while consumed < 1024 * 1024 {
        let mut line = Vec::new();
        let count = reader
            .by_ref()
            .take(1024 * 1024 + 1)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if count > 1024 * 1024 {
            cause = Some("request record exceeds collection bound".into());
            break;
        }
        if count == 0 || line.last() != Some(&b'\n') {
            break;
        }
        position.offset += count as u64;
        consumed += count;
        match parse(&line, source, include_money) {
            Ok(Some(contribution)) => contributions.push(contribution),
            Ok(None) => {}
            Err(e) => {
                position.gap.get_or_insert_with(|| {
                    format!("local request records skipped; first rejection: {e}")
                });
                cause = Some(e);
            }
        }
    }
    Ok(Batch {
        file,
        position,
        contributions,
        cause,
    })
}

fn parse(line: &[u8], source: &str, include_money: bool) -> Result<Option<Contribution>, String> {
    let record: Record =
        serde_json::from_slice(line).map_err(|e| format!("unsupported local record: {e}"))?;
    if (record.kind != "assistant" && record.kind != "cost-state")
        || (record.kind == "cost-state" && !include_money)
    {
        return Ok(None);
    }
    if record.session_id.as_deref() != Some(source) {
        return Err("request ownership does not match retained conversation".into());
    }
    if record.kind == "cost-state" {
        use contracts::project::{MoneyScope, ReportedMoney};
        let raw = record.total_cost_usd.ok_or("reported money unavailable: local conversation total has no established USD amount/currency")?;
        // RawValue retains the exact decimal lexeme; Number only checks numeric/nonnegative input.
        let number: serde_json::Number =
            serde_json::from_str(raw.get()).map_err(|_| "unsupported reported money amount")?;
        if number.as_f64().is_none_or(|n| n < 0.0) {
            return Err("unsupported reported money amount".into());
        }
        let value = MeasurementValue::Money { reported: ReportedMoney {
            scope: MoneyScope::Conversation,
            amount: raw.get().into(),
            currency: Some("USD".into()),
            source: "local conversation cost-state.totalCostUSD".into(),
            basis: if record.has_unknown_model_cost == Some(false) {
                "vendor-reported inclusive conversation estimate; includes native children; pricing may be configured by vendor; not a charge or subscription bill"
            } else {
                "vendor-reported inclusive conversation estimate; includes native children; unknown Model pricing coverage; not a charge or subscription bill"
            }.into(),
        }};
        let revision = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&value).map_err(|e| e.to_string())?)
        );
        return Ok(Some(Contribution {
            identity: format!("money:{source}"), revision, value,
            coverage: vec!["inclusive conversation total; never add to constituent requests or reference estimates; completed-source evidence only; Home move cannot split total".into()], related_request: None,
        }));
    }
    let identity = record
        .request_id
        .filter(|s| !s.is_empty())
        .ok_or("request identity unavailable")?;
    let message = record.message.ok_or("request message unavailable")?;
    let usage = message.usage.ok_or("request usage unavailable")?;
    if [
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
    ]
    .into_iter()
    .flatten()
    .any(|n| n > 9_007_199_254_740_991)
    {
        return Err("request usage exceeds exact public numeric range".into());
    }
    let cost = request_cost(message.model, &usage);
    let value = MeasurementValue::Request {
        cost: Some(Box::new(cost)),
        usage: Consumed {
            input: usage.input_tokens,
            output: usage.output_tokens,
            cache_read: usage.cache_read_input_tokens,
            cache_write: usage.cache_creation_input_tokens,
        },
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).map_err(|e| e.to_string())?)
    );
    let coverage=vec!["completed requests only; historical Attempt unknown; source record cannot be split across a Home move".into()];
    Ok(Some(Contribution {
        identity: format!("request:{identity}"),
        revision,
        value,
        coverage,
        related_request: None,
    }))
}

// Only these exact response Model ids have a checked reference row. Aliases and provider
// variants cannot inherit a rate by prefix: that would silently price an unknown Model.
fn reference(model: Option<&str>) -> Option<ReferenceRates> {
    let (input, output, read, five, hour) = match model? {
        "claude-opus-5-5" => ("4", "20", "0.20", "5", "8"),
        "claude-sonnet-5-5" => ("2", "10", "0.10", "2.50", "4"),
        "claude-opus-4-6" => ("5", "25", "0.50", "6.25", "10"),
        _ => return None,
    };
    Some(ReferenceRates {
        version: "reference-2026-10-21.1".into(),
        date: "2026-10-21".into(),
        currency: "USD".into(),
        source: "https://platform.claude.com/docs/en/about-claude/pricing".into(),
        basis: "standard global first-party list reference; excludes fast mode, residency, negotiated discounts, tools and subscription billing; actual request pricing not established".into(),
        per_tokens: 1_000_000,
        input: input.into(),
        output: output.into(),
        cache_read: read.into(),
        cache_write_five_minute: five.into(),
        cache_write_one_hour: hour.into(),
    })
}

fn request_cost(model: Option<String>, usage: &Usage) -> RequestCost {
    let model = model.filter(|s| !s.is_empty());
    let reference = reference(model.as_deref());
    let mut unavailable = vec!["reported money unavailable: completed local request records and configured traces carry no supported money/currency; log-export estimates and inclusive conversation totals are not request charges".into()];
    if reference.is_none() {
        unavailable.push("reference rates unavailable: Model unknown or unsupported by the offline reference version".into());
    }
    let mut cache_write = CacheWrites {
        five_minute: usage
            .cache_creation
            .as_ref()
            .and_then(|c| c.ephemeral_5m_input_tokens),
        one_hour: usage
            .cache_creation
            .as_ref()
            .and_then(|c| c.ephemeral_1h_input_tokens),
    };
    if [cache_write.five_minute, cache_write.one_hour]
        .into_iter()
        .flatten()
        .any(|n| n > 9_007_199_254_740_991)
        || matches!((cache_write.five_minute,cache_write.one_hour,usage.cache_creation_input_tokens),(Some(a),Some(b),Some(total)) if a.checked_add(b)!=Some(total))
    {
        cache_write = CacheWrites {
            five_minute: None,
            one_hour: None,
        };
        unavailable.push("cache-write classes unavailable: source classes exceed exact range or disagree with consumed cache writes".into());
    }
    if cache_write.five_minute.is_none() || cache_write.one_hour.is_none() {
        unavailable.push(
            "cache-write estimate incomplete: source did not establish both write classes".into(),
        );
    }
    if [
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
    ]
    .contains(&None)
    {
        unavailable.push("reference estimate incomplete: consumed categories missing; known categories remain usable".into());
    }
    RequestCost {
        model,
        cache_write,
        reference,
        reported: None,
        unavailable,
    }
}

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
        let related_request = span
            .attributes
            .iter()
            .find(|a| a.key == "request_id")
            .and_then(|a| a.value.string_value.as_ref())
            .filter(|v| !v.is_empty())
            .map(|v| format!("request:{v}"));
        contributions.push(Contribution {identity:format!("interval:{}:{}",span.trace_id,span.span_id),revision,value,related_request,coverage:vec!["completed source wall-clock interval; no monotonic continuity or active execution inferred; Home move cannot split source interval".into()]});
    }
    Ok((source.ok_or("no interval ownership")?, contributions))
}
