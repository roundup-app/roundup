//! CP2, CP3: what one side's language server says about the changed symbols and their calls.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde_json::{Value, json};

use super::lsp::{Client, Stop, path_of, uri};

pub(super) const OUTGOING_CAP: usize = 200;
pub(super) const INCOMING_CAP: usize = 500;

/// A symbol of a file, with the names around it.
#[derive(Clone, Debug)]
pub(super) struct Sym {
    pub name: String,
    pub kind: String,
    pub path: String,
    pub containers: Vec<String>,
    /// 0-based first and last line, and the line and column of the name.
    pub range: (u32, u32),
    pub sel: (u32, u32),
}

impl Sym {
    pub fn key(&self) -> String {
        format!(
            "{}#{}#{}#{}",
            self.path,
            self.containers.join("."),
            self.name,
            self.kind
        )
    }

    pub fn top_level(path: &str, lines: u32) -> Self {
        Self {
            name: "(top level)".into(),
            kind: "topLevel".into(),
            path: path.into(),
            containers: vec![],
            range: (0, lines.saturating_sub(1)),
            sel: (0, 0),
        }
    }

    pub fn is_function_kind(&self) -> bool {
        matches!(
            self.kind.as_str(),
            "function" | "method" | "constructor" | "variable" | "constant" | "property" | "field"
        )
    }
}

fn kind_name(number: u64) -> &'static str {
    match number {
        2 => "module",
        3 => "namespace",
        5 => "class",
        6 => "method",
        7 => "property",
        8 => "field",
        9 => "constructor",
        10 => "enum",
        11 => "interface",
        12 => "function",
        13 => "variable",
        14 => "constant",
        22 => "enumMember",
        23 => "struct",
        26 => "typeParameter",
        _ => "symbol",
    }
}

/// One call of a function as one side reads it.
#[derive(Clone, Debug)]
pub(super) struct RawCall {
    pub key: String,
    pub name: String,
    pub kind: String,
    pub path: String,
    pub site: (u32, u32),
    pub on_changed_line: bool,
}

#[derive(Default)]
pub(super) struct Calls {
    /// By callee key and the call site's text.
    pub outgoing: BTreeMap<(String, String), RawCall>,
    pub incoming: BTreeMap<(String, String), RawCall>,
    pub capped: bool,
}

/// Everything one side's server told, kept after the server is gone.
pub(super) struct SideData {
    pub root: PathBuf,
    /// Old paths to new ones, so a renamed file's symbols keep one key.
    pub key_paths: HashMap<String, String>,
    /// 1-based changed line ranges of this side by path on this side.
    pub changed: HashMap<String, Vec<(u32, u32)>>,
    pub tables: HashMap<String, Rc<Vec<Sym>>>,
    pub lines: HashMap<String, Rc<Vec<String>>>,
    pub touched: BTreeSet<String>,
    pub callable: HashMap<String, bool>,
    pub calls: HashMap<String, Calls>,
    /// Keys of this side's symbols by key, for every table loaded.
    pub by_key: HashMap<String, Sym>,
    opened: BTreeSet<String>,
}

impl SideData {
    pub fn new(
        root: &Path,
        key_paths: HashMap<String, String>,
        changed: HashMap<String, Vec<(u32, u32)>>,
    ) -> Self {
        Self {
            root: root.to_owned(),
            key_paths,
            changed,
            tables: HashMap::new(),
            lines: HashMap::new(),
            touched: BTreeSet::new(),
            callable: HashMap::new(),
            calls: HashMap::new(),
            by_key: HashMap::new(),
            opened: BTreeSet::new(),
        }
    }

    fn key_path(&self, rel: &str) -> String {
        self.key_paths
            .get(rel)
            .cloned()
            .unwrap_or_else(|| rel.to_owned())
    }

    /// `rel`'s source lines and symbols, asking the server once.
    pub fn table(&mut self, client: &mut Client, rel: &str) -> Result<Rc<Vec<Sym>>, Stop> {
        if let Some(table) = self.tables.get(rel) {
            return Ok(table.clone());
        }
        let file = self.root.join(rel);
        let text = std::fs::read_to_string(&file).unwrap_or_default();
        let lines: Vec<String> = text.lines().map(str::to_owned).collect();
        let mut out = Vec::new();
        if file.is_file() {
            let uri = uri(&file);
            if self.opened.insert(rel.to_owned()) {
                client.notify(
                    "textDocument/didOpen",
                    json!({"textDocument": {"uri": uri, "languageId": "typescript", "version": 1, "text": text}}),
                )?;
            }
            let reply = client.request(
                "textDocument/documentSymbol",
                json!({"textDocument": {"uri": uri}}),
            )?;
            let path = self.key_path(rel);
            flatten(
                reply.as_array().map_or(&[][..], |a| a),
                &path,
                &mut vec![],
                &mut out,
            );
        }
        for sym in &out {
            self.by_key.insert(sym.key(), sym.clone());
        }
        let table = Rc::new(out);
        self.lines.insert(rel.to_owned(), Rc::new(lines));
        self.tables.insert(rel.to_owned(), table.clone());
        Ok(table)
    }

    /// The innermost symbol of `rel` around the 0-based `line`, else the file's top level.
    pub fn innermost(&mut self, client: &mut Client, rel: &str, line: u32) -> Result<Sym, Stop> {
        let table = self.table(client, rel)?;
        let count = self.lines.get(rel).map_or(0, |l| l.len() as u32);
        let top = Sym::top_level(&self.key_path(rel), count);
        Ok(table
            .iter()
            .rfind(|sym| sym.range.0 <= line && line <= sym.range.1)
            .cloned()
            .unwrap_or(top))
    }

    /// Mark the symbols the changed lines of `rel` fall in.
    pub fn touch(&mut self, client: &mut Client, rel: &str) -> Result<(), Stop> {
        for (start, end) in self.changed.get(rel).cloned().unwrap_or_default() {
            for line in start..=end {
                let sym = self.innermost(client, rel, line - 1)?;
                let key = sym.key();
                self.by_key.entry(key.clone()).or_insert(sym);
                self.touched.insert(key);
            }
        }
        Ok(())
    }

    /// Prepare `key`'s symbol as callable and read its calls on this side.
    pub fn read_calls(&mut self, client: &mut Client, key: &str) -> Result<(), Stop> {
        if self.callable.contains_key(key) {
            return Ok(());
        }
        let Some(sym) = self.by_key.get(key).cloned() else {
            return Ok(());
        };
        let rel = self.rel_of_key(&sym);
        let mut callable = false;
        if sym.is_function_kind() {
            let reply = client.request(
                "textDocument/prepareCallHierarchy",
                json!({"textDocument": {"uri": uri(&self.root.join(&rel))},
                       "position": {"line": sym.sel.0, "character": sym.sel.1}}),
            )?;
            if let Some(item) = reply.as_array().and_then(|items| items.first()) {
                callable = true;
                let mut calls = Calls::default();
                for (method, field, cap) in [
                    ("callHierarchy/outgoingCalls", "to", OUTGOING_CAP),
                    ("callHierarchy/incomingCalls", "from", INCOMING_CAP),
                ] {
                    let reply = client.request(method, json!({"item": item}))?;
                    let all = reply.as_array().map_or(&[][..], |a| a);
                    calls.capped |= all.len() > cap;
                    let outgoing = field == "to";
                    for call in all.iter().take(cap) {
                        self.add_call(
                            client,
                            &rel,
                            outgoing,
                            &call[field],
                            &call["fromRanges"],
                            &mut calls,
                        )?;
                    }
                }
                self.calls.insert(key.to_owned(), calls);
            }
        }
        self.callable.insert(key.to_owned(), callable);
        Ok(())
    }

    /// The path of `sym`'s file on this side (the key path of a renamed file is its new one).
    fn rel_of_key(&self, sym: &Sym) -> String {
        self.key_paths
            .iter()
            .find(|(_, new)| **new == sym.path)
            .map_or_else(|| sym.path.clone(), |(old, _)| old.clone())
    }

    fn add_call(
        &mut self,
        client: &mut Client,
        own_rel: &str,
        outgoing: bool,
        item: &Value,
        ranges: &Value,
        calls: &mut Calls,
    ) -> Result<(), Stop> {
        let Some(file) = item["uri"].as_str().and_then(path_of) else {
            return Ok(());
        };
        let text = file.to_string_lossy();
        let name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        if text.contains("/node_modules/") || (name.starts_with("lib.") && name.ends_with(".d.ts"))
        {
            return Ok(());
        }
        let Ok(rel) = file.strip_prefix(&self.root) else {
            return Ok(());
        };
        let rel = rel.to_string_lossy().into_owned();
        let line = num(item, "/selectionRange/start/line");
        let col = num(item, "/selectionRange/start/character");
        let table = self.table(client, &rel)?;
        let other = table
            .iter()
            .find(|s| s.sel == (line, col))
            .cloned()
            .unwrap_or_else(|| Sym {
                name: item["name"].as_str().unwrap_or("").into(),
                kind: kind_name(item["kind"].as_u64().unwrap_or(0)).into(),
                path: self.key_path(&rel),
                containers: vec![],
                range: (line, line),
                sel: (line, col),
            });
        // Ranges lie in the caller's file: the function itself going out, the other coming in.
        let site_rel = if outgoing { own_rel } else { &rel };
        self.table(client, site_rel)?;
        let site_text = self.lines.get(site_rel).cloned().unwrap_or_default();
        let changed = self.changed.get(site_rel).cloned().unwrap_or_default();
        for range in ranges.as_array().map_or(&[][..], |a| a) {
            let (sl, sc) = (
                num(range, "/start/line"),
                num(range, "/start/character") as usize,
            );
            let ec = num(range, "/end/character") as usize;
            let text: String = site_text
                .get(sl as usize)
                .map(|l| l.chars().skip(sc).take(ec.saturating_sub(sc)).collect())
                .unwrap_or_default();
            let call = RawCall {
                key: other.key(),
                name: other.name.clone(),
                kind: other.kind.clone(),
                path: other.path.clone(),
                site: (sl, sc as u32),
                on_changed_line: changed.iter().any(|(a, b)| *a <= sl + 1 && sl < *b),
            };
            self.by_key.entry(call.key.clone()).or_insert(other.clone());
            let map = if outgoing {
                &mut calls.outgoing
            } else {
                &mut calls.incoming
            };
            map.entry((call.key.clone(), text))
                .and_modify(|seen| {
                    seen.on_changed_line |= call.on_changed_line;
                    seen.site = seen.site.min(call.site);
                })
                .or_insert(call);
        }
        Ok(())
    }
}

/// The number at the JSON pointer `at`, 0 when absent.
fn num(value: &Value, at: &str) -> u32 {
    value.pointer(at).and_then(Value::as_u64).unwrap_or(0) as u32
}

fn flatten(items: &[Value], path: &str, containers: &mut Vec<String>, out: &mut Vec<Sym>) {
    for item in items {
        let (Some(name), Some(range)) = (item["name"].as_str(), item.get("range")) else {
            continue;
        };
        out.push(Sym {
            name: name.to_owned(),
            kind: kind_name(item["kind"].as_u64().unwrap_or(0)).into(),
            path: path.to_owned(),
            containers: containers.clone(),
            range: (num(range, "/start/line"), num(range, "/end/line")),
            sel: (
                num(item, "/selectionRange/start/line"),
                num(item, "/selectionRange/start/character"),
            ),
        });
        if let Some(children) = item["children"].as_array() {
            containers.push(name.to_owned());
            flatten(children, path, containers, out);
            containers.pop();
        }
    }
}
