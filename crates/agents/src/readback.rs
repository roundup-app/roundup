//! RB1 to RB8: a fresh model reads the Agent's diff and writes the overview, the flows and the
//! gaps. Only `agent.readbackStart` starts a run; the Daemon holds its state, so closing the view
//! cancels nothing. RB13 to RB15: `agent.explain` has the same reader explain selected lines.

use super::*;
use crate::explain::selected;
use crate::worktree::{DiffInput, Hunk};
use contracts::agent::{
    Account, CallPathsAnswer, CompareTarget, DiagramStop, DiffSide, FlowSource, Gap, Gaps,
    HunkRank, LineExplanation, ModuleNote, OwnedGroupKey, Rank, ReadFlow, ReadFlowStep, Readback,
    Risk, RiskLevel, RiskTarget,
};
use serde::Deserialize;
use serde_json::json;

/// RB16: the most explanations a result keeps: an explanation of every line is not wanted.
const MAX_EXPLANATIONS: usize = 12;

/// RB21: the most stops a result keeps.
const MAX_STOPS: usize = 12;

/// RB8: a diff over either figure fails and says so.
const MAX_BYTES: usize = 256 * 1024;
const MAX_HUNKS: usize = 400;

/// RB8, RB15: why a diff is too large to read, in words naming the cap; none when it is under it.
pub(super) fn over_cap(hunks: &[Hunk]) -> Option<String> {
    let bytes: usize = hunks.iter().map(|hunk| hunk.text.len()).sum();
    (hunks.len() > MAX_HUNKS || bytes > MAX_BYTES).then(|| {
        format!(
            "the diff has {} hunks and {} KiB; a readback reads at most {MAX_HUNKS} hunks and {} KiB",
            hunks.len(),
            bytes.div_ceil(1024),
            MAX_BYTES / 1024
        )
    })
}

/// The one format of a diagram's text, which `parseDiagram` (the App) reads: the readback and an
/// explanation ask for it the same way.
macro_rules! diagram_format {
    () => {
        "one call per line as `A -> B` (a chain `A -> B -> C` is allowed), with a line `Before` or `After` starting each panel where the shape changed"
    };
}
pub(crate) use diagram_format;

const ACCOUNT_SYSTEM: &str = concat!(
    "You read a code change and write a readback of it. Your input is \
JSON: `hunks` (each {id, path, text}) and `flows` (call paths already read from the code, each \
{id, entry, hunks}: hunk ids in call order). Reply with one JSON object and nothing else: \
{\"overview\": two or three sentences, \"diagram\": a small text diagram, ",
    diagram_format!(),
    ", \"flows\": [{\"id\", \"name\", \"steps\": [{\"note\", \
\"hunks\": [hunk ids]}]}], \"modules\": [{\"module\", \"account\"}], \"ranks\": [{\"hunk\": hunk id, \"rank\": \"core\" \
(the change itself), \"forced\" (what it forces elsewhere: a caller, a type, a migration) or \
\"glue\" (wiring, plumbing, re-exports, renames)}] with one entry for every hunk id, \"risks\": \
[{\"target\": \"flow\" or \"module\", \"id\": the flow id or the module name, \"level\": \"high\", \
\"medium\" or \"low\", \"reason\": one sentence}] with one entry for every flow and every module, \
\"explanations\": [{\"hunk\": hunk id, \"start\", \"end\": line numbers of the new side inside \
that hunk, \"text\": one or two sentences}] for the few places a reviewer most needs a reason, at \
most twelve, never one for every line, \"stops\": [{\"part\": a part the diagram names, \
\"text\": one sentence}] in the order a reader should walk the diagram, at most twelve, none when \
the diagram holds no call}. Judge rank and risk from what the change does, never from a file name or size. Keep each given flow under \
its id with exactly its hunks in its order; you may add flows under new ids. Use only hunk ids \
from the input."
);

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
        account: Box<Account>,
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

/// A Readback or a trace is kept per Agent and target, and per group when one is read (U7955a).
fn key(id: &str, group: Option<&OwnedGroupKey>, to: CompareTarget) -> (String, &'static str) {
    (
        match group {
            Some(group) => format!("{id}\0{}\0{}", group.repo, group.branch),
            None => id.to_owned(),
        },
        if to == CompareTarget::Tree {
            "tree"
        } else {
            "branch"
        },
    )
}

impl Readbacks {
    /// RB9: a trace starts; the kept one is dropped and none is read until this one ends.
    pub(crate) fn trace_started(
        &self,
        id: &str,
        group: Option<&OwnedGroupKey>,
        to: CompareTarget,
    ) -> Tracing {
        let key = key(id, group, to);
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
        group: Option<&OwnedGroupKey>,
        to: CompareTarget,
        signature: Signature,
        answer: &CallPathsAnswer,
    ) {
        let mut traces = self.traces.lock().unwrap_or_else(|e| e.into_inner());
        match answer {
            CallPathsAnswer::Done { .. } => traces.insert(
                key(id, group, to),
                Trace {
                    signature,
                    answer: Arc::new(answer.clone()),
                },
            ),
            _ => traces.remove(&key(id, group, to)),
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
    ranks: Vec<RawRank>,
    risks: Vec<RawRisk>,
    #[serde(default)]
    explanations: Vec<RawExplanation>,
    #[serde(default)]
    stops: Vec<RawStop>,
}

#[derive(Deserialize)]
struct RawStop {
    #[serde(default)]
    part: String,
    #[serde(default)]
    text: String,
}

#[derive(Deserialize)]
struct RawRank {
    hunk: String,
    rank: String,
}

#[derive(Deserialize)]
struct RawRisk {
    target: String,
    id: String,
    level: String,
    reason: String,
}

#[derive(Deserialize)]
struct RawExplanation {
    hunk: String,
    start: u32,
    end: u32,
    text: String,
}

#[derive(Deserialize)]
struct RawGap {
    path: String,
    said: String,
    quote: String,
}

pub(crate) fn json_in<T: for<'de> Deserialize<'de>>(text: &str) -> Result<T, String> {
    let object = text
        .find('{')
        .zip(text.rfind('}'))
        .map(|(start, end)| &text[start..=end])
        .unwrap_or(text);
    serde_json::from_str(object).map_err(|err| err.to_string())
}

/// RB10: one rank for every hunk id of the input, and no other; refused naming the hunk.
fn ranks(raw: Vec<RawRank>, hunks: &[Hunk]) -> Result<Vec<HunkRank>, String> {
    let mut out: Vec<HunkRank> = Vec::new();
    for given in raw {
        if !hunks.iter().any(|hunk| hunk.id == given.hunk) {
            return Err(format!(
                "rank for hunk {} which is in no part of the diff",
                given.hunk
            ));
        }
        let rank = match given.rank.as_str() {
            "core" => Rank::Core,
            "forced" => Rank::Forced,
            "glue" => Rank::Glue,
            other => {
                return Err(format!(
                    "hunk {} has rank {other:?}, not core, forced or glue",
                    given.hunk
                ));
            }
        };
        match out.iter().find(|seen| seen.hunk == given.hunk) {
            Some(seen) if seen.rank != rank => {
                return Err(format!("hunk {} has two different ranks", given.hunk));
            }
            Some(_) => {}
            None => out.push(HunkRank {
                hunk: given.hunk,
                rank,
            }),
        }
    }
    match hunks
        .iter()
        .find(|hunk| out.iter().all(|rank| rank.hunk != hunk.id))
    {
        Some(hunk) => Err(format!("hunk {} has no rank", hunk.id)),
        None => Ok(out),
    }
}

/// RB11: one risk for every flow and every module, with a reason; refused naming it.
fn risks(
    raw: Vec<RawRisk>,
    flows: &[ReadFlow],
    modules: &[ModuleNote],
) -> Result<Vec<Risk>, String> {
    let mut out: Vec<Risk> = Vec::new();
    for given in raw {
        let target = match given.target.as_str() {
            "flow" if flows.iter().any(|flow| flow.id == given.id) => RiskTarget::Flow,
            "module" if modules.iter().any(|note| note.module == given.id) => RiskTarget::Module,
            "flow" | "module" => {
                return Err(format!(
                    "risk for {} {} which the readback does not name",
                    given.target, given.id
                ));
            }
            other => {
                return Err(format!(
                    "risk for {} has target {other:?}, not flow or module",
                    given.id
                ));
            }
        };
        let level = match given.level.as_str() {
            "high" => RiskLevel::High,
            "medium" => RiskLevel::Medium,
            "low" => RiskLevel::Low,
            other => {
                return Err(format!(
                    "{} {} has risk level {other:?}, not high, medium or low",
                    given.target, given.id
                ));
            }
        };
        if given.reason.trim().is_empty() {
            return Err(format!(
                "{} {} has a risk with no reason",
                given.target, given.id
            ));
        }
        if out
            .iter()
            .any(|seen| seen.target == target && seen.id == given.id)
        {
            return Err(format!("{} {} has two risks", given.target, given.id));
        }
        out.push(Risk {
            target,
            id: given.id,
            level,
            reason: given.reason,
        });
    }
    let missing = flows
        .iter()
        .map(|flow| (RiskTarget::Flow, "flow", flow.id.as_str()))
        .chain(
            modules
                .iter()
                .map(|note| (RiskTarget::Module, "module", note.module.as_str())),
        );
    for (target, word, id) in missing {
        if out
            .iter()
            .all(|seen| seen.target != target || seen.id != id)
        {
            return Err(format!("{word} {id} has no risk"));
        }
    }
    Ok(out)
}

/// RB16, RB19: the path and the text of lines `start` to `end` of hunk `id`, none unless the hunk
/// exists and those lines lie wholly in its new side.
pub(crate) fn placed(hunks: &[Hunk], id: &str, start: u32, end: u32) -> Option<(String, String)> {
    let hunk = hunks.iter().find(|hunk| hunk.id == id)?;
    let want = u64::from(end).checked_sub(u64::from(start))? + 1;
    let lines = selected(
        std::slice::from_ref(hunk),
        &hunk.path,
        DiffSide::New,
        start,
        end,
    );
    (u64::try_from(lines.len()) == Ok(want)).then(|| (hunk.path.clone(), lines.join("\n")))
}

/// RB16: the explanations the diff holds, at most twelve: the hunk exists, the lines lie wholly in
/// that hunk's new side and the text is not empty; the others are dropped.
fn explanations(raw: Vec<RawExplanation>, hunks: &[Hunk]) -> Vec<LineExplanation> {
    raw.into_iter()
        .filter_map(|given| {
            let (path, source) = placed(hunks, &given.hunk, given.start, given.end)?;
            (!given.text.trim().is_empty()).then(|| LineExplanation {
                path,
                start: given.start,
                end: given.end,
                source,
                text: given.text.trim().to_owned(),
            })
        })
        .take(MAX_EXPLANATIONS)
        .collect()
}

/// RB21: the stops in the order given, trimmed, without one that names no part or says nothing, at
/// most twelve. The diagram's text is the App's to read (RB3), so no part is checked against it here.
fn stops(raw: Vec<RawStop>) -> Vec<DiagramStop> {
    raw.into_iter()
        .filter_map(|given| {
            let (part, text) = (given.part.trim(), given.text.trim());
            (!part.is_empty() && !text.is_empty()).then(|| DiagramStop {
                part: part.to_owned(),
                text: text.to_owned(),
            })
        })
        .take(MAX_STOPS)
        .collect()
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
    let ranks = ranks(raw.ranks, hunks)?;
    let risks = risks(raw.risks, &flows, &raw.modules)?;
    Ok(Account {
        overview: raw.overview,
        diagram: raw.diagram,
        flows,
        modules: raw.modules,
        ranks,
        risks,
        explanations: explanations(raw.explanations, hunks),
        stops: stops(raw.stops),
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
        Entry::Done { account, .. } => Readback::Read(Account::clone(account)),
    }
}

impl Agents {
    /// The Worktree a read runs on: the Agent's own, or (U7955a) the checkout of `group`, which the
    /// Daemon finds from the Agent's recorded writes as `agent.compareFile` does.
    pub(super) async fn readback_worktree(
        &self,
        id: &str,
        group: Option<OwnedGroupKey>,
        to: CompareTarget,
    ) -> Result<worktree::Worktree, RpcError> {
        let Some(group) = group else {
            let record = self.shared.node(id)?.worktree();
            let record = record
                .ok_or_else(|| RpcError::new(code::NOT_FOUND, format!("no_worktree: {id}")))?;
            return Ok(worktree::Worktree::from(&record));
        };
        let edits = self.recorded_edits(id)?;
        let git = self.shared.git.bounded();
        tokio::task::spawn_blocking(move || git.group_worktree(&edits, &group, to))
            .await
            .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())))?
    }

    /// RB1: the diff of `worktree` against `to`, read off the async threads.
    pub(super) async fn readback_diff(
        &self,
        worktree: worktree::Worktree,
        to: CompareTarget,
    ) -> Result<DiffInput, RpcError> {
        let git = self.shared.git.bounded();
        tokio::task::spawn_blocking(move || git.diff_input(&worktree, to))
            .await
            .map_err(|err| RpcError::from(worktree::WorktreeError::Failed(err.to_string())))?
    }

    /// P8: the call of the `readback` Role's Model and Effort.
    pub(super) fn readback_reader(&self) -> Result<claude_code::ReadbackCall, RpcError> {
        let pair = models::resolve(&self.project_models()?, Role::Readback, None, None);
        Ok(self
            .shared
            .rail_view
            .launcher
            .readback_call(pair.model, pair.effort))
    }

    /// RB5, RB7: where the Readback of `(id, to)` stands; a read result whose diff has changed
    /// since the run started reads `stale`.
    pub(super) async fn readback(
        &self,
        id: &str,
        group: Option<OwnedGroupKey>,
        to: CompareTarget,
    ) -> Result<Readback, RpcError> {
        let worktree = self.readback_worktree(id, group.clone(), to).await?;
        let key = key(id, group.as_ref(), to);
        let seen = {
            let runs = self
                .shared
                .readbacks
                .runs
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            match runs.get(&key) {
                None => return Ok(Readback::NotRead),
                Some(Entry::Done { signature, account }) => {
                    (signature.clone(), Account::clone(account))
                }
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
        group: Option<OwnedGroupKey>,
        to: CompareTarget,
        skill: Option<&str>,
    ) -> Result<Readback, RpcError> {
        let worktree = self.readback_worktree(id, group.clone(), to).await?;
        let key = key(id, group.as_ref(), to);
        let lens = match skill {
            None => None,
            Some(name) => match self.shared.rail_view.launcher.skill_body(
                &worktree.path,
                self.project_dir(),
                name,
            ) {
                Some(body) => Some(body),
                None => {
                    // RS3: no run starts, and the kept result stays as it was.
                    return Ok(state(&failed(
                        "call",
                        format!("the Skill \"{name}\" is not one of this Agent's Skills"),
                    )));
                }
            },
        };
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
        let input = match self.readback_diff(worktree, to).await {
            Ok(input) => input,
            Err(err) => {
                self.shared
                    .readbacks
                    .set(key, failed("call", err.message.clone()));
                return Err(err);
            }
        };
        if let Some(cause) = over_cap(&input.hunks) {
            let entry = failed("tooLarge", cause);
            let answer = state(&entry);
            self.shared.readbacks.set(key, entry);
            return Ok(answer);
        }
        let call = self.readback_reader()?;
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
            let entry = run(&call, input, flows, last_message, lens.as_deref()).await;
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
    lens: Option<&str>,
) -> Entry {
    let hunks: Vec<_> = input
        .hunks
        .iter()
        .map(|hunk| json!({"id": hunk.id, "path": hunk.path, "text": hunk.text}))
        .collect();
    let stdin = json!({"hunks": hunks, "flows": flows}).to_string();
    let text = match call.read(ACCOUNT_SYSTEM, lens, stdin.as_bytes()).await {
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
            .read(GAPS_SYSTEM, None, stdin.as_bytes())
            .await
            .and_then(|text| gaps(&text, &input.hunks))
        {
            Ok(found) => Gaps::Found(found),
            Err(failed) => Gaps::Failed { failed },
        };
    }
    Entry::Done {
        signature: input.signature,
        account: Box::new(account),
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
        let ranks: Vec<_> = hunks()
            .iter()
            .map(|hunk| json!({"hunk": hunk.id, "rank": "core"}))
            .collect();
        let risks: Vec<_> = flows
            .as_array()
            .unwrap()
            .iter()
            .map(|flow| json!({"target": "flow", "id": flow["id"], "level": "low", "reason": "r."}))
            .collect();
        json!({"overview": "o", "diagram": "d", "modules": [], "flows": flows, "ranks": ranks, "risks": risks})
            .to_string()
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
        let k = key("a1", None, CompareTarget::Tree);
        r.traced("a1", None, CompareTarget::Tree, sig("old"), &done());
        assert!(r.flows_for(&k, &sig("old")).is_some());
        assert!(r.flows_for(&k, &sig("new")).is_none());
    }

    #[test]
    fn rb9_a_trace_in_flight_leaves_no_flows() {
        let r = Readbacks::default();
        let k = key("a1", None, CompareTarget::Tree);
        r.traced("a1", None, CompareTarget::Tree, sig("s"), &done());
        let running = r.trace_started("a1", None, CompareTarget::Tree);
        assert!(r.flows_for(&k, &sig("s")).is_none());
        drop(running);
        assert!(r.flows_for(&k, &sig("s")).is_none());
        r.traced("a1", None, CompareTarget::Tree, sig("s"), &done());
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
