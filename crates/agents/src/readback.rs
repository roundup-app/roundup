//! RB1 to RB8: a fresh model reads the Agent's diff and writes the overview, the flows and the
//! gaps. Only `agent.readbackStart` starts a run; the Daemon holds its state, so closing the view
//! cancels nothing.

use super::*;
use crate::worktree::{DiffInput, Hunk};
use contracts::agent::{
    Account, CallPathsAnswer, CompareTarget, FlowSource, Gap, Gaps, ModuleNote, ReadFlow,
    ReadFlowStep, Readback,
};
use serde::Deserialize;
use serde_json::json;

/// RB8: a diff over either figure fails and says so.
const MAX_BYTES: usize = 256 * 1024;
const MAX_HUNKS: usize = 400;

const ACCOUNT_SYSTEM: &str = "You read a code change and write a readback of it. Your input is \
JSON: `hunks` (each {id, path, text}) and `flows` (call paths already read from the code, each \
{id, entry, hunks}: hunk ids in call order). Reply with one JSON object and nothing else: \
{\"overview\": two or three sentences, \"diagram\": a small text diagram, one call per line as \
`A -> B` (a chain `A -> B -> C` is allowed), with a line `Before` or `After` starting each panel \
where the shape changed, \"flows\": [{\"id\", \"name\", \"steps\": [{\"note\", \
\"hunks\": [hunk ids]}]}], \"modules\": [{\"module\", \"account\"}]}. Keep each given flow under \
its id with exactly its hunks in its order; you may add flows under new ids. Use only hunk ids \
from the input.";

const GAPS_SYSTEM: &str = "You compare a readback of a code change with what its author said it \
did. Your input is JSON: `account` (the readback), `hunks` (each {id, path, text}) and \
`last_message` (the author's words). Reply with one JSON object and nothing else: {\"gaps\": \
[{\"path\", \"said\": a fragment of the author's words, \"quote\": a fragment of one line the \
diff holds at that path}]}, one entry where the diff disagrees with what the author said it \
did. An empty list when it does not.";

/// What the Daemon keeps of one `(Agent, to)` readback (RB7).
enum Entry {
    Reading,
    Done {
        signature: Signature,
        account: Account,
    },
    Failed {
        kind: &'static str,
        cause: String,
    },
}

/// The Daemon's readbacks in memory, and the last call paths it saw done (RB1).
#[derive(Default)]
pub(crate) struct Readbacks {
    runs: Mutex<HashMap<(String, &'static str), Entry>>,
    traces: Mutex<HashMap<(String, &'static str), Trace>>,
    /// Traces running per `(Agent, to)`: while any runs, no kept trace is read (RB9).
    tracing: Arc<Mutex<HashMap<(String, &'static str), usize>>>,
}

type Signature = Vec<(String, Option<String>)>;

/// A done trace and the signature of the diff it started on.
struct Trace {
    signature: Signature,
    answer: Arc<CallPathsAnswer>,
}

/// A trace in flight; dropping it, finished or cancelled, ends it.
pub(crate) struct Tracing {
    tracing: Arc<Mutex<HashMap<(String, &'static str), usize>>>,
    key: (String, &'static str),
}

impl Drop for Tracing {
    fn drop(&mut self) {
        let mut tracing = self.tracing.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(count) = tracing.get_mut(&self.key) {
            *count -= 1;
            if *count == 0 {
                tracing.remove(&self.key);
            }
        }
    }
}

fn key(id: &str, to: CompareTarget) -> (String, &'static str) {
    (
        id.to_owned(),
        if to == CompareTarget::Tree {
            "tree"
        } else {
            "branch"
        },
    )
}

impl Readbacks {
    /// RB9: a trace starts; the kept one is dropped and none is read until this one ends.
    pub(crate) fn trace_started(&self, id: &str, to: CompareTarget) -> Tracing {
        let key = key(id, to);
        self.traces
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&key);
        *self
            .tracing
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .entry(key.clone())
            .or_default() += 1;
        Tracing {
            tracing: Arc::clone(&self.tracing),
            key,
        }
    }

    /// The call paths of a trace that finished on the diff `signature`: kept for the next run
    /// (RB1), and dropped when a later trace has no answer.
    pub(crate) fn traced(
        &self,
        id: &str,
        to: CompareTarget,
        signature: Signature,
        answer: &CallPathsAnswer,
    ) {
        let mut traces = self.traces.lock().unwrap_or_else(|e| e.into_inner());
        match answer {
            CallPathsAnswer::Done { .. } => traces.insert(
                key(id, to),
                Trace {
                    signature,
                    answer: Arc::new(answer.clone()),
                },
            ),
            _ => traces.remove(&key(id, to)),
        };
    }

    /// RB9: the kept trace, when none runs and it read the diff as it now stands.
    fn flows_for(
        &self,
        key: &(String, &'static str),
        signature: &Signature,
    ) -> Option<Arc<CallPathsAnswer>> {
        let running = self.tracing.lock().unwrap_or_else(|e| e.into_inner());
        if running.contains_key(key) {
            return None;
        }
        let traces = self.traces.lock().unwrap_or_else(|e| e.into_inner());
        let trace = traces.get(key)?;
        (trace.signature == *signature).then(|| Arc::clone(&trace.answer))
    }

    fn set(&self, key: (String, &'static str), entry: Entry) {
        self.runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(key, entry);
    }
}

/// A flow the code found: its id, entry function and the hunk ids it holds in call order.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub(crate) struct CodeFlow {
    id: String,
    entry: String,
    hunks: Vec<String>,
}

/// RB1: the done flows, each node mapped to the hunks of its symbol's new-side span, in call order.
fn code_flows(done: &CallPathsAnswer, hunks: &[Hunk]) -> Vec<CodeFlow> {
    let CallPathsAnswer::Done { symbols, flows, .. } = done else {
        return vec![];
    };
    let mut out = Vec::new();
    for flow in flows {
        let mut ids: Vec<String> = Vec::new();
        let mut stack = vec![&flow.tree];
        while let Some(node) = stack.pop() {
            stack.extend(node.calls.iter().rev());
            let Some(span) = symbols
                .iter()
                .find(|symbol| symbol.key == node.key)
                .and_then(|symbol| Some((&symbol.path, symbol.new?)))
            else {
                continue;
            };
            for hunk in hunks.iter().filter(|hunk| {
                hunk.path == *span.0
                    && hunk.new_start <= span.1.end
                    && hunk.new_start + hunk.new_len.max(1) > span.1.start
            }) {
                if !ids.contains(&hunk.id) {
                    ids.push(hunk.id.clone());
                }
            }
        }
        if !ids.is_empty() {
            out.push(CodeFlow {
                id: format!("code-{}", out.len() + 1),
                entry: symbols
                    .iter()
                    .find(|symbol| symbol.key == flow.entry)
                    .map_or_else(|| flow.entry.clone(), |symbol| symbol.name.clone()),
                hunks: ids,
            });
        }
    }
    out
}

#[derive(Deserialize)]
struct RawFlow {
    id: String,
    name: String,
    steps: Vec<ReadFlowStep>,
}

#[derive(Deserialize)]
struct RawAccount {
    overview: String,
    diagram: String,
    flows: Vec<RawFlow>,
    modules: Vec<ModuleNote>,
}

#[derive(Deserialize)]
struct RawGap {
    path: String,
    said: String,
    quote: String,
}

fn json_in<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, String> {
    let object = text
        .find('{')
        .zip(text.rfind('}'))
        .map(|(start, end)| &text[start..=end])
        .unwrap_or(text);
    serde_json::from_str(object).map_err(|err| err.to_string())
}

/// RB3: the answer in the fixed shape, with `unplaced` computed here; refused with a cause when
/// it names a hunk the input lacks, or drops, moves or reorders a code flow's hunks.
fn account(text: &str, hunks: &[Hunk], code: &[CodeFlow]) -> Result<Account, String> {
    let raw: RawAccount =
        json_in(text).map_err(|err| format!("the answer is not a readback: {err}"))?;
    let mut flows = Vec::new();
    let mut placed = std::collections::HashSet::new();
    for flow in raw.flows {
        if flows.iter().any(|seen: &ReadFlow| seen.id == flow.id) {
            return Err(format!("flow {} appears twice", flow.id));
        }
        let mut ordered: Vec<&str> = Vec::new();
        for id in flow.steps.iter().flat_map(|step| &step.hunks) {
            if !hunks.iter().any(|hunk| hunk.id == *id) {
                return Err(format!("hunk {id} is in no part of the diff"));
            }
            if !ordered.contains(&id.as_str()) {
                ordered.push(id);
            }
            placed.insert(id.clone());
        }
        let source = match code.iter().find(|given| given.id == flow.id) {
            Some(given) if given.hunks != ordered => {
                return Err(format!(
                    "flow {} moves or reorders the hunks the code found for it",
                    flow.id
                ));
            }
            Some(_) => FlowSource::Code,
            None => FlowSource::Readback,
        };
        flows.push(ReadFlow {
            id: flow.id,
            name: flow.name,
            source,
            steps: flow.steps,
        });
    }
    if let Some(missing) = code
        .iter()
        .find(|given| flows.iter().all(|flow| flow.id != given.id))
    {
        return Err(format!("flow {} of the code is missing", missing.id));
    }
    Ok(Account {
        overview: raw.overview,
        diagram: raw.diagram,
        flows,
        modules: raw.modules,
        unplaced: hunks
            .iter()
            .filter(|h| !placed.contains(&h.id))
            .map(|h| h.id.clone())
            .collect(),
        gaps: Gaps::Found(vec![]),
    })
}

/// RB4: the new-side line of the first line of `path`'s hunks that holds `quote`.
fn line_of(hunks: &[Hunk], path: &str, quote: &str) -> Option<u32> {
    for hunk in hunks.iter().filter(|hunk| hunk.path == path) {
        let mut line = hunk.new_start;
        for text in hunk
            .text
            .lines()
            .skip(1)
            .filter(|text| !text.starts_with('\\'))
        {
            if text.get(1..).is_some_and(|body| body.contains(quote)) {
                return Some(line);
            }
            line += u32::from(!text.starts_with('-'));
        }
    }
    None
}

/// RB4: the gaps whose path and quote the diff holds; the others are dropped.
fn gaps(text: &str, hunks: &[Hunk]) -> Result<Vec<Gap>, String> {
    #[derive(Deserialize)]
    struct Raw {
        gaps: Vec<RawGap>,
    }
    let raw: Raw = json_in(text).map_err(|err| format!("the comparison is not in shape: {err}"))?;
    Ok(raw
        .gaps
        .into_iter()
        .filter(|gap| !gap.quote.is_empty())
        .filter_map(|gap| {
            let line = line_of(hunks, &gap.path, &gap.quote)?;
            Some(Gap {
                path: gap.path,
                said: gap.said,
                quote: gap.quote,
                line,
            })
        })
        .collect())
}

fn failed(kind: &'static str, cause: String) -> Entry {
    Entry::Failed { kind, cause }
}

fn state(entry: &Entry) -> Readback {
    match entry {
        Entry::Reading => Readback::Reading,
        Entry::Failed { kind, cause } => Readback::Failed {
            kind: (*kind).into(),
            cause: cause.clone(),
        },
        Entry::Done { account, .. } => Readback::Read(account.clone()),
    }
}

impl Agents {
    fn readback_worktree(&self, id: &str) -> Result<worktree::Worktree, RpcError> {
        let record = self.shared.node(id)?.worktree();
        let record =
            record.ok_or_else(|| RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")))?;
        Ok(worktree::Worktree::from(&record))
    }

    /// RB5, RB7: where the Readback of `(id, to)` stands; a read result whose diff has changed
    /// since the run started reads `stale`.
    pub(super) async fn readback(&self, id: &str, to: CompareTarget) -> Result<Readback, RpcError> {
        let worktree = self.readback_worktree(id)?;
        let key = key(id, to);
        let seen = {
            let runs = self
                .shared
                .readbacks
                .runs
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            match runs.get(&key) {
                None => return Ok(Readback::NotRead),
                Some(Entry::Done { signature, account }) => (signature.clone(), account.clone()),
                Some(other) => return Ok(state(other)),
            }
        };
        let git = self.shared.git.bounded();
        let now = tokio::task::spawn_blocking(move || git.changed_files(&worktree, to))
            .await
            .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())))??;
        let now: Vec<_> = now
            .files
            .into_iter()
            .map(|file| (file.path, file.blob))
            .collect();
        Ok(if now == seen.0 {
            Readback::Read(seen.1)
        } else {
            Readback::Stale(seen.1)
        })
    }

    /// RB2: start a run on the user's call and answer `reading` at once; one already reading is
    /// joined. A diff over the cap fails before any call is made (RB8).
    pub(super) async fn readback_start(
        &self,
        id: &str,
        to: CompareTarget,
    ) -> Result<Readback, RpcError> {
        let worktree = self.readback_worktree(id)?;
        let key = key(id, to);
        {
            let mut runs = self
                .shared
                .readbacks
                .runs
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if matches!(runs.get(&key), Some(Entry::Reading)) {
                return Ok(Readback::Reading);
            }
            runs.insert(key.clone(), Entry::Reading);
        }
        let git = self.shared.git.bounded();
        let input = tokio::task::spawn_blocking(move || git.diff_input(&worktree, to))
            .await
            .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())));
        let input = match input {
            Ok(Ok(input)) => input,
            Ok(Err(err)) | Err(err) => {
                self.shared
                    .readbacks
                    .set(key, failed("call", err.message.clone()));
                return Err(err);
            }
        };
        let bytes: usize = input.hunks.iter().map(|hunk| hunk.text.len()).sum();
        if input.hunks.len() > MAX_HUNKS || bytes > MAX_BYTES {
            let entry = failed(
                "tooLarge",
                format!(
                    "the diff has {} hunks and {} KiB; a readback reads at most {MAX_HUNKS} hunks and {} KiB",
                    input.hunks.len(),
                    bytes.div_ceil(1024),
                    MAX_BYTES / 1024
                ),
            );
            let answer = state(&entry);
            self.shared.readbacks.set(key, entry);
            return Ok(answer);
        }
        let pair = models::resolve(&self.project_models()?, Role::Readback, None, None);
        let call = self
            .shared
            .rail_view
            .launcher
            .readback_call(pair.model, pair.effort);
        let last_message = {
            let runs = self.shared.runs();
            match runs.agent(id).map(|agent| &agent.slot) {
                Some(Slot::Running(run)) => {
                    run.view().completed.as_deref().map(|done| done.3.clone())
                }
                _ => None,
            }
        };
        let flows = self
            .shared
            .readbacks
            .flows_for(&key, &input.signature)
            .map(|done| code_flows(&done, &input.hunks))
            .unwrap_or_default();
        let shared = Arc::clone(&self.shared);
        tokio::spawn(async move {
            let entry = run(&call, input, flows, last_message).await;
            shared.readbacks.set(key, entry);
        });
        Ok(Readback::Reading)
    }
}

/// RB1, RB4: step one writes the account from the hunks and the flows; step two compares it with
/// the Agent's last message, when there is one.
async fn run(
    call: &claude_code::ReadbackCall,
    input: DiffInput,
    flows: Vec<CodeFlow>,
    last_message: Option<String>,
) -> Entry {
    let hunks: Vec<_> = input
        .hunks
        .iter()
        .map(|hunk| json!({"id": hunk.id, "path": hunk.path, "text": hunk.text}))
        .collect();
    let stdin = json!({"hunks": hunks, "flows": flows}).to_string();
    let text = match call.read(ACCOUNT_SYSTEM, stdin.as_bytes()).await {
        Ok(text) => text,
        Err(cause) => return failed("call", cause),
    };
    let mut account = match account(&text, &input.hunks, &flows) {
        Ok(account) => account,
        Err(cause) => return failed("badAnswer", cause),
    };
    if let Some(said) = last_message.filter(|said| !said.trim().is_empty()) {
        let stdin = json!({"account": &account, "hunks": hunks, "last_message": said}).to_string();
        account.gaps = match call
            .read(GAPS_SYSTEM, stdin.as_bytes())
            .await
            .and_then(|text| gaps(&text, &input.hunks))
        {
            Ok(found) => Gaps::Found(found),
            Err(failed) => Gaps::Failed { failed },
        };
    }
    Entry::Done {
        signature: input.signature,
        account,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use contracts::agent::{CallStatus, ChangedSymbol, Flow, FlowNode, LineSpan};

    fn hunk(path: &str, n: u32, start: u32) -> Hunk {
        Hunk {
            id: format!("{path}#{n}"),
            path: path.into(),
            new_start: start,
            new_len: 2,
            text: String::new(),
        }
    }

    fn node(key: &str, calls: Vec<FlowNode>) -> FlowNode {
        FlowNode {
            key: key.into(),
            status: CallStatus::Changed,
            cycle: false,
            calls,
        }
    }

    fn symbol(key: &str, path: &str, start: u32, end: u32) -> ChangedSymbol {
        ChangedSymbol {
            key: key.into(),
            name: key.into(),
            kind: "function".into(),
            path: path.into(),
            old: None,
            new: Some(LineSpan { start, end }),
            status: CallStatus::Changed,
            callable: true,
        }
    }

    fn done() -> CallPathsAnswer {
        CallPathsAnswer::Done {
            symbols: vec![symbol("a", "a.rs", 1, 5), symbol("b", "b.rs", 10, 12)],
            calls: vec![],
            flows: vec![Flow {
                entry: "a".into(),
                tree: node("a", vec![node("b", vec![])]),
                capped: false,
            }],
            capped: false,
            old_side_resolved_through_new_dependencies: false,
            unresolved: vec![],
            directions: None,
        }
    }

    fn hunks() -> Vec<Hunk> {
        vec![hunk("a.rs", 1, 2), hunk("b.rs", 1, 10), hunk("c.rs", 1, 1)]
    }

    fn reply(flows: Value) -> String {
        json!({"overview": "o", "diagram": "d", "modules": [], "flows": flows}).to_string()
    }

    fn flow(id: &str, ids: &[&str]) -> Value {
        json!({"id": id, "name": id, "steps": [{"note": "n", "hunks": ids}]})
    }

    fn sig(blob: &str) -> Signature {
        vec![("a.rs".into(), Some(blob.into()))]
    }

    #[test]
    fn rb9_a_trace_of_an_older_diff_is_not_read() {
        let r = Readbacks::default();
        let k = key("a1", CompareTarget::Tree);
        r.traced("a1", CompareTarget::Tree, sig("old"), &done());
        assert!(r.flows_for(&k, &sig("old")).is_some());
        assert!(r.flows_for(&k, &sig("new")).is_none());
    }

    #[test]
    fn rb9_a_trace_in_flight_leaves_no_flows() {
        let r = Readbacks::default();
        let k = key("a1", CompareTarget::Tree);
        r.traced("a1", CompareTarget::Tree, sig("s"), &done());
        let running = r.trace_started("a1", CompareTarget::Tree);
        assert!(r.flows_for(&k, &sig("s")).is_none());
        drop(running);
        assert!(r.flows_for(&k, &sig("s")).is_none());
        r.traced("a1", CompareTarget::Tree, sig("s"), &done());
        assert!(r.flows_for(&k, &sig("s")).is_some());
    }

    #[test]
    fn rb3_a_result_that_moves_or_reorders_a_code_flow_is_refused() {
        let code = code_flows(&done(), &hunks());
        assert_eq!(code[0].hunks, ["a.rs#1", "b.rs#1"]);
        let id = &code[0].id;

        let kept = account(
            &reply(json!([flow(id, &["a.rs#1", "b.rs#1"])])),
            &hunks(),
            &code,
        )
        .unwrap();
        assert_eq!(kept.flows[0].source, FlowSource::Code);
        assert_eq!(kept.unplaced, ["c.rs#1"]);
        for bad in [
            vec!["b.rs#1", "a.rs#1"],
            vec!["a.rs#1"],
            vec!["a.rs#1", "b.rs#1", "c.rs#1"],
        ] {
            let cause = account(&reply(json!([flow(id, &bad)])), &hunks(), &code).unwrap_err();
            assert!(cause.contains(id.as_str()), "{cause}");
        }
        let dropped = account(&reply(json!([])), &hunks(), &code).unwrap_err();
        assert!(dropped.contains(id.as_str()), "{dropped}");
    }

    #[test]
    fn rb3_with_no_code_flows_every_flow_is_its_own() {
        let kept = account(&reply(json!([flow("code-1", &["c.rs#1"])])), &hunks(), &[]).unwrap();
        assert_eq!(kept.flows[0].source, FlowSource::Readback);
    }
}
