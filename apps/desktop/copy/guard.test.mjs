import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { checkCopy } from "./guard.mjs";

const ROOT = new URL("../src/", import.meta.url).pathname;

import { join } from "node:path";

const fixture = (entries, body = "copy.message") => ({
  "app/copy.ts": `export const copy = { ${entries} };`,
  "app/view.ts": `import { copy } from './copy'; export const view = ${body};`,
});

const rules = (files) => checkCopy(files).diagnostics.map(each => each.rule);

it.each([
  ["unused", fixture('message: "Open", dead: "Close"'), "unused-copy"],
  ["duplicate", { ...fixture('message: "Open"'), "rail/copy.ts": 'export const copy = { message: "Open" };', "rail/view.ts": 'import {copy} from "./copy"; export const view = copy.message;' }, "duplicate-copy"],
  ["dynamic", fixture('message: "Open"', 'copy[unknown]'), "dynamic-copy-read"],
])("u471_copy_guard_rejects_unused_and_duplicate_values_%s", (_, files, diagnostic) => {
  expect(rules(files)).toContain(diagnostic);
});

it.each([
  ['copy["message"]'],
  ['(() => { const alias = copy; return alias.message; })()'],
  ['(() => { const { message } = copy; return message; })()'],
])("u471_copy_guard_accepts_resolved_reads_%s", body => {
  expect(rules(fixture('message: "Storage"', body))).toEqual([]);
});

it.each([
  ['message: "Open this selected Agent"', "label-length"],
  ['/** @prose */ message: "This sentence has thirteen separate words and must fail the copy length check."', "sentence-length"],
  ['/** @prose */ message: "Storage unavailable."', "fragment"],
  ['message: "Storage unavailable."', "fragment"],
  ['/** @prose */ message: () => true ? "Storage is unavailable." : "Storage unavailable."', "fragment"],
  ['/** @prose */ message: { problem: "Storage unavailable." }', "fragment"],
])("u471_copy_guard_rejects_long_labels_sentences_and_fragments_%s", (entries, diagnostic) => {
  expect(rules(fixture(entries))).toContain(diagnostic);
});

it.each([
  'message: "Storage"',
  '/** @prose */ message: "Storage is unavailable."',
  '/** @prose */ message: "Try again."',
  '/** @prose */ message: (name) => `Open ${name}.`',
])("u471_copy_guard_accepts_labels_prose_and_supplied_values_%s", entries => {
  expect(rules(fixture(entries))).toEqual([]);
});

it("u471_copy_guard_rejects_internal_vocabulary", () => {
  const glossary = readFileSync(join(ROOT, "../../../GLOSSARY.md"), "utf8");
  const banned = ["bot", "worker", "session", "process", "console", "shell integration", "overlay", "popup", "summon", "fling", "room", "folder", "meta-agent", "parent agent", "lead", "child agent", "sub-agent", "roll back", "task", "ticket", "assignee", "scratchpad", "upload", "temp image", "notification", "inject", "nudge", "cancel", "abort", "chat", "main agent", "Daemon", "MCP", "revision", "retained", "acceptance"];

  for (const word of banned) {
    expect(checkCopy(fixture(`message: ${JSON.stringify(word.toUpperCase())}`), { glossary }).diagnostics.map(each => each.rule), word).toContain("vocabulary");
  }

  expect(rules(fixture('message: "Multitasking"'))).toEqual([]);
  expect(rules(fixture('message: (name) => `Open ${name}`', 'copy.message("task Daemon draft")'))).toEqual([]);
});

it("u471_copy_guard_rejects_internal_vocabulary_in_helpers_and_branches", () => {
  for (const entries of [
    'message: () => true ? "Storage" : "Sessions"',
    'message: { nested: "Revisions" }',
    'message: () => explain()',
  ]) {
    const files = fixture(entries);
    files["app/copy.ts"] = 'const explain = () => "Daemon"; ' + files["app/copy.ts"];
    expect(rules(files)).toContain("vocabulary");
  }
});

it.each(["draft", "drafts", "retained work", "revision", "unfinished rail work"])("u471_copy_guard_uses_one_recovery_name_%s", text => {
  expect(rules(fixture(`message: () => true ? "Unfinished work" : ${JSON.stringify(text)}`))).toContain("recovery-name");
  expect(rules(fixture('message: "Unfinished work"'))).toEqual([]);
});

it("u471_copy_allowlist_only_shrinks", () => {
  const files = fixture('message: "Open this selected Agent"');
  const baseline = checkCopy(files).inventory;
  expect(checkCopy(files, { baseline, previous: baseline }).diagnostics).toEqual([]);
  const rejected = (current, next) => checkCopy(current, { baseline: next, previous: baseline }).diagnostics.map(each => each.rule);
  expect(rejected(fixture('message: "Open this other Agent"'), baseline)).toContain("label-length");
  expect(rejected(fixture('message: "Open"'), baseline)).toContain("baseline-stale");
  expect(rejected(files, [...baseline, { ...baseline[0], identity: "other" }])).toContain("baseline-expanded");
  expect(rejected(fixture('message: "Open", other: "Close this selected Agent"', '[copy.message, copy.other]'), baseline)).toContain("label-length");
  expect(checkCopy(fixture('message: "Open"'), { baseline: [], previous: baseline }).diagnostics).toEqual([]);
});

it("u471_copy_allowlist_rejects_wildcards_duplicates_and_malformed_rows", () => {
  const files = fixture('message: "Open this selected Agent"');
  const baseline = checkCopy(files).inventory;
  const errors = (next) => checkCopy(files, { baseline: next, previous: baseline }).diagnostics.map(each => each.rule);
  expect(errors([{ ...baseline[0], identity: "*" }])).toContain("baseline-invalid");
  expect(errors([{ ...baseline[0], fingerprint: "*" }])).toContain("baseline-invalid");
  const malformed = { ...baseline[0], extra: true };
  expect(errors([malformed])).toContain("baseline-invalid");
  expect(errors([...baseline, ...baseline])).toContain("baseline-duplicate");
});

it("u471_copy_guard_accepts_shared_references_and_rejects_a_second_definition", () => {
  const files = {
    ...fixture('message: shared.message'),
    "app/copy.ts": 'import {copy as shared} from "../sharedCopy"; export const copy = {message: shared.message};',
    "rail/copy.ts": 'import {copy as shared} from "../sharedCopy"; export const copy = {message: shared.message};',
    "rail/view.ts": 'import {copy} from "./copy"; export const view = copy.message;',
    "sharedCopy.ts": 'export const copy = {message: "Storage"};',
  };

  expect(rules(files)).toEqual([]);
  expect(rules({ ...files, "app/copy.ts": 'export const copy = {message: "Storage"};' })).toContain("duplicate-copy");
});

it("u471_copy_guard_checks_helper_results_and_composed_formatters", () => {
  const files = fixture('/** @prose */ message: () => `${explain()}`');
  files["app/copy.ts"] = 'const explain = () => "Storage unavailable."; ' + files["app/copy.ts"];
  expect(rules(files)).toContain("fragment");
});

it("u471_copy_guard_rejects_unused_nested_leaves", () => {
  expect(rules(fixture('message: { used: "Storage", dead: "Unused" }', 'copy.message.used'))).toContain("unused-copy");
});

it.each([
  ['/** @prose */ message: () => missing()', "unanalysable-copy"],
  ['/** @prose */ message: ""', "unanalysable-prose"],
  ['/** @prose */ message: "Saved work."', "fragment"],
])("u471_copy_guard_rejects_missing_or_unanalysable_prose_%s", (entries, diagnostic) => {
  expect(rules(fixture(entries))).toContain(diagnostic);
});

it("u471_copy_guard_keeps_control_labels_short_even_when_marked_as_prose", () => {
  const files = fixture('/** @prose */ message: "Open this selected Agent."');
  files["app/view.ts"] = 'import {copy} from "./copy"; export const view = <button>{copy.message}</button>;';
  expect(rules(files)).toContain("label-length");
});

it("u471_copy_allowlist_preserves_an_unchanged_identity_when_it_moves", () => {
  const files = fixture('message: "Open this selected Agent"');
  const baseline = checkCopy(files).inventory;
  const moved = { "rail/copy.ts": files["app/copy.ts"], "rail/view.ts": files["app/view.ts"] };
  expect(checkCopy(moved, { baseline, previous: baseline }).diagnostics).toEqual([]);
});

it.each(["string", "any"])("u471_copy_guard_rejects_unresolved_nested_keys_%s", type => {
  const files = fixture('message: { open: "Open", close: "Close" }');
  files["app/view.ts"] = `import {copy} from "./copy"; declare const key: ${type}; export const view = copy.message[key];`;
  expect(rules(files)).toContain("dynamic-copy-read");
});

it("u471_copy_guard_accepts_compiler_proven_key_unions", () => {
  const files = fixture('message: { open: "Open", close: "Close" }');
  files["app/view.ts"] = 'import {copy} from "./copy"; declare const key: "open" | "close"; export const view = copy.message[key];';
  expect(rules(files)).toEqual([]);
});

it.each([
  ['export const wordsCopy = { message: "Storage" };', 'copy.message'],
  ['const labels = { message: "Storage" }; export const wordsCopy = { ...labels };', 'copy.message'],
])("u471_copy_guard_accepts_explicit_catalogue_inputs_%s", (catalogue, body) => {
  expect(checkCopy({
    "words.ts": catalogue,
    "view.ts": `import { wordsCopy as copy } from "./words"; export const view = ${body};`,
  }, { catalogues: ["words.ts"] }).diagnostics).toEqual([]);
});

it("u471_copy_guard_ignores_tests_and_unreachable_catalogue_dependencies", () => {
  expect(rules({
    ...fixture('message: "Storage", dead: () => copy.other(), other: () => "Unused"'),
    "app/view.test.ts": 'import {copy} from "./copy"; copy.dead();',
  }).filter(rule => rule === "unused-copy")).toHaveLength(2);
});

it("u471_copy_guard_rejects_unused_map_leaves", () => {
  expect(rules(fixture('message: new Map([["used", "Storage"], ["dead", "Unused"]])', 'copy.message.get("used")'))).toContain("unused-copy");
});
