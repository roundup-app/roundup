//! Methods the Daemon answers itself: `daemon.*`, `events.*`, `provenance.*`.

use contracts::describe::{self, DescribeParams};
use contracts::methods;
use contracts::{HistoryParams, IdentifyParams, SubscribeParams, SubscribeResult, TouchedParams};
use rpc::RpcError;
use serde_json::json;

use crate::{Conn, Daemon};

impl Daemon {
    pub(crate) async fn daemon_ping(&self, _conn: &mut Conn) -> Result<contracts::Ping, RpcError> {
        serde_json::from_str(&ping_json(self)).map_err(RpcError::internal)
    }

    pub(crate) async fn daemon_methods(&self, _conn: &mut Conn) -> Result<Vec<String>, RpcError> {
        Ok(methods::method_names()
            .into_iter()
            .map(String::from)
            .collect())
    }

    pub(crate) async fn api_list(
        &self,
        _conn: &mut Conn,
    ) -> Result<describe::MethodList, RpcError> {
        Ok(describe::list())
    }

    pub(crate) async fn api_describe(
        &self,
        _conn: &mut Conn,
        p: DescribeParams,
    ) -> Result<describe::MethodDescription, RpcError> {
        describe::describe(&p.method).map_err(|closest| {
            let hint = closest.map_or_else(String::new, |name| format!("; closest: {name}"));
            RpcError::new(
                rpc::code::METHOD_NOT_FOUND,
                format!("method not found: {}{hint}", p.method),
            )
        })
    }

    pub(crate) async fn daemon_identify(
        &self,
        conn: &mut Conn,
        p: IdentifyParams,
    ) -> Result<(), RpcError> {
        conn.actor = p.actor;
        Ok(())
    }

    pub(crate) async fn provenance_history(
        &self,
        _conn: &mut Conn,
        p: HistoryParams,
    ) -> Result<Vec<contracts::Touch>, RpcError> {
        self.touches.history(&p.item).map_err(RpcError::internal)
    }

    pub(crate) async fn provenance_touched(
        &self,
        _conn: &mut Conn,
        p: TouchedParams,
    ) -> Result<Vec<contracts::Touch>, RpcError> {
        self.touches
            .touched(&p.actor_id)
            .map_err(RpcError::internal)
    }

    /// D11: a bad `after` fails here, before any Event is sent.
    pub(crate) async fn events_subscribe(
        &self,
        conn: &mut Conn,
        params: Option<SubscribeParams>,
    ) -> Result<SubscribeResult, RpcError> {
        let mut events = self.bus.subscribe_after(params.unwrap_or_default())?;
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
        Ok(SubscribeResult { head })
    }
}

/// R16: ping writes only the fingerprint; the A38 method list made each round trip
/// parse 2.7 KB. The separate `daemon.methods` read serves contract mismatches.
pub(crate) fn ping_json(daemon: &Daemon) -> String {
    static CONTRACT: std::sync::LazyLock<String> =
        std::sync::LazyLock::new(|| json!({ "fingerprint": methods::fingerprint() }).to_string());
    let colour = daemon
        .fork_colour
        .map(|c| format!(r#","forkColour":{}"#, json!(c)))
        .unwrap_or_default();
    format!(
        r#"{{"pong":true,"pid":{},"project":{},"projectKey":{},"contract":{}{colour}}}"#,
        std::process::id(),
        json!(daemon.project),
        json!(daemon.project_key),
        *CONTRACT,
    )
}
