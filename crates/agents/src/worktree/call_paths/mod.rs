//! CP1 to CP7: which calls an Agent's changes added, removed or changed, read from the
//! project's language server. Reads the repository only and leaves no process behind.

mod cache;
mod lsp;
mod server;
mod side;

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use contracts::agent::{
    Call, CallPathCause, CallPaths, CallPathsAnswer, CallStatus, ChangedSymbol, CompareTarget,
    Flow, FlowNode, FunctionCalls, LanguageRow, Languages, LineSpan,
};
use rpc::RpcError;

use super::{Git, Worktree, WorktreeError, failed};
use lsp::{Client, Stop};
use side::{Calls, RawCall, SideData};

/// CP5: one trace runs at a time.
static ONE_AT_A_TIME: Mutex<()> = Mutex::new(());

/// CP4: how deep a flow's tree follows calls.
const DEPTH: usize = 6;

/// The default time a trace has (CP5).
pub(super) const LIMIT: Duration = Duration::from_secs(30);

/// One changed file: lines are 1-based and inclusive.
struct FileChange {
    old: Option<String>,
    new: Option<String>,
    removed: Vec<(u32, u32)>,
    added: Vec<(u32, u32)>,
}

fn span(start: u32, count: u32) -> Option<(u32, u32)> {
    (count > 0).then_some((start, start + count - 1))
}

fn parse_diff(patch: &str) -> Vec<FileChange> {
    let mut files: Vec<FileChange> = Vec::new();
    for line in patch.lines() {
        if let Some(head) = line.strip_prefix("diff --git a/") {
            let (old, new) = head.split_once(" b/").unwrap_or((head, head));
            files.push(FileChange {
                old: Some(old.into()),
                new: Some(new.into()),
                removed: vec![],
                added: vec![],
            });
        } else if let Some(file) = files.last_mut() {
            if line == "--- /dev/null" {
                file.old = None;
            } else if line == "+++ /dev/null" {
                file.new = None;
            } else if let Some(hunk) = line.strip_prefix("@@ -") {
                let mut parts = hunk.split(' ');
                let read = |p: Option<&str>| {
                    let p = p.unwrap_or("").trim_start_matches(['-', '+']);
                    let (a, b) = p.split_once(',').unwrap_or((p, "1"));
                    (a.parse().unwrap_or(0), b.parse().unwrap_or(0))
                };
                let (os, oc) = read(parts.next());
                let (ns, nc) = read(parts.next());
                file.removed.extend(span(os, oc));
                file.added.extend(span(ns, nc));
            }
        }
    }
    files
}

fn status_of(old: bool, new: bool) -> CallStatus {
    match (old, new) {
        (true, true) => CallStatus::Changed,
        (false, true) => CallStatus::Added,
        _ => CallStatus::Removed,
    }
}

fn span_of(side: &SideData, key: &str) -> Option<LineSpan> {
    let sym = side.by_key.get(key).filter(|_| side.exists(key))?;
    Some(LineSpan {
        start: sym.range.0 + 1,
        end: sym.range.1 + 1,
    })
}

impl SideData {
    /// Whether the symbol is in a file table of this side (the top level is where its file is).
    fn exists(&self, key: &str) -> bool {
        self.tables
            .values()
            .any(|t| t.iter().any(|s| s.key() == key))
            || key.contains("#(top level)#")
                && self.tables.keys().any(|rel| {
                    let path = self.key_paths.get(rel).unwrap_or(rel);
                    key.starts_with(&format!("{path}#")) && self.root.join(rel).is_file()
                })
    }
}

/// Run one side: its server reads the changed files' symbols, then the calls of `want` and of
/// every touched symbol. Gone when this returns.
fn run_side(
    server: &server::Server,
    data: &mut SideData,
    files: &[String],
    want: &BTreeSet<String>,
    deadline: Instant,
    cancel: &Arc<AtomicBool>,
) -> Result<(), Stop> {
    let mut client = Client::start(
        &server.program,
        server.row.args,
        &data.root,
        deadline,
        cancel.clone(),
    )?;
    if client
        .capabilities
        .pointer("/callHierarchyProvider")
        .is_none_or(|p| p.is_null() || *p == false)
    {
        return Err(Stop::Error("noCallHierarchy".into()));
    }
    for rel in files {
        data.touch(&mut client, rel)?;
        data.table(&mut client, rel)?;
    }
    let keys: Vec<String> = data.touched.union(want).cloned().collect();
    for key in keys {
        data.read_calls(&mut client, &key)?;
    }
    Ok(())
}

fn cause(kind: &str, detail: impl Into<String>) -> CallPathCause {
    CallPathCause {
        kind: kind.into(),
        detail: detail.into(),
    }
}

impl Git {
    /// CP1 to CP7: the languages the changed files hold, or `language`'s changed symbols,
    /// calls and flows. `cancel` set kills the server and ends the trace.
    pub fn call_paths(
        &self,
        worktree: &Worktree,
        to: CompareTarget,
        language: Option<&str>,
        cache: &Path,
        cancel: Arc<AtomicBool>,
    ) -> Result<CallPaths, RpcError> {
        if !worktree.path.is_dir() {
            return Err(WorktreeError::Missing(worktree.path.display().to_string()).into());
        }
        let base = self.comparison_base(worktree)?;
        let end = (to == CompareTarget::Branch).then_some("HEAD");
        let changed = self.files_against(&worktree.path, &base, end)?;
        let Some(language) = language else {
            let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
            for file in &changed {
                if let Some(language) = server::language_of(&file.path) {
                    *counts.entry(language).or_default() += 1;
                }
            }
            let languages = counts
                .into_iter()
                .map(|(language, files)| LanguageRow {
                    language: language.into(),
                    files,
                    server: server::lookup(&server::find(language, &worktree.path, &self.path)),
                })
                .collect();
            return Ok(CallPaths::Languages(Languages { languages }));
        };
        let _one = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
        let deadline = Instant::now() + self.call_limit;
        let answer = match self.trace(
            worktree, &base, end, language, &changed, cache, deadline, &cancel,
        )? {
            Ok(done) => done,
            Err(why) => why,
        };
        Ok(CallPaths::Answer(answer))
    }

    #[allow(clippy::too_many_arguments)]
    fn trace(
        &self,
        worktree: &Worktree,
        base: &str,
        end: Option<&str>,
        language: &str,
        changed: &[contracts::agent::ChangedFile],
        cache: &Path,
        deadline: Instant,
        cancel: &Arc<AtomicBool>,
    ) -> Result<Result<CallPathsAnswer, CallPathsAnswer>, RpcError> {
        let no_server = |why| Ok(Err(CallPathsAnswer::NoServer { cause: why }));
        let server = match server::find(language, &worktree.path, &self.path) {
            Ok(server) => server,
            Err(why) => return no_server(why),
        };
        let row = server.row;
        let in_language = |path: &str| server::language_of(path) == Some(language);
        // The hunks, with each untracked file as one added block (the index is never written).
        let diff = [
            "--no-optional-locks",
            "-c",
            "core.quotepath=off",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            "-U0",
        ];
        let ends: Vec<&str> = std::iter::once(base).chain(end).collect();
        let patch = self
            .run(&worktree.path, &[&diff[..], &ends[..]].concat())
            .map_err(failed)?;
        let mut files = parse_diff(&patch);
        for file in changed
            .iter()
            .filter(|f| f.status == contracts::agent::ChangedStatus::Untracked)
        {
            let lines = std::fs::read_to_string(worktree.path.join(&file.path))
                .map_or(0, |t| t.lines().count() as u32);
            files.push(FileChange {
                old: None,
                new: Some(file.path.clone()),
                removed: vec![],
                added: span(1, lines).into_iter().collect(),
            });
        }
        files.retain(|f| {
            f.new
                .as_deref()
                .or(f.old.as_deref())
                .is_some_and(in_language)
        });
        let manifests = changed.iter().any(|f| {
            let name = Path::new(&f.path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            matches!(
                name,
                "package.json" | "pnpm-lock.yaml" | "package-lock.json" | "yarn.lock"
            )
        });

        let old_export = match self.export_commit(&worktree.path, base, cache) {
            Ok(dir) => dir,
            Err(err) => {
                return Ok(Err(CallPathsAnswer::Failed {
                    cause: cause("error", err),
                }));
            }
        };
        let linked = cache::link_dependencies(&worktree.path, &old_export);
        // The new side is the working tree, or HEAD exported beside the cache.
        let head_dir;
        let new_root = if end.is_some() {
            head_dir = tempfile::tempdir_in(cache)
                .or_else(|_| tempfile::tempdir())
                .map_err(|e| failed(e.to_string()))?;
            if let Err(err) = self.archive(&worktree.path, "HEAD", head_dir.path()) {
                return Ok(Err(CallPathsAnswer::Failed {
                    cause: cause("error", err),
                }));
            }
            cache::link_dependencies(&worktree.path, head_dir.path());
            head_dir.path().to_owned()
        } else {
            worktree.path.clone()
        };

        let key_paths: HashMap<String, String> = files
            .iter()
            .filter_map(|f| Some((f.old.clone()?, f.new.clone()?)))
            .filter(|(o, n)| o != n)
            .collect();
        let ranges = |old: bool| -> HashMap<String, Vec<(u32, u32)>> {
            files
                .iter()
                .filter_map(|f| {
                    let (path, ranges) = if old {
                        (f.old.clone()?, &f.removed)
                    } else {
                        (f.new.clone()?, &f.added)
                    };
                    Some((path, ranges.clone()))
                })
                .collect()
        };
        let mut old = SideData::new(&old_export, key_paths.clone(), ranges(true));
        let mut new = SideData::new(&new_root, HashMap::new(), ranges(false));
        let old_files: Vec<String> = files.iter().filter_map(|f| f.old.clone()).collect();
        let new_files: Vec<String> = files.iter().filter_map(|f| f.new.clone()).collect();

        let stopped = |stop: Stop| match stop {
            Stop::Timeout => Err(CallPathsAnswer::Failed {
                cause: cause("timeout", "the language server did not answer in time"),
            }),
            Stop::Cancelled => Err(CallPathsAnswer::Failed {
                cause: cause("cancelled", "the trace was cancelled"),
            }),
            Stop::Error(text) if text == "noCallHierarchy" => Err(CallPathsAnswer::NoServer {
                cause: cause(
                    "noCallHierarchy",
                    format!("{} does not offer call hierarchy", row.name),
                ),
            }),
            Stop::Error(text) => Err(CallPathsAnswer::Failed {
                cause: cause("error", text),
            }),
        };
        let nothing = BTreeSet::new();
        // One server after the other: the old side, the new side, then the symbols touched on
        // one side only, on the side that had not read their calls.
        if let Err(stop) = run_side(&server, &mut old, &old_files, &nothing, deadline, cancel) {
            return Ok(stopped(stop));
        }
        if let Err(stop) = run_side(&server, &mut new, &new_files, &nothing, deadline, cancel) {
            return Ok(stopped(stop));
        }
        let union: BTreeSet<String> = old.touched.union(&new.touched).cloned().collect();
        for side in [&mut old, &mut new] {
            let missing: BTreeSet<String> = union
                .iter()
                .filter(|key| !side.callable.contains_key(*key) && side.by_key.contains_key(*key))
                .cloned()
                .collect();
            let side_files = if std::ptr::eq(side.root.as_path(), old_export.as_path()) {
                &old_files
            } else {
                &new_files
            };
            if !missing.is_empty()
                && let Err(stop) = run_side(&server, side, side_files, &missing, deadline, cancel)
            {
                return Ok(stopped(stop));
            }
        }
        Ok(Ok(assemble(&old, &new, &union, linked && manifests)))
    }
}

fn assemble(
    old: &SideData,
    new: &SideData,
    union: &BTreeSet<String>,
    shared: bool,
) -> CallPathsAnswer {
    let mut symbols = Vec::new();
    let mut calls = Vec::new();
    let mut capped = false;
    let mut callable_keys = BTreeSet::new();
    for key in union {
        let (in_old, in_new) = (old.exists(key), new.exists(key));
        let Some(sym) = new
            .by_key
            .get(key)
            .filter(|_| in_new)
            .or_else(|| old.by_key.get(key))
        else {
            continue;
        };
        let callable = (in_new && new.callable.get(key) == Some(&true))
            || (!in_new && old.callable.get(key) == Some(&true));
        symbols.push(ChangedSymbol {
            key: key.clone(),
            name: sym.name.clone(),
            kind: sym.kind.clone(),
            path: sym.path.clone(),
            old: span_of(old, key),
            new: span_of(new, key),
            status: status_of(in_old, in_new),
            callable,
        });
        if callable {
            callable_keys.insert(key.clone());
            let (empty_old, empty_new) = (Calls::default(), Calls::default());
            let o = old.calls.get(key).unwrap_or(&empty_old);
            let n = new.calls.get(key).unwrap_or(&empty_new);
            capped |= o.capped || n.capped;
            let outgoing = merge(&o.outgoing, &n.outgoing);
            let mut incoming = merge(&o.incoming, &n.incoming);
            let before = incoming.len();
            incoming.retain(|(c, _)| c.status != CallStatus::Unchanged);
            calls.push((FunctionCalls {
                key: key.clone(),
                outgoing: outgoing.into_iter().map(|(c, _)| c).collect(),
                incoming_unchanged: (before - incoming.len()) as u32,
                incoming: incoming.into_iter().map(|(c, _)| c).collect(),
            },));
        }
    }
    let calls: Vec<FunctionCalls> = calls.into_iter().map(|(c,)| c).collect();
    let (flows, flow_capped) = flows(&calls, &callable_keys);
    CallPathsAnswer::Done {
        symbols,
        calls,
        flows,
        capped: capped || flow_capped,
        old_side_resolved_through_new_dependencies: shared,
    }
}

type Keyed = BTreeMap<(String, String), RawCall>;

/// The calls of both sides: added, removed, changed (a site on a changed line) or unchanged,
/// in the order of their call sites.
fn merge(old: &Keyed, new: &Keyed) -> Vec<(Call, (u32, u32))> {
    let keys: BTreeSet<&(String, String)> = old.keys().chain(new.keys()).collect();
    let mut out: Vec<(Call, (u32, u32))> = keys
        .into_iter()
        .filter_map(|key| {
            let (o, n) = (old.get(key), new.get(key));
            let any = n.or(o)?;
            let status = match (o, n) {
                (Some(_), Some(_))
                    if o.is_some_and(|c| c.on_changed_line)
                        || n.is_some_and(|c| c.on_changed_line) =>
                {
                    CallStatus::Changed
                }
                (Some(_), Some(_)) => CallStatus::Unchanged,
                (None, _) => CallStatus::Added,
                _ => CallStatus::Removed,
            };
            Some((
                Call {
                    key: any.key.clone(),
                    name: any.name.clone(),
                    kind: any.kind.clone(),
                    path: any.path.clone(),
                    status,
                },
                any.site,
            ))
        })
        .collect();
    out.sort_by_key(|(call, site)| (*site, call.key.clone()));
    out
}

/// CP4: one flow per changed function no other changed function calls.
fn flows(calls: &[FunctionCalls], changed: &BTreeSet<String>) -> (Vec<Flow>, bool) {
    let by_key: HashMap<&str, &FunctionCalls> = calls.iter().map(|c| (c.key.as_str(), c)).collect();
    let mut called: BTreeSet<&str> = BTreeSet::new();
    for function in calls {
        for call in function.outgoing.iter().filter(|c| c.key != function.key) {
            called.insert(&call.key);
        }
        for call in function
            .incoming
            .iter()
            .filter(|c| c.key != function.key && changed.contains(&c.key))
        {
            called.insert(&function.key);
            let _ = call;
        }
    }
    let mut capped = false;
    let mut flows = Vec::new();
    let mut reached: BTreeSet<String> = BTreeSet::new();
    let mut grow =
        |entry: &str, status: CallStatus, flows: &mut Vec<Flow>, reached: &mut BTreeSet<String>| {
            let mut cut = false;
            let tree = tree(
                entry,
                status,
                &by_key,
                changed,
                &mut vec![entry.to_owned()],
                &mut cut,
            );
            collect(&tree, reached);
            capped |= cut;
            flows.push(Flow {
                entry: entry.into(),
                tree,
                capped: cut,
            });
        };
    let status_of = |key: &str| {
        let mut found = CallStatus::Changed;
        for function in calls {
            if let Some(call) = function.outgoing.iter().find(|c| c.key == key) {
                found = call.status;
            }
        }
        found
    };
    let _ = status_of;
    for key in changed.iter().filter(|k| !called.contains(k.as_str())) {
        grow(key, CallStatus::Changed, &mut flows, &mut reached);
    }
    // A cycle nothing outside calls has no entry; its first function stands in.
    for key in changed {
        if !reached.contains(key) {
            grow(key, CallStatus::Changed, &mut flows, &mut reached);
        }
    }
    (flows, capped)
}

fn collect(node: &FlowNode, into: &mut BTreeSet<String>) {
    into.insert(node.key.clone());
    node.calls.iter().for_each(|c| collect(c, into));
}

fn tree(
    key: &str,
    status: CallStatus,
    by_key: &HashMap<&str, &FunctionCalls>,
    changed: &BTreeSet<String>,
    path: &mut Vec<String>,
    capped: &mut bool,
) -> FlowNode {
    let mut node = FlowNode {
        key: key.into(),
        status,
        cycle: false,
        calls: vec![],
    };
    let Some(function) = by_key.get(key) else {
        return node;
    };
    let next: Vec<&Call> = function
        .outgoing
        .iter()
        .filter(|c| changed.contains(&c.key))
        .collect();
    if path.len() > DEPTH && !next.is_empty() {
        *capped = true;
        return node;
    }
    for call in next {
        if path.contains(&call.key) {
            node.calls.push(FlowNode {
                key: call.key.clone(),
                status: call.status,
                cycle: true,
                calls: vec![],
            });
            continue;
        }
        path.push(call.key.clone());
        node.calls
            .push(tree(&call.key, call.status, by_key, changed, path, capped));
        path.pop();
    }
    node
}
