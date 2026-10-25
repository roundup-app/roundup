use super::*;
use std::sync::Mutex;
use tracing::instrument::WithSubscriber;
use tracing_subscriber::{Layer, layer::Context, prelude::*, registry::LookupSpan};

#[derive(Clone, Debug, Default)]
struct Capture(Arc<Mutex<Vec<String>>>);

impl<S: tracing::Subscriber + for<'a> LookupSpan<'a>> Layer<S> for Capture {
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        id: &tracing::Id,
        _: Context<'_, S>,
    ) {
        let mut fields = String::new();
        attrs.record(
            &mut |field: &tracing::field::Field, value: &dyn std::fmt::Debug| {
                use std::fmt::Write;
                write!(&mut fields, " {}={value:?}", field.name()).unwrap();
            },
        );
        self.0.lock().unwrap().push(format!(
            "new {} {}{fields}",
            id.into_u64(),
            attrs.metadata().name()
        ));
    }
    fn on_enter(&self, id: &tracing::Id, _: Context<'_, S>) {
        self.0
            .lock()
            .unwrap()
            .push(format!("enter {}", id.into_u64()));
    }
    fn on_exit(&self, id: &tracing::Id, _: Context<'_, S>) {
        self.0
            .lock()
            .unwrap()
            .push(format!("exit {}", id.into_u64()));
    }
    fn on_close(&self, id: tracing::Id, _: Context<'_, S>) {
        self.0
            .lock()
            .unwrap()
            .push(format!("close {}", id.into_u64()));
    }
    fn on_event(&self, event: &tracing::Event<'_>, ctx: Context<'_, S>) {
        let mut fields = String::new();
        event.record(
            &mut |field: &tracing::field::Field, value: &dyn std::fmt::Debug| {
                use std::fmt::Write;
                write!(&mut fields, " {}={value:?}", field.name()).unwrap();
            },
        );
        let id = ctx.lookup_current().map(|span| span.id().into_u64());
        self.0.lock().unwrap().push(format!("event {id:?}{fields}"));
    }
}

fn conn() -> Conn {
    Conn {
        actor: Actor::user(),
        peer: None,
        events: mpsc::unbounded_channel().0,
        output: None,
    }
}

#[tokio::test]
async fn z3802a_dispatch_emits_one_method_span() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    for method in [
        "daemon.ping",
        "rail.tree",
        "rail.list",
        "todo.list",
        "missing.method",
    ] {
        for notification in [false, true] {
            let capture = Capture::default();
            let subscriber = tracing_subscriber::registry().with(capture.clone());
            let mut request = json!({"method":method});
            if !notification {
                request["id"] = json!(1);
            }
            let reply = daemon
                .dispatch_parsed(&mut conn(), request, None)
                .with_subscriber(subscriber)
                .await;
            assert_eq!(reply.is_none(), notification);
            let records = capture.0.lock().unwrap();
            let spans: Vec<_> = records
                .iter()
                .filter(|row| row.starts_with("new "))
                .collect();
            assert_eq!(spans.len(), 1, "{method}: {records:?}");
            assert!(
                spans[0].ends_with(&format!("request method={method:?}")),
                "{records:?}"
            );
            let id = spans[0].split_whitespace().nth(1).unwrap();
            assert!(records.contains(&format!("enter {id}")));
            assert_eq!(records.last().unwrap(), &format!("close {id}"));
            assert!(
                records
                    .iter()
                    .any(|row| row.starts_with(&format!("event Some({id}) outcome="))),
                "{records:?}"
            );
        }
    }
}

#[tokio::test]
async fn z3802a_concurrent_dispatch_keeps_method_identity() {
    use std::future::Future;
    use std::task::{Context as TaskContext, Poll, Waker};
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    struct Parked(Arc<tokio::sync::Semaphore>);
    #[async_trait::async_trait]
    impl Module for Parked {
        fn namespaces(&self) -> &'static [&'static str] {
            &["probe"]
        }
        async fn call(&self, _: &Ctx, _: &str, _: Value) -> Result<Value, RpcError> {
            let before = tracing::Span::current().id();
            let permit = self.0.acquire().await.unwrap();
            permit.forget();
            let after = tracing::Span::current().id();
            Ok(
                json!({"before":before.map(|id| id.into_u64()), "after":after.map(|id| id.into_u64())}),
            )
        }
    }
    let release = Arc::new(tokio::sync::Semaphore::new(0));
    let mut daemon = daemon;
    daemon.register(Arc::new(Parked(release.clone())));
    let capture = Capture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());
    let dispatch = tracing::Dispatch::new(subscriber);
    let mut first_conn = conn();
    let mut second_conn = conn();
    let mut first = std::pin::pin!(
        daemon
            .dispatch_parsed(
                &mut first_conn,
                json!({"id":1,"method":"probe.first"}),
                None
            )
            .with_subscriber(dispatch.clone())
    );
    let mut second = std::pin::pin!(
        daemon
            .dispatch_parsed(
                &mut second_conn,
                json!({"id":2,"method":"probe.second"}),
                None
            )
            .with_subscriber(dispatch)
    );
    let mut context = TaskContext::from_waker(Waker::noop());
    assert!(matches!(first.as_mut().poll(&mut context), Poll::Pending));
    assert!(matches!(second.as_mut().poll(&mut context), Poll::Pending));
    let starts = capture.0.lock().unwrap().clone();
    let ids: Vec<_> = ["probe.first", "probe.second"]
        .iter()
        .map(|method| {
            let row = starts
                .iter()
                .find(|row| row.starts_with("new ") && row.ends_with(&format!("method={method:?}")))
                .expect("method span");
            row.split_whitespace().nth(1).unwrap().to_owned()
        })
        .collect();
    assert_ne!(ids[0], ids[1]);
    assert!(!starts.iter().any(|row| row.starts_with("close ")));
    release.add_permits(2);
    let replies = tokio::join!(first.as_mut(), second.as_mut());
    for (reply, id) in [replies.0, replies.1].into_iter().zip(&ids) {
        let reply = reply.unwrap().into_value();
        assert_eq!(reply["result"]["before"], id.parse::<u64>().unwrap());
        assert_eq!(reply["result"]["after"], id.parse::<u64>().unwrap());
    }
    let records = capture.0.lock().unwrap();
    for id in ids {
        assert!(
            records
                .iter()
                .filter(|row| **row == format!("enter {id}"))
                .count()
                >= 2,
            "{records:?}"
        );
        assert!(
            records
                .iter()
                .any(|row| row.starts_with(&format!("event Some({id}) outcome="))),
            "{records:?}"
        );
        assert!(records.contains(&format!("close {id}")));
    }
}

#[tokio::test]
async fn z3802a_spans_exclude_private_payloads() {
    let dir = tempfile::tempdir().unwrap();
    let daemon = tests::daemon_in(dir.path());
    let capture = Capture::default();
    let subscriber = tracing_subscriber::registry().with(capture.clone());
    let reply = daemon.dispatch_parsed(&mut conn(), json!({
        "id":"private-request-id", "method":"todo.create",
        "params":{"title":"private-title-🦀", "credentials":"private-credential", "input":"private-terminal"}
    }), None).with_subscriber(subscriber).await.unwrap().into_value();
    assert_eq!(reply["result"]["title"], "private-title-🦀");
    let records = capture.0.lock().unwrap();
    assert!(
        records
            .iter()
            .any(|row| row.ends_with("request method=\"todo.create\""))
    );
    let text = records.join("\n");
    for private in [
        "private-",
        "credentials",
        "params",
        "result",
        "actor",
        "request=",
    ] {
        assert!(!text.contains(private), "{text}");
    }
}
