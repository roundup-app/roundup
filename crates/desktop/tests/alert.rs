//! U5232e to U5232g (`scenarios/ui-state-alerts.md`): what `stateAlert` asks of the system, against a fake notifier.

use std::sync::{Arc, Mutex};

use desktop::alert::{Alerts, Notifier};
use rpc::code;
use serde_json::json;
use tauri::Listener;
use tauri::test::{mock_builder, mock_context, noop_assets};

#[derive(Default)]
struct Fake {
    refuse: Option<String>,
    calls: Mutex<Vec<String>>,
}

struct Shared(Arc<Fake>);

impl Notifier for Shared {
    fn permission(&self) -> Result<(), String> {
        self.0.calls.lock().unwrap().push("permission".into());
        self.0.refuse.clone().map_or(Ok(()), Err)
    }
    fn banner(&self, agent: &str, title: &str, body: &str) -> Result<(), String> {
        self.0
            .calls
            .lock()
            .unwrap()
            .push(format!("banner {agent}|{title}|{body}"));
        Ok(())
    }
    fn sound(&self) {
        self.0.calls.lock().unwrap().push("sound".into());
    }
}

fn request(alert: bool, sound: bool) -> serde_json::Value {
    json!({ "agent": "a1", "title": "Ada", "body": "Done", "alert": alert, "sound": sound })
}

fn raise(fake: &Arc<Fake>, alert: bool, sound: bool) -> Result<(), rpc::RpcError> {
    // `Alerts` is the command's state; the command forwards the request unchanged.
    Alerts::new(Box::new(Shared(fake.clone())))
        .raise(&serde_json::from_value(request(alert, sound)).unwrap())
}

#[test]
fn u5232f_alert_and_sound_reach_the_notifier_once_each() {
    let fake = Arc::new(Fake::default());
    raise(&fake, true, true).unwrap();
    assert_eq!(
        *fake.calls.lock().unwrap(),
        ["sound", "permission", "banner a1|Ada|Done"]
    );
}

#[test]
fn u5232f_both_false_is_invalid() {
    let fake = Arc::new(Fake::default());
    assert_eq!(
        raise(&fake, false, false).unwrap_err().code,
        code::INVALID_PARAMS
    );
    assert!(fake.calls.lock().unwrap().is_empty());
}

#[test]
fn u5232f_nothing_fires_without_a_call() {
    let fake = Arc::new(Fake::default());
    let _alerts = Alerts::new(Box::new(Shared(fake.clone())));
    assert!(fake.calls.lock().unwrap().is_empty());
}

#[test]
fn u5232g_the_first_alert_asks_permission_once() {
    let fake = Arc::new(Fake::default());
    let alerts = Alerts::new(Box::new(Shared(fake.clone())));
    for _ in 0..3 {
        alerts
            .raise(&serde_json::from_value(request(true, false)).unwrap())
            .unwrap();
    }
    let calls = fake.calls.lock().unwrap();
    assert_eq!(calls.iter().filter(|call| *call == "permission").count(), 1);
    assert_eq!(calls.len(), 4);
}

#[test]
fn u5232g_a_refusal_returns_its_cause_and_sound_still_plays() {
    let fake = Arc::new(Fake {
        refuse: Some("denied".into()),
        ..Fake::default()
    });
    let alerts = Alerts::new(Box::new(Shared(fake.clone())));
    let error = alerts
        .raise(&serde_json::from_value(request(true, true)).unwrap())
        .unwrap_err();
    assert!(error.message.contains("denied"), "{}", error.message);
    alerts
        .raise(&serde_json::from_value(request(false, true)).unwrap())
        .unwrap();
    let calls = fake.calls.lock().unwrap();
    assert_eq!(*calls, ["sound", "permission", "sound"]);
}

#[test]
fn u5232e_a_click_emits_the_agent_to_the_webview() {
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let (sender, seen) = std::sync::mpsc::channel();
    app.handle().listen(desktop::alert::CLICKED, move |event| {
        sender.send(event.payload().to_owned()).unwrap()
    });
    desktop::alert::clicked(app.handle(), "a1");
    let payload = seen
        .recv_timeout(std::time::Duration::from_secs(1))
        .unwrap();
    assert_eq!(payload, r#"{"agent":"a1"}"#);
}
