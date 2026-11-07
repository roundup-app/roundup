use std::sync::Arc;

use contracts::Actor;

use crate::agent::Runs;
use crate::id::AgentId;
use crate::tests::*;

#[tokio::test]
async fn u177_a_door_attempt_awaits_its_channel_until_it_is_up_or_missing() {
    for (door, mcp, settled, awaiting) in [
        (true, true, None, true),
        (true, true, Some(contracts::agent::Channel::Up), false),
        (true, true, Some(contracts::agent::Channel::Missing), false),
        (false, true, None, false),
        (true, false, None, false),
    ] {
        let watched = Watched::named();
        let shared = &watched.shared;
        let id = {
            let mut rail = shared.rail();
            let kind = if door {
                contracts::agent::NodeKind::Workstream
            } else {
                contracts::agent::NodeKind::Agent
            };
            let node = rail.insert(kind, "d", None, None).unwrap();
            rail.set_mcp(&contracts::project::Mcp { on: mcp }).unwrap();
            node.id
        };
        let run = shared.runs().forget("7013").unwrap();
        shared.runs().insert(AgentId::parse(&id).unwrap(), run);
        if let Some(channel) = settled {
            shared.set_channel(Actor::daemon(), &id, "1", channel);
        }
        let agents = crate::Agents {
            shared: Arc::clone(shared),
            dir: watched._dir.path().to_owned(),
            launcher: crate::Launcher::new(
                "claude",
                watched._dir.path().join("claude.json"),
                watched._dir.path().join("rup"),
                None,
            ),
            forked: false,
        };
        assert_eq!(
            agents.awaiting_channel(&id),
            awaiting,
            "{door} {mcp} {settled:?}"
        );
    }
}
