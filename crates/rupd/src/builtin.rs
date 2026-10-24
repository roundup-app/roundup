//! Methods the Daemon answers itself: `daemon.*`, `events.*`, `provenance.*`.

use contracts::methods;
use contracts::{HistoryParams, IdentifyParams, SubscribeParams, TouchedParams};
use rpc::{RpcError, params, reply};
use serde_json::{Value, json};

use crate::{Conn, Daemon};

/// `None` means the namespace is not the Daemon's; route it to a module.
pub(crate) fn call(
    daemon: &Daemon,
    conn: &mut Conn,
    namespace: &str,
    method: &str,
    args: &Value,
) -> Option<Result<Value, RpcError>> {
    Some(match (namespace, method) {
        (_, "daemon.ping") => Ok(ping(daemon)),
        (_, "daemon.identify") => params::<IdentifyParams>(args.clone()).map(|p| {
            conn.actor = p.actor;
            Value::Null
        }),
        (_, "events.subscribe") => subscribe(daemon, conn, args),
        (_, "provenance.history") => params::<HistoryParams>(args.clone())
            .and_then(|p| daemon.touches.history(&p.item).map_err(RpcError::internal))
            .and_then(|touches| reply(&touches)),
        (_, "provenance.touched") => params::<TouchedParams>(args.clone())
            .and_then(|p| {
                daemon
                    .touches
                    .touched(&p.actor_id)
                    .map_err(RpcError::internal)
            })
            .and_then(|touches| reply(&touches)),
        ("daemon" | "events" | "provenance", _) => Err(RpcError::method_not_found(method)),
        _ => return None,
    })
}

fn ping(daemon: &Daemon) -> Value {
    json!({
        "pong": true,
        "pid": std::process::id(),
        "project": daemon.project,
        "projectKey": daemon.project_key,
        "contract": { "fingerprint": methods::fingerprint(), "methods": methods::method_names() },
    })
}

/// The `daemon.ping` result as JSON text, built on the first call: the Contract's method list is
/// long, so building and writing it on every ping is most of a ping's cost.
pub(crate) fn ping_json(daemon: &Daemon) -> String {
    daemon.ping.get_or_init(|| ping(daemon).to_string()).clone()
}

/// D11: a bad `after` fails here, before any Event is sent.
fn subscribe(daemon: &Daemon, conn: &Conn, args: &Value) -> Result<Value, RpcError> {
    let SubscribeParams { after } = if args.is_null() {
        SubscribeParams::default()
    } else {
        params(args.clone())?
    };
    let mut events = daemon.bus.subscribe_after(after)?;
    let head = events.head();
    let frames = conn.events.clone();
    tokio::spawn(async move {
        loop {
            let event = tokio::select! {
                _ = frames.closed() => return,
                event = events.next() => event,
            };
            let Some(event) = event else { return };
            let frame = json!({ "jsonrpc": "2.0", "method": "event", "params": event });
            if frames.send(frame.into()).is_err() {
                return;
            }
        }
    });
    Ok(json!({ "head": head }))
}
