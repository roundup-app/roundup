//! B5641: the Rail, Todos, Pads, Touches and Messages of a digest as event-local columns.

use std::collections::HashMap;

use contracts::ActorKind;
use contracts::agent::RailNode;
use contracts::message::Message;

use super::{Sources, cost, is_agent};

/// B5641: event-local columns replace the multiplied joins measured by the cost observer.
/// Payloads remain borrowed; no index survives the supplied Sources.
pub(super) struct Projection<'a> {
    pub(super) message_text: Vec<&'a Message>,
    pub(super) nodes: Vec<&'a RailNode>,
    pub(super) ids: HashMap<&'a str, usize>,
    pub(super) children: Vec<(usize, usize)>,
    pub(super) ranges: Vec<std::ops::Range<usize>>,
    pub(super) todos: Vec<u32>,
    pub(super) pad_names: Vec<&'a str>,
    pub(super) pad_times: Vec<i64>,
    pub(super) writers: Vec<(usize, usize)>,
    pub(super) messages: HashMap<(usize, &'a str), (u32, usize)>,
    // The greatest question time answers any turn-start lower bound, across all recipients.
    pub(super) questions: Vec<Option<i64>>,
    pub(super) completed: Vec<Option<&'a (String, i64, i64, String)>>,
    pub(super) project_key: &'a str,
}

impl<'a> Projection<'a> {
    pub(super) fn new(source: &'a Sources<'a>) -> Self {
        let mut nodes = Vec::new();
        let mut ids = HashMap::new();
        for node in source.nodes.iter().inspect(|_| cost(0)) {
            if is_agent(node) {
                ids.entry(node.id.as_str()).or_insert(nodes.len());
                nodes.push(node);
            }
        }
        let n = nodes.len();
        let mut children = Vec::new();
        for (index, node) in nodes.iter().enumerate() {
            if node.status.is_some()
                && let Some(parent) = node.parent.as_deref().and_then(|id| ids.get(id))
            {
                children.push((*parent, index));
            }
        }
        children.sort_unstable();
        let ranges = (0..n)
            .map(|parent| {
                children.partition_point(|&(p, _)| p < parent)
                    ..children.partition_point(|&(p, _)| p <= parent)
            })
            .collect();
        let mut todos = vec![0_u32; n];
        for todo in source.todos.iter().inspect(|_| cost(1)) {
            if !todo.done
                && todo.creator.kind == ActorKind::Agent
                && let Some(&index) = ids.get(todo.creator.id.as_str())
                && let Some(count) = todos.get_mut(index)
            {
                *count = count.saturating_add(1);
            }
        }
        let mut pad_names = Vec::with_capacity(source.pads.len());
        let mut pad_times = Vec::with_capacity(source.pads.len());
        let mut keys = Vec::with_capacity(source.pads.len());
        for pad in source.pads.iter().inspect(|_| cost(2)) {
            cost(6);
            keys.push((format!("pad:{}", pad.name), pad_times.len()));
            pad_names.push(pad.name.as_str());
            pad_times.push(pad.updated_at);
        }
        keys.sort_unstable();
        let mut writers = Vec::new();
        for touch in source.touches.iter().inspect(|_| cost(3)) {
            if touch.verb != contracts::Verb::Wrote {
                continue;
            }
            let Some(&writer) = ids.get(touch.actor.id.as_str()) else {
                continue;
            };
            let first = keys.partition_point(|(key, _)| key < &touch.item);
            for (_, pad) in keys
                .iter()
                .skip(first)
                .take_while(|(key, _)| key == &touch.item)
            {
                writers.push((writer, *pad));
            }
        }
        writers.sort_unstable();
        writers.dedup();
        // Pad index breaks timestamp ties in supplied Pad order, including the newest-four cut.
        writers.sort_unstable_by_key(|&(writer, pad)| (writer, pad_times.get(pad).copied(), pad));
        let mut messages: HashMap<(usize, &str), (u32, usize)> = HashMap::new();
        let mut message_text = Vec::new();
        let mut questions: Vec<Option<i64>> = vec![None; n];
        for message in source.messages.iter().inspect(|_| cost(4)) {
            if message.from.kind != ActorKind::Agent {
                continue;
            }
            let Some(&child) = ids.get(message.from.id.as_str()) else {
                continue;
            };
            if message.kind == contracts::message::MessageKind::Question
                && let Some(asked) = questions.get_mut(child)
            {
                *asked = Some(asked.map_or(message.at, |at| at.max(message.at)));
            }
            let candidate = messages
                .entry((child, message.to.as_str()))
                .or_insert_with(|| {
                    message_text.push(message);
                    (message.id, message_text.len() - 1)
                });
            if candidate.0 <= message.id {
                candidate.0 = message.id;
                if let Some(text) = message_text.get_mut(candidate.1) {
                    *text = message;
                }
            }
        }
        let mut completed = vec![None; n];
        for (id, text) in source.completed.iter().inspect(|_| cost(5)) {
            if let Some(&child) = ids.get(id.as_str())
                && let Some(slot) = completed.get_mut(child)
            {
                *slot = Some(text);
            }
        }
        Self {
            message_text,
            nodes,
            ids,
            children,
            ranges,
            todos,
            pad_names,
            pad_times,
            writers,
            messages,
            questions,
            completed,
            project_key: source.project_key,
        }
    }

    pub(super) fn node(&self, id: &str) -> Option<&'a RailNode> {
        self.ids
            .get(id)
            .and_then(|&index| self.nodes.get(index).copied())
    }

    pub(super) fn children(&self, id: &str) -> &[(usize, usize)] {
        self.ids
            .get(id)
            .and_then(|&index| self.ranges.get(index))
            .and_then(|range| self.children.get(range.clone()))
            .unwrap_or_default()
    }

    pub(super) fn pairs(&self) -> impl Iterator<Item = (&'a RailNode, &'a RailNode)> + '_ {
        self.children.iter().filter_map(|&(parent, child)| {
            Some((
                self.nodes.get(parent).copied()?,
                self.nodes.get(child).copied()?,
            ))
        })
    }

    pub(super) fn written(&self, child: &RailNode) -> &[(usize, usize)] {
        let Some(&index) = self.ids.get(child.id.as_str()) else {
            return &[];
        };
        let first = self.writers.partition_point(|&(writer, _)| writer < index);
        let end = self.writers.partition_point(|&(writer, _)| writer <= index);
        self.writers.get(first..end).unwrap_or_default()
    }

    pub(super) fn pad_time(&self, pad: usize) -> i64 {
        self.pad_times.get(pad).copied().unwrap_or(i64::MIN)
    }

    pub(super) fn pad_name(&self, pad: usize) -> &'a str {
        self.pad_names.get(pad).copied().unwrap_or_default()
    }

    /// The turn `child` last completed, from the Adapter.
    pub(super) fn completed_of(&self, child: &RailNode) -> Option<&'a (String, i64, i64, String)> {
        let &index = self.ids.get(child.id.as_str())?;
        self.completed.get(index).copied().flatten()
    }
}
