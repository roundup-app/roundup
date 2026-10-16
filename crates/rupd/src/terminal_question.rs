//! U468's in-process vendor callback. This is deliberately not an MCP tool or
//! an alternate decision.answer RPC: only the primary program's exact PID is trusted.
use std::convert::Infallible;
use std::io;
use std::sync::Arc;
use std::time::Duration;

use http_body_util::{BodyExt, Full, Limited};
use hyper::{
    Request, Response, StatusCode,
    body::{Bytes, Incoming},
    service::service_fn,
};
use hyper_util::rt::TokioIo;
use rpc::RpcError;
use tokio::io::BufReader;
use tokio::net::UnixStream;

use crate::Daemon;

pub(crate) async fn serve(
    stream: BufReader<UnixStream>,
    daemon: Arc<Daemon>,
    pid: Option<u32>,
) -> io::Result<()> {
    let connection = hyper::server::conn::http1::Builder::new()
        .keep_alive(false)
        .max_buf_size(16_384)
        .serve_connection(
            TokioIo::new(stream),
            service_fn(move |request| {
                let daemon = Arc::clone(&daemon);
                async move {
                    let result = answer(request, daemon, pid).await;
                    let (status, body) = match result {
                        Ok(()) => (StatusCode::OK, "null".to_owned()),
                        Err(error) => (
                            match error.code {
                                rpc::code::FORBIDDEN => StatusCode::FORBIDDEN,
                                rpc::code::NOT_FOUND => StatusCode::NOT_FOUND,
                                rpc::code::CONFLICT => StatusCode::CONFLICT,
                                rpc::code::INVALID_PARAMS => StatusCode::BAD_REQUEST,
                                _ => StatusCode::INTERNAL_SERVER_ERROR,
                            },
                            serde_json::to_string(&error).expect("an RPC error is JSON"),
                        ),
                    };
                    let mut response = Response::new(Full::new(Bytes::from(body)));
                    *response.status_mut() = status;
                    Ok::<_, Infallible>(response)
                }
            }),
        );
    tokio::time::timeout(Duration::from_secs(10), connection)
        .await
        .map_err(|_| {
            io::Error::new(
                io::ErrorKind::TimedOut,
                "native question callback timed out",
            )
        })?
        .map_err(io::Error::other)
}

async fn answer(
    request: Request<Incoming>,
    daemon: Arc<Daemon>,
    pid: Option<u32>,
) -> Result<(), RpcError> {
    if request.method() != hyper::Method::POST
        || request.uri().path() != "/terminal-question/answer"
    {
        return Err(RpcError::forbidden(
            "only the native question callback is served here",
        ));
    }
    let body = Limited::new(request.into_body(), 16_384)
        .collect()
        .await
        .map_err(|error| RpcError::new(rpc::code::INVALID_PARAMS, error.to_string()))?
        .to_bytes();
    let pid = pid.ok_or_else(|| RpcError::forbidden("native question callback has no peer PID"))?;
    // Consume only a bounded body so a refusal is delivered without resetting
    // the socket with unread client bytes; authenticate before parsing it.
    let owner = daemon
        .agents
        .running_programs()
        .into_iter()
        .find(|(_, program)| *program == pid)
        .map(|(owner, _)| owner)
        .ok_or_else(|| {
            RpcError::forbidden("only the live primary program reports a native answer")
        })?;
    let _effect = daemon.child_effects(&owner).read_owned().await;
    let response: contracts::decision::TerminalAnswer = serde_json::from_slice(&body)
        .map_err(|error| RpcError::new(rpc::code::INVALID_PARAMS, error.to_string()))?;
    let ctx = daemon.ctx(contracts::Actor::daemon());
    tokio::task::spawn_blocking(move || daemon.agents.answer_terminal_question(&ctx, pid, response))
        .await
        .map_err(|error| {
            RpcError::unknown_outcome(format!("native question worker ended: {error}"))
        })?
}
