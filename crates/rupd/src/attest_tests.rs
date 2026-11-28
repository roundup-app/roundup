use super::*;
use crate::route::{policy::Gate, require_attested};

fn conn() -> Conn {
    let (events, _) = mpsc::unbounded_channel();
    Conn {
        attested: false,
        actor: Actor::user(),
        peer: None,
        events,
        output: None,
    }
}

async fn attest(daemon: &Daemon, conn: &mut Conn, secret: &str) -> Result<Value, RpcError> {
    daemon
        .route(conn, "app.attest", json!({ "secret": secret }))
        .await
}

fn started(secret: &str) -> (tempfile::TempDir, Daemon) {
    let dir = tempfile::tempdir().unwrap();
    let daemon = crate::tests::daemon_in(dir.path());
    daemon.set_attest_secret(secret);
    (dir, daemon)
}

#[tokio::test]
async fn ep1_an_attested_connection_reaches_an_attested_method() {
    let (_dir, daemon) = started("aa11");
    let mut conn = conn();
    assert_eq!(
        require_attested(Gate::Attested, &conn).unwrap_err().code,
        rpc::code::FORBIDDEN
    );
    attest(&daemon, &mut conn, "aa11").await.unwrap();
    require_attested(Gate::Attested, &conn).unwrap();
}

#[tokio::test]
async fn ep1_no_secret_a_wrong_one_or_an_old_one_is_forbidden() {
    let (_dir, daemon) = started("n3w");
    let mut conn = conn();
    // "0ld" is what the previous start wrote.
    for secret in ["", "wrong", "0ld"] {
        let refused = attest(&daemon, &mut conn, secret).await.unwrap_err();
        assert_eq!(refused.code, rpc::code::FORBIDDEN, "{secret:?}");
        assert!(
            require_attested(Gate::Attested, &conn).is_err(),
            "{secret:?}"
        );
    }
    let dir = tempfile::tempdir().unwrap();
    let unstarted = crate::tests::daemon_in(dir.path());
    let refused = attest(&unstarted, &mut conn, "").await.unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    attest(&daemon, &mut conn, "n3w").await.unwrap();
    require_attested(Gate::Attested, &conn).unwrap();
}

#[tokio::test]
async fn ep2_identify_refuses_a_user_claim() {
    let (_dir, daemon) = started("aa11");
    let claim = |kind: &str| json!({"actor": {"kind": kind, "id": "x", "parent": null}});
    let mut conn = conn();
    daemon
        .route(&mut conn, "daemon.identify", claim("agent"))
        .await
        .unwrap();
    let refused = daemon
        .route(&mut conn, "daemon.identify", claim("user"))
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    assert_eq!(conn.actor.kind, ActorKind::Agent);
    daemon
        .route(&mut conn, "daemon.identify", claim("ext"))
        .await
        .unwrap();
    assert_eq!(conn.actor.kind, ActorKind::Ext);
    let mut fresh = self::conn();
    let refused = daemon
        .route(&mut fresh, "daemon.identify", claim("user"))
        .await
        .unwrap_err();
    assert_eq!(refused.code, rpc::code::FORBIDDEN);
    assert_eq!(fresh.actor, Actor::user());
}
