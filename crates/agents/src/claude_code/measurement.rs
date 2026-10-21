//! Only completed request records count. Inclusive summaries and latest context size do not.
use super::Launcher;
use crate::measurement::{Batch, Contribution, Position};
use contracts::project::{Consumed, MeasurementValue};
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
}
#[derive(Deserialize)]
struct Message {
    usage: Option<Usage>,
}
#[derive(Deserialize)]
struct Usage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
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
        files
            .into_iter()
            .map(|path| {
                let file = format!("{:x}", Sha256::digest(path.as_os_str().as_encoded_bytes()));
                let position = positions.get(&file).cloned().unwrap_or_default();
                read(&path, file, position, source)
            })
            .collect()
    }
}

fn read(path: &Path, file: String, mut position: Position, source: &str) -> Result<Batch, String> {
    let metadata =
        std::fs::symlink_metadata(path).map_err(|e| format!("local request records: {e}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("local request source is not a regular file".into());
    }
    let incarnation = format!("{}:{}", metadata.dev(), metadata.ino());
    if position.incarnation != incarnation || metadata.len() < position.offset {
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
        match parse(&line, source) {
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

fn parse(line: &[u8], source: &str) -> Result<Option<Contribution>, String> {
    let record: Record =
        serde_json::from_slice(line).map_err(|e| format!("unsupported local record: {e}"))?;
    if record.kind != "assistant" {
        return Ok(None);
    }
    if record.session_id.as_deref() != Some(source) {
        return Err("request ownership does not match retained conversation".into());
    }
    let identity = record
        .request_id
        .filter(|s| !s.is_empty())
        .ok_or("request identity unavailable")?;
    let usage = record
        .message
        .and_then(|m| m.usage)
        .ok_or("request usage unavailable")?;
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
    let value = MeasurementValue::Request {
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
