import type { Call } from "@contracts/agent/Call";
import type { CallPaths } from "@contracts/agent/CallPaths";
import type { CallStatus } from "@contracts/agent/CallStatus";
import type { ChangedSymbol } from "@contracts/agent/ChangedSymbol";
import type { FileComparison } from "@contracts/agent/FileComparison";
import type { FlowNode } from "@contracts/agent/FlowNode";
import type { LanguageRow } from "@contracts/agent/LanguageRow";
import type { Done } from "./flows";
import { comparison, counted, text } from "./viewHarness";

// U7683: the flow fixture: two entries of run.ts that both call load, a type no flow holds, a Rust file, a README and a lockfile.

const symbol = (path: string, name: string, start: number, end: number, kind = "function", callable = true): ChangedSymbol => ({ key: `${path}##${name}#${kind}`, name, kind, path, old: { start, end }, new: { start, end }, status: "changed", callable });

export const RUN = symbol("apps/a/src/run.ts", "run", 1, 5);

export const OTHER = symbol("apps/a/src/run.ts", "other", 18, 22);

export const LOAD = symbol("apps/a/src/load.ts", "load", 1, 4);

export const ALIAS = symbol("apps/a/src/types.ts", "Alias", 1, 3, "type", false);

export const SHOUT = symbol("crates/b/src/lib.rs", "shout", 1, 4);

const changed = (path: string) => ({ ...counted(path, 2, 2), blob: `${path}@one` });

export const FLOW_FILES = ["apps/a/src/run.ts", "apps/a/src/load.ts", "apps/a/src/types.ts", "crates/b/src/lib.rs", "docs/README.md", "pnpm-lock.yaml"].map(changed);

const call = (of: ChangedSymbol, status: CallStatus = "changed"): Call => ({ key: of.key, name: of.name, kind: of.kind, path: of.path, status });

const node = (of: ChangedSymbol, calls: FlowNode[] = []): FlowNode => ({ key: of.key, status: "changed", cycle: false, calls });

const LEGACY: Call = { key: "apps/a/src/legacy.ts##legacy#function", name: "legacy", kind: "function", path: "apps/a/src/legacy.ts", status: "removed" };

const LOG: Call = { key: "apps/a/src/log.ts##log#function", name: "log", kind: "function", path: "apps/a/src/log.ts", status: "unchanged" };

const done = (symbols: ChangedSymbol[], calls: Done["calls"], flows: FlowNode[]): Done => ({ state: "done", symbols, calls, flows: flows.map(tree => ({ entry: tree.key, tree, capped: false })), capped: false, oldSideResolvedThroughNewDependencies: false });

/** `run` calls `load`, a removed `legacy` and an unchanged `log`; `other` calls `load`, which three functions call. */
export const TYPESCRIPT = done([RUN, OTHER, LOAD, ALIAS], [
  { key: RUN.key, outgoing: [call(LOAD), LEGACY, LOG], incoming: [], incoming_unchanged: 0 },
  { key: OTHER.key, outgoing: [call(LOAD)], incoming: [], incoming_unchanged: 0 },
  { key: LOAD.key, outgoing: [], incoming: [call(RUN), call(OTHER)], incoming_unchanged: 1 },
], [node(RUN, [node(LOAD)]), node(OTHER, [node(LOAD)])]);

/** Only the type changed: no function is an entry point. */
export const TYPES_ONLY = done([ALIAS], [], []);

export const RUST = done([SHOUT], [{ key: SHOUT.key, outgoing: [], incoming: [], incoming_unchanged: 0 }], [node(SHOUT)]);

const found = (language: string, files: number): LanguageRow => ({ language, files, server: { found: true, name: `${language}-server` } });

export const LOOKUP: CallPaths = { languages: [found("typescript", 4), found("rust", 1), { language: "python", files: 2, server: { found: false, cause: { kind: "notInstalled", detail: "none" } } }] };

/** The fake Daemon's answers: the lookup, then each language's trace. */
export const answers = (rust: CallPaths = RUST) => ({ language }: { language?: string | undefined }): CallPaths => language === "typescript" ? TYPESCRIPT : language === "rust" ? rust : LOOKUP;

const numbered = (change: (line: number) => string) => Array.from({ length: 25 }, (_, index) => change(index + 1)).join("\n") + "\n";

/** Lines 2 and 20 of every file changed: the first is `run`'s, the second `other`'s. */
export const flowComparison = (path: string): FileComparison => comparison(path, { old: text("old", numbered(line => `line ${line}`)), new: text("new", numbered(line => line === 2 || line === 20 ? `line ${line} new` : `line ${line}`)) });
