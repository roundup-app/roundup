//! A33: which Agents wait on an open blocker, from the Todos they created.

use std::collections::{BTreeSet, HashMap};
use std::sync::Arc;

use contracts::todo::Todo;
use contracts::{ActorKind, Event, EventData};
use tokio::sync::broadcast::{Receiver, error::RecvError};

/// For each Agent, the lowest open blocker among its own Todos that are open and `blocked`.
pub fn waits(todos: &[Todo]) -> HashMap<String, u32> {
    let open: BTreeSet<u32> = todos
        .iter()
        .filter(|todo| !todo.done)
        .map(|todo| todo.id)
        .collect();
    let mut waits: HashMap<String, u32> = HashMap::new();
    for todo in todos
        .iter()
        .filter(|todo| !todo.done && todo.blocked && todo.creator.kind == ActorKind::Agent)
    {
        if let Some(lowest) = todo.blockers.iter().filter(|id| open.contains(id)).min() {
            let entry = waits.entry(todo.creator.id.clone()).or_insert(*lowest);
            *entry = (*entry).min(*lowest);
        }
    }
    waits
}

fn is_todo_event(event: &Event) -> bool {
    matches!(
        event.data,
        EventData::TodoCreated(_)
            | EventData::TodoUpdated(_)
            | EventData::TodoUnblocked(_)
            | EventData::TodoDeleted(_)
    )
}

/// Tell `agents` what its Agents wait on at start and after each Todo event. `read` lists the
/// Todos; a lagged receiver reads them again.
pub async fn keep<F, Fut>(mut events: Receiver<Event>, agents: Arc<agents::Agents>, read: F)
where
    F: Fn() -> Fut,
    Fut: Future<Output = Option<Vec<Todo>>>,
{
    loop {
        if let Some(todos) = read().await {
            agents.set_waits(waits(&todos));
        }
        loop {
            match events.recv().await {
                Ok(event) if is_todo_event(&event) => break,
                Ok(_) => {}
                Err(RecvError::Lagged(_)) => break,
                Err(RecvError::Closed) => return,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use contracts::Actor;

    use super::*;

    fn todo(id: u32, creator: &str, done: bool, blockers: &[u32]) -> Todo {
        Todo {
            id,
            title: format!("todo {id}"),
            body: String::new(),
            done,
            blockers: blockers.to_vec(),
            blocked: false,
            created_at: 0,
            creator: Actor {
                kind: ActorKind::Agent,
                id: creator.into(),
                parent: None,
            },
            home: None,
            owner: None,
            refs: vec![],
        }
    }

    fn derived(mut todos: Vec<Todo>) -> Vec<Todo> {
        let open: Vec<u32> = todos.iter().filter(|t| !t.done).map(|t| t.id).collect();
        for todo in &mut todos {
            todo.blocked = todo.blockers.iter().any(|id| open.contains(id));
        }
        todos
    }

    #[test]
    fn a33_the_label_names_the_lowest_open_blocker() {
        let todos = derived(vec![
            todo(1, "x", true, &[]),
            todo(2, "x", false, &[]),
            todo(3, "x", false, &[]),
            todo(4, "a", false, &[3, 2, 1]),
            todo(5, "a", false, &[3]),
            todo(6, "b", false, &[]),
        ]);
        let waits = waits(&todos);
        assert_eq!(waits.get("a"), Some(&2));
        assert_eq!(waits.get("b"), None);
    }

    #[test]
    fn a33_a_done_or_deleted_todo_waits_on_nothing() {
        let done = derived(vec![todo(1, "x", false, &[]), todo(2, "a", true, &[1])]);
        assert!(waits(&done).is_empty());
        let deleted = derived(vec![todo(2, "a", false, &[1])]);
        assert!(waits(&deleted).is_empty());
    }
}
