use super::tests::{entries, rail, sources};
use super::*;

#[test]
fn al1_a_digest_entry_carries_the_agents_link() {
    let nodes = rail();
    let mut from = sources(&nodes, &[], &[], &[]);
    from.project_key = "shark tank-0123";
    let m = Actor {
        kind: ActorKind::Agent,
        id: "m".into(),
        parent: None,
    };
    let digest = Seen::default().ask(&m, "m", &from).unwrap();
    let link = "roundup://agent/a?project=shark%20tank-0123";
    let entry = entries(&digest.children)[0];
    assert_eq!(entry.link.as_deref(), Some(link));
    let text = entry_text(entry);
    let head = text.lines().next().unwrap();
    assert!(
        head.starts_with("a-name is ") && head.ends_with(&format!("({link})")),
        "{head}"
    );
    let rest: Vec<&str> = text.lines().skip(1).collect();
    assert_eq!(super::parse_entry(head, &rest).as_ref(), Some(entry));
}
