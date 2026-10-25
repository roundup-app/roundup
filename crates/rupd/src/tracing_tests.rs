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
