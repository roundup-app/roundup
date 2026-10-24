//! The tools whose input the shim fills or reshapes, each built beside its reason.
use super::*;

/// E4: `agent.context` takes `{id}`; the shim fills it, so the Agent's tool takes no input.
pub(super) fn agent_context() -> Offered {
    Offered {
        own_id: true,
        ..offered_without_params(
            "agent.context",
            "Ask where you stand now: whom you report to, whom to ask, your peers, your open Todos and the Models you may start a child on.",
        )
    }
}

/// B20: `agent.digest` takes `{id}`; the shim fills it, so a Door's tool takes no input.
pub(super) fn agent_digest() -> Offered {
    Offered {
        own_id: true,
        door_only: true,
        ..offered_without_params(
            "agent.digest",
            "Ask what each of your direct children did: its Kind, its last line, its open Todos and the Pads it wrote since you were last told.",
        )
    }
}

/// M10: only a Door writes a Checkpoint.
pub(super) fn checkpoint_write() -> Offered {
    Offered {
        door_only: true,
        ..offered::<checkpoint::WriteParams>(
            "checkpoint.write",
            "Write a Checkpoint: a short card of facts for the user, with a title and one to eight Blocks (rows, table, diagram or text) you choose to suit what happened.",
        )
    }
}

/// B41: ask to be woken when named Agents finish. The caller is the Agent itself, so `id` is not a parameter.
pub(super) fn agent_wake() -> Offered {
    offered::<agent::WakeParams>(
        "agent.wake",
        "Ask to be woken when all, or with `any` the first, of the named Agents finish (idle, done, error or needs-you). Returns at once with `{id, fired}`, and `why` when it did not fire; then end your turn instead of polling. You get one note with each Agent's Kind and last words, and the request is gone.",
    )
}

/// O4, U2773c: the shim fixes the target to the caller's own id while preserving
/// the Order and optional captured base.
pub(super) fn agent_set_order() -> Offered {
    with_own_id::<agent::SetOrderParams>(
        "agent.setOrder",
        "agent_set_order",
        "Replace your own order: a Work order once the ask is clear, or a Clarification order while a question is open.",
    )
}

/// A32: a Door's answer to the clear of its Workstream.
pub(super) fn workstream_handoff() -> Offered {
    with_own_id::<workstream::HandoffParams>(
        "workstream.handoff",
        "workstream_handoff",
        "Hand off your Workstream when the user clears it: what happened and why, and the Todos and Pads to keep. Keep only what the user's own words clearly asked for from the start.",
    )
}

/// A35: a Door's rewind of its children, in two steps: read the plan, then rewind. The shim fills
/// `id` with the Door's own id. Both wait for the user when a selected child is in Takeover.
pub(super) fn workstream_rewind_plan() -> Offered {
    Offered {
        waits_for_user: true,
        ..with_own_id::<workstream::RewindPlanParams>(
            "workstream.rewindPlan",
            "workstream_rewindPlan",
            "Read what rewinding your Workstream to one of your Checkpoints would do, changing nothing: for each child (one named by `agent`, or all), whether it started after the Checkpoint and so would leave the Rail, and the files changed since. A child the user holds in Takeover makes the read wait until the user gives it back.",
        )
    }
}

/// A35: the Door's rewind. `files` is required, and nothing but the conversations changes on `keep`.
pub(super) fn workstream_rewind() -> Offered {
    Offered {
        waits_for_user: true,
        ..with_own_id::<workstream::RewindParams>(
            "workstream.rewind",
            "workstream_rewind",
            "Rewind one child (`agent`) or every child of your Workstream to a Checkpoint you wrote. The turns after it leave each rewound Agent's context. `files` is `keep` to leave every file as it is, or `restore` to return each Worktree to its state at the Checkpoint; commits, pushes and Issues are never undone. A child that started after the Checkpoint leaves the Rail and keeps its Worktree. A child the user holds in Takeover waits, and its entry says so; read agent_actionHistory for its outcome.",
        )
    }
}

/// F8, M16: the Bubble rule every Terminal-starting tool's description states, as the Brief does.
macro_rules! bubble_rule {
    () => {
        " Use your own tools for commands; open a Bubble only when the user needs to see its output or will interactively type into it. Routine builds, tests and inspection use your own tools."
    };
}

/// F3, A26: the tool every Agent is offered; its child sits under it.
pub(super) fn agent_spawn() -> Offered {
    offered::<agent::SpawnParams>(
        "agent.spawn",
        "Start a child Agent in a folder of this Project. Put a `title` of at most six words, the one-sentence ask, the done condition and the limits in `order`, and the working detail in `prompt`; a `prompt` without an `order` is refused. Name the child after its task. The child's Home is you.",
    )
}

/// LC7: the names a Door may give a child, by kind.
pub(super) fn agent_extras() -> Offered {
    Offered {
        door_only: true,
        ..offered_without_params(
            "agent.extras",
            "List the skills, plugins and MCP servers of the user's setup that `agent_spawn`'s `extras` and `agent_extras_add` accept.",
        )
    }
}

/// LC8: add extras to a running child.
pub(super) fn agent_extras_add() -> Offered {
    Offered {
        door_only: true,
        ..offered::<agent::ExtrasAddParams>(
            "agent.extras_add",
            "Give a running child of yours skills, plugins or MCP servers by name. The child is stopped and relaunched with its conversation; an unknown name fails and the child keeps running.",
        )
    }
}
