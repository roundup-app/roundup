//! The account's weekly use, from the vendor's account usage read (U3016h). It spends no Model
//! tokens and starts no Agent. The sign-in, the endpoint and the answer's shape are Claude
//! Code's own and stay in this module.

use std::path::Path;
use std::time::{Duration, Instant};

use contracts::project::WeeklyLimit;
use serde_json::Value;

pub(super) const ENDPOINT: &str = "https://api.anthropic.com/api/oauth/usage";
/// The read repeats at most this often, whoever asks.
const EVERY: Duration = Duration::from_secs(60);

#[derive(Clone, Default)]
pub(super) struct Cache(std::sync::Arc<tokio::sync::Mutex<Option<(Instant, WeeklyLimit)>>>);

fn unavailable(reason: &str) -> WeeklyLimit {
    WeeklyLimit {
        used_percent: None,
        resets_at: None,
        reason: Some(reason.into()),
    }
}

fn token(config: &Path) -> Option<String> {
    if let Some(token) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
    {
        return Some(token);
    }
    let saved = std::fs::read_to_string(config.join(".credentials.json"))
        .ok()
        .or_else(keychain)?;
    let saved: Value = serde_json::from_str(&saved).ok()?;
    saved["claudeAiOauth"]["accessToken"]
        .as_str()
        .map(str::to_owned)
}

fn keychain() -> Option<String> {
    if std::env::consts::OS != "macos" {
        return None;
    }
    let out = std::process::Command::new("security")
        .args([
            "find-generic-password",
            "-s",
            "Claude Code-credentials",
            "-w",
        ])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// What the vendor answered, as the weekly figure. A shape it does not recognise is unavailable.
fn parse(body: &str) -> WeeklyLimit {
    let Ok(body) = serde_json::from_str::<Value>(body) else {
        return unavailable("Claude Code's usage answer was not understood.");
    };
    let week = &body["seven_day"];
    let Some(used) = week["utilization"]
        .as_f64()
        .filter(|u| u.is_finite() && *u >= 0.0)
    else {
        return unavailable("Claude Code reports no weekly limit for this account.");
    };
    let resets_at = week["resets_at"]
        .as_str()
        .and_then(|at| {
            time::OffsetDateTime::parse(at, &time::format_description::well_known::Rfc3339).ok()
        })
        .and_then(|at| i64::try_from(at.unix_timestamp_nanos() / 1_000_000).ok());
    WeeklyLimit {
        used_percent: Some(used.round().min(1000.0) as u32),
        resets_at,
        reason: None,
    }
}

async fn fetch(url: &str, token: &str) -> WeeklyLimit {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
    else {
        return unavailable("The weekly limit could not be read.");
    };
    let answer = client
        .get(url)
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await;
    match answer {
        Ok(response) if response.status().is_success() => match response.text().await {
            Ok(body) => parse(&body),
            Err(_) => unavailable("The weekly limit could not be read."),
        },
        Ok(response) if matches!(response.status().as_u16(), 401 | 403) => {
            unavailable("Claude Code is signed out or its sign-in has expired.")
        }
        _ => unavailable("The weekly limit could not be read."),
    }
}

/// The weekly figure, read at most once a minute.
pub(super) async fn weekly_limit(cache: &Cache, config: &Path, url: Option<&str>) -> WeeklyLimit {
    let mut held = cache.0.lock().await;
    if let Some((at, limit)) = held.as_ref()
        && at.elapsed() < EVERY
    {
        return limit.clone();
    }
    let limit = match token(config) {
        None => unavailable("Claude Code is signed out, so its weekly limit cannot be read."),
        Some(token) => fetch(url.unwrap_or(ENDPOINT), &token).await,
    };
    *held = Some((Instant::now(), limit.clone()));
    limit
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    async fn vendor(body: &'static str, status: u16) -> (String, Arc<AtomicUsize>) {
        let hits = Arc::new(AtomicUsize::new(0));
        let seen = hits.clone();
        let app = axum::Router::new().route(
            "/usage",
            axum::routing::get(move |headers: axum::http::HeaderMap| {
                let seen = seen.clone();
                async move {
                    seen.fetch_add(1, Ordering::SeqCst);
                    assert_eq!(headers["authorization"], "Bearer secret");
                    (axum::http::StatusCode::from_u16(status).unwrap(), body)
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/usage", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await });
        (url, hits)
    }

    fn config(signed_in: bool) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        if signed_in {
            std::fs::write(
                dir.path().join(".credentials.json"),
                r#"{"claudeAiOauth":{"accessToken":"secret"}}"#,
            )
            .unwrap();
        }
        dir
    }

    #[tokio::test]
    async fn u3016h_weekly_limit_is_the_accounts_figure_from_the_adapter_read() {
        let (url, hits) = vendor(
            r#"{"seven_day":{"utilization":63.4,"resets_at":"2026-10-28T16:00:00+00:00"}}"#,
            200,
        )
        .await;
        let dir = config(true);
        let cache = Cache::default();
        let limit = weekly_limit(&cache, dir.path(), Some(&url)).await;
        assert_eq!(limit.used_percent, Some(63));
        assert_eq!(limit.resets_at, Some(1_793_203_200_000));
        assert_eq!(limit.reason, None);
        // A second ask within a minute is answered from the first read.
        assert_eq!(weekly_limit(&cache, dir.path(), Some(&url)).await, limit);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn u3016h_unavailable_limit_is_dash_with_a_reason_and_reads_only_while_live() {
        let (url, hits) = vendor("{}", 401).await;
        let signed_out = weekly_limit(&Cache::default(), config(false).path(), Some(&url)).await;
        assert_eq!(signed_out.used_percent, None);
        assert!(signed_out.reason.is_some());
        assert_eq!(hits.load(Ordering::SeqCst), 0);
        let refused = weekly_limit(&Cache::default(), config(true).path(), Some(&url)).await;
        assert_eq!(refused.used_percent, None);
        assert!(refused.reason.unwrap().contains("signed out"));
        let (url, _) = vendor("{}", 200).await;
        let none = weekly_limit(&Cache::default(), config(true).path(), Some(&url)).await;
        assert_eq!((none.used_percent, none.resets_at), (None, None));
        assert!(none.reason.is_some());
    }
}
