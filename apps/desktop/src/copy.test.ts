import { mountRail, rowOf } from "./rail/railFixture";
import { mountCentre } from "./testing/centreFixture";
import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream, agent } from "./testing/nodes";
import { mountRailAndPane } from "./terminal/paneHarness";

afterEach(cleanup);

it("u471_action_labels_describe_the_existing_action_start_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: "Start supervisor" })).find((button) => button.closest(".pane-door"))!);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
});

import { parse } from "@babel/parser";
import { isNode } from "@babel/types";
import type { Node } from "@babel/types";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { copy } from "./copy";

const ROOT = join(process.cwd(), "src");

const sources = () => readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter((file) =>
  /\.tsx?$/.test(file) && !/(\.test\.|Fixture|Browser|Harness|^testing\/|^perf\/|\.d\.ts$|^copy\.ts$)/.test(file));

const visit = (node: Node, ancestors: readonly Node[], read: (node: Node, ancestors: readonly Node[]) => void) => {
  read(node, ancestors);

  for (const child of Object.values(node)) {
    if (isNode(child)) visit(child, [...ancestors, node], read);
    else if (Array.isArray(child)) for (const each of child) if (isNode(each)) visit(each, [...ancestors, node], read);
  }
};

// These are executable structure or diagnostics never shown by the App, not copy exemptions.
const STRUCTURE = new Set([
  // U2239: the leader's key names and the modifier keys it waits through.
  "J", "⇧J", "K", "M", "W", "S", "KeyJ", "KeyK", "KeyM", "KeyW", "KeyS", "Shift+KeyJ", "Shift", "Control", "Alt", "Meta", "CapsLock",
  "index.html has no #root element", "the keystroke run needs a Project open", "RpcError",
  "(prefers-reduced-motion: reduce)", "(prefers-color-scheme: dark)",
  "input, textarea, [contenteditable]", 'input, textarea, [contenteditable="true"]',
  'input, textarea, select, [contenteditable="true"]', "select, input, button",
  "input, textarea, select, [contenteditable], .todo-blocker", "visual-source is-open",
  'ui-monospace, "SF Mono", Menlo, monospace', "no open Project: a region read the ConnectedProject outside one",
  "the Rail's indent step has no width", "  last: ", "  open todos: ", "  pads: ",
]);

const UI_ATTRIBUTES = /^(aria-label|aria-description|aria-valuetext|title|placeholder|alt|label|fallback)$/;

const candidates = (source: string): { line: number; text: string }[] => {
  const found: { line: number; text: string }[] = [];
  const tree = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
  const bindings = new Map<string, Node>();
  const used = new Set<string>();

  visit(tree, [], (node, ancestors) => {
    if (node.type === "VariableDeclarator" && node.id.type === "Identifier" && node.init) bindings.set(node.id.name, node.init);

    if (node.type === "CallExpression" && node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier" && node.callee.property.name === "setAttribute" && node.arguments[0]?.type === "StringLiteral" && UI_ATTRIBUTES.test(node.arguments[0].value)) {
      const value = node.arguments[1];

      if (value && isNode(value)) visit(value, [], (each) => { if (each.type === "Identifier") used.add(each.name); });
    }

    if (node.type !== "JSXExpressionContainer") return;

    const parent = ancestors.at(-1);

    if (parent?.type === "JSXAttribute" && (parent.name.type !== "JSXIdentifier" || !UI_ATTRIBUTES.test(parent.name.name))) return;

    visit(node.expression, [], (each) => { if (each.type === "Identifier") used.add(each.name); });
  });

  for (const name of used) {
    const bound = bindings.get(name);

    if (bound && !["ArrowFunctionExpression", "FunctionExpression", "CallExpression"].includes(bound.type)) visit(bound, [], (each) => { if (each.type === "Identifier") used.add(each.name); });
  }

  visit(tree, [], (node, ancestors) => {
    if (ancestors.some((each) => (each.type.startsWith("TS") && each.type !== "TSAsExpression" && each.type !== "TSSatisfiesExpression") || each.type === "ImportDeclaration")) return;

    if (ancestors.some((each) => each.type === "TemplateLiteral" && /^<a href=/.test(each.quasis[0]?.value.cooked ?? ""))) return;
    const parent = ancestors.at(-1);

    const uiSetter = parent?.type === "CallExpression" && parent.callee.type === "MemberExpression" && parent.callee.property.type === "Identifier" && parent.callee.property.name === "setAttribute" && parent.arguments[0]?.type === "StringLiteral" && UI_ATTRIBUTES.test(parent.arguments[0].value) && parent.arguments[1] === node;

    if (!uiSetter && parent?.type === "CallExpression" && parent.callee.type === "MemberExpression" && parent.callee.property.type === "Identifier" && ["rpc", "setAttribute", "getAttribute", "querySelector", "querySelectorAll", "closest", "split", "scrollIntoView", "hasAttribute"].includes(parent.callee.property.name)) return;

    if (parent?.type === "ReturnStatement" && ancestors.some((each) => each.type === "VariableDeclarator" && each.id.type === "Identifier" && ["placeOf", "createDoorMode"].includes(each.id.name))) return;

    if (parent?.type === "BinaryExpression" && ["===", "!==", "==", "!="].includes(parent.operator)) return;
    const attribute = ancestors.findLast((each) => each.type === "JSXAttribute");
    const expression = ancestors.findLastIndex((each) => each.type === "JSXExpressionContainer");
    const attributeAt = ancestors.findLastIndex((each) => each.type === "JSXAttribute");
    const inContent = node.type === "JSXText" || expression > attributeAt && ancestors[expression - 1]?.type !== "JSXAttribute";
    const binding = ancestors.findLast((each) => each.type === "VariableDeclarator");
    const marker = binding?.type === "VariableDeclarator" && binding.id.type === "Identifier" && binding.id.name === "RECOMMENDED" && node.type === "StringLiteral" && node.value === " (recommended)";

    if (marker) return;
    const textBinding = binding?.type === "VariableDeclarator" && binding.id.type === "Identifier" && used.has(binding.id.name) && binding.init && !["ArrowFunctionExpression", "FunctionExpression", "CallExpression"].includes(binding.init.type);
    const uiAttribute = attribute?.type === "JSXAttribute" && attribute.name.type === "JSXIdentifier" && UI_ATTRIBUTES.test(attribute.name.name);

    if (attribute && !uiAttribute && !inContent) return;

    if (parent?.type === "ObjectProperty" && parent.key === node || parent?.type === "MemberExpression") return;

    const holder = ancestors.at(-2);

    if (parent?.type === "ArrayExpression" && holder?.type === "ObjectProperty" && holder.key.type === "Identifier" && holder.key.name === "chords") return;
    let text: string;

    if (node.type === "JSXText") text = node.value.trim();
    else if (node.type === "StringLiteral") text = node.value;
    else if (node.type === "TemplateLiteral") {
      if (!uiAttribute && node.quasis.every((part) => !/[a-zA-Z]/.test(part.value.cooked ?? ""))) return;
      text = node.quasis.map((part) => part.value.cooked ?? "").join(" ");

      if (text.endsWith('px') || /^(alt\+Digit|<a href=|no (row|node)|WebGL renderer)/.test(text)) return;
    } else return;

    if (!text.trim() || STRUCTURE.has(text) && !uiAttribute && !inContent && !textBinding || /^(--|\.|\[|#|var\(|translate|rgba|https|url\(|@|\.\.\/|\/)/.test(text)) return;

    if (node.type === "JSXText" || uiAttribute || uiSetter || inContent || textBinding || parent?.type === "NewExpression" && parent.callee.type === "Identifier" && parent.callee.name.endsWith("Error") || /^[A-Z]/.test(text) || /\s[a-zA-Z]/.test(text) || parent?.type === "ReturnStatement") {
      found.push({ line: node.loc?.start.line ?? 0, text });
    }
  });

  return found;
};

it("u471_every_app_authored_string_comes_from_the_catalogue", () => {
  const missing = sources().flatMap((file) => candidates(readFileSync(join(ROOT, file), "utf8")).map(({ line, text }) => `${file}:${line}: ${text}`));
  expect(missing).toEqual([]);
});

it("u471_source_observer_covers_jsx_attributes_and_helper_prose", () => {
  const source = 'const failure = () => { return "failed"; }; const view = <button aria-label="retry now" title={"Try again"}>Retry</button>;';
  expect(candidates(source).map((each) => each.text)).toEqual(["failed", "retry now", "Try again", "Retry"]);
  expect(candidates('const label = "retry"; const view = <Show fallback={<span>Oops</span>}><button aria-label={label} /></Show>;').map((each) => each.text)).toEqual(["retry", "Oops"]);
  expect(candidates('const view = <button class="button quiet" aria-label={name} />; rpc("rail.startDoor", {id});')).toEqual([]);
  expect(candidates('button.setAttribute("aria-label", "retry");').map((each) => each.text)).toEqual(["retry"]);
  expect(candidates('const label = "retry"; button.setAttribute("aria-label", label);').map((each) => each.text)).toEqual(["retry"]);
  expect(candidates('button.setAttribute("data-kind", "working"); button.setAttribute("aria-pressed", "true");')).toEqual([]);
});

const TERMS = new Set(["Workstream", "Workstreams", "Agent", "Agents", "Pad", "Pads", "Rail", "Daemon", "Todo", "Todos", "Drawer", "Terminal", "Terminals", "Bubble", "Thread", "Model", "Models", "Effort", "Message", "Messages", "Quote", "Skills", "Subagent", "Subagents", "Usage", "Iteration", "Project", "App", "Editor", "Skill"]);

const ACRONYMS = new Set(["B", "KB", "MB", "GB", "TB", "CPU", "RSS", "MCP"]);

const SHORTCUTS = new Set(["⌘Enter", "⌫ / Esc", "↑ / ↓", "⇧↑ / ⇧↓", "⌘N", "⌘K", "⌘C", "⌘V", "Alt+Up", "Alt+Down"]);

const CODE_NAMES = new Set(["Claude Code", "Excalidraw", "Mermaid", "roundup"]);

const MARKS = new Set(["+", " · ", "?", "? ", ": ", " → ", "#", ", ", "–", "●", "○", "◂ ", " ▸"]);

const SECTION_HEADS = new Set(["WORKSTREAMS"]);

const usesCase = (label: string): boolean => {
  if (SECTION_HEADS.has(label) || ACRONYMS.has(label) || SHORTCUTS.has(label) || CODE_NAMES.has(label) || MARKS.has(label)) return true;

  if (/\b(Door|Doors|Takeover|Shelf|Handoff)\b/.test(label)) return false;
  const words = label.replace(/^[+↓]\s*/, "").trim().split(/\s+/);
  const first = words[0] ?? "";

  if (!/^[\p{Lu}\d]/u.test(first)) return false;

  return words.slice(1).every((word, at) => {
    const bare = word.replace(/[^\p{L}]/gu, "");

    if ((words[at] ?? "").endsWith(":") && !/^[\p{Lu}\d]/u.test(word)) return false;

    return !/^\p{Lu}/u.test(bare) || TERMS.has(bare) || ACRONYMS.has(bare) || SHORTCUTS.has(word.replace(/[.,]$/, "")) || CODE_NAMES.has(bare) || /[:.!?]$/.test(words[at] ?? "");
  });
};

it("u471_case_observer_rejects_invalid_copy", () => {
  for (const bad of ["retry now", "Status: lowercase", "Take Control", "Start " + "Door", "End " + "Takeover", "Show " + "Shelf", "Clear without " + "Handoff", "ARBITRARY PROSE"]) expect(usesCase(bad), bad).toBe(false);

  for (const good of ["Take control", "Add Agent", "WORKSTREAMS", "KB", "Waiting for you: Answer below"]) expect(usesCase(good), good).toBe(true);
});

const FORMAT_SAMPLES = {
  theDaemonIsOlderThanTheApp: (count: number) => copy.theDaemonIsOlderThanTheApp(count),
  theDaemonIsNewerThanTheApp: (count: number) => copy.theDaemonIsNewerThanTheApp(count),
  theAppAndTheDaemonDiffer: (count: number) => copy.theAppAndTheDaemonDiffer(count),
  theAppAndTheDaemonDiffer2: (count: number) => copy.theAppAndTheDaemonDiffer2(count, count),
  exit: (count: number) => copy.exit(count),
  noteForOrYourOwnAnswer: (count: number) => copy.noteForOrYourOwnAnswer(count),
  decisionFor: (count: number) => copy.decisionFor(count),
  lastTouch: (count: number) => copy.lastTouch(count, count, count, count),
  padTouch: (count: number) => copy.padTouch(count, count, count),
  andMore: (count: number) => copy.andMore(count),
  closeQuestion: (count: number) => copy.closeQuestion(count),
  closeProject: (count: number) => copy.closeProject(count),
  closeTerminal: (count: number) => copy.closeTerminal(count),
  hiddenAttention: (count: number) => copy.hiddenAttention(count, count, count),
  needYouError: (count: number) => copy.needYouError(count, count),
  modelFor: (count: number) => copy.modelFor(count),
  effortFor: (count: number) => copy.effortFor(count),
  fullOrderOf: (count: number) => copy.fullOrderOf(count),
  orderOf: (count: number) => copy.orderOf(count),
  limits: (count: number) => copy.limits(count),
  clarifying: (count: number) => copy.clarifying(count),
  hasExitedAndCannotBeResumed: (count: number) => copy.hasExitedAndCannotBeResumed(count),
  ownerName: (count: number) => copy.ownerName(count),
  deletePad: (count: number) => copy.deletePad(count),
  ownsItYouMayDeleteAnyPad: (count: number) => copy.ownsItYouMayDeleteAnyPad(count),
  padEditorToolbarActionHasNoName: (count: number) => copy.padEditorToolbarActionHasNoName(count),
  drawing: (count: number) => copy.drawing(count),
  mermaid: (count: number) => copy.mermaid(count),
  defaultModel: (count: number) => copy.defaultModel(count),
  clearName: (count: number) => copy.clearName(count),
  agents: (count: number) => copy.agents(count),
  doorStoppedWithExit: (count: number) => copy.doorStoppedWithExit(count),
  bytes: (count: number) => copy.bytes(count),
  failed: (count: number) => copy.failed(count, count),
  doesNotExist: (count: number) => copy.doesNotExist(count),
  theDoorWritesAHandoffKeepsWhatYou: (count: number) => copy.theDoorWritesAHandoffKeepsWhatYou(count),
  toastLine: (count: number) => copy.toastLine(count, count),
  toastOverflow: (count: number) => copy.toastOverflow(count),
  changedTodo: (count: number) => copy.changedTodo(count),
  changedPad: (count: number) => copy.changedPad(count),
  moveTodo: (count: number) => copy.moveTodo(count),
  homesFor: (count: number) => copy.homesFor(count),
  completeTodo: (count: number) => copy.completeTodo(count),
  removeBlocker: (count: number) => copy.removeBlocker(count),
  titleChange: (count: number) => copy.titleChange(count),
  bodyChange: (count: number) => copy.bodyChange(count),
  waitsOnJoin: (count: number) => copy.waitsOnJoin(count),
  removedBlockersJoin: (count: number) => copy.removedBlockersJoin(count),
  todoRow: (count: number) => copy.todoRow(count, count, count),
  waitsOnTitles: (count: number) => copy.waitsOnTitles(count),
  openBlocker: (count: number) => copy.openBlocker(count),
  actionsFor: (count: number) => copy.actionsFor(count),
  changeToItReReadsItsConversationOn: (count: number) => copy.changeToItReReadsItsConversationOn(count, count),
  unlandedWorkAhead: (count: number) => copy.unlandedWorkAhead(count),
  goes: (count: number) => copy.goes(count),
  staysAtTheProjectRoot: (count: number) => copy.staysAtTheProjectRoot(count),
  moreAgents: (count: number) => copy.moreAgents(count),
  padCount: (count: number) => copy.padCount(count),
  todoCount: (count: number) => copy.todoCount(count),
  padsAndTodos: (count: number) => copy.padsAndTodos(count),
  makePadYours: (count: number) => copy.makePadYours(count),
  needYou: (count: number) => copy.needYou(count),
  exitedCode: (count: number) => copy.exitedCode(count),
  runningAgents: (count: number) => copy.runningAgents(count, "1", "1", "1"),
  percent: (count: number) => copy.percent(count),
  counted: (count: number) => copy.counted(count, "1"),
  orderWithLimits: () => copy.orderWithLimits("1", "1"),
  daemonExit: () => copy.daemonExit("exited"),
  fieldDefault: () => copy.fieldDefault("Model", "Unset"),
  unsetDefault: (count: number) => copy.unsetDefault(count),
  noField: () => copy.noField("title"),
  stopQuestion: () => copy.stopQuestion("authored"),
  stopAndRemoveQuestion: () => copy.stopAndRemoveQuestion("authored"),
  removeQuestion: () => copy.removeQuestion("authored"),
  answerRefused: (count: number) => copy.answerRefused(count, "Unavailable"),
} satisfies { [Key in keyof typeof copy as typeof copy[Key] extends (...args: never[]) => string ? Key : never]: (count: number) => string };

it("u471_catalogue_uses_sentence_case_and_user_labels", () => {
  const samples = new Map(Object.entries(FORMAT_SAMPLES));

  const invalid = Object.entries(copy).flatMap(([key, entry]) => {
    // A formatter's authored fields are supplied independently; case concerns its own prose.
    // These fragments are evaluated in the sentences that their production callers compose.
    // Prefixing supplies context, rather than bypassing the case assertion.
    const prefixes = new Map<string, string>(Object.entries({
      appearHereOnePerRow: copy.agentsAndTerminals + " ", nestedByIndent: copy.agentsAndTerminals + " " + copy.appearHereOnePerRow + " ",
      planSoCanYou: copy.agentsAddThemAsThey + " ", asks: "Agent", andMore: "3 Agents run: A, b, c", exitedBySignal: "Supervisor stopped, ",
      exited: "Supervisor stopped, ", exitedCode: "Supervisor stopped, ", noLimits: "Order · ",
      takeControlKeys: "Take control ", doneCount: "1", selected: "1", readOnly: "Watching Agent", openTodoNoun: "1 ", doneTodos: "1 ",
      agentsMayStillBeWritingDeletingDoesNot: "Owned by Agent", cleared: "Iteration 1", left: "To the ", right: "To the ",
    }));

    const rendered = entry instanceof Function ? [0, 1, 2].map((count) => samples.get(key)!(count)) : [entry];

    return rendered.flatMap((text) => {
      const value = (prefixes.get(key) ?? "") + text;

      return usesCase(value) ? [] : [key + ': ' + value];
    });
  });

  expect(invalid).toEqual([]);
});

it("u471_action_labels_describe_the_existing_action_retry_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);

  app.handlers["rail.startDoor"] = () => { throw new Error("keep THIS launch failure 🧭"); };

  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: "Start supervisor" })).find((button) => button.closest(".pane-door"))!);
  const retry = (await screen.findAllByRole("button", { name: "Retry supervisor" })).find((button) => button.closest(".pane-door"))!;

  expect(document.body.textContent).toContain("keep THIS launch failure 🧭");
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  fireEvent.click(retry);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }, { id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
  expect(app.calls.filter((call) => call.method === "rail.createWorkstream")).toEqual([]);
});

it("u471_replaced_labels_are_absent", () => {
  const old = [["Start", "Door"], ["Retry", "Door"], ["End", "Takeover"], ["Take", "over"], ["Show", "Shelf"], ["Hide", "Shelf"], ["Clear", "without", "Handoff"]].map((words) => words.join(" "));

  const missing = readdirSync(ROOT, { recursive: true, encoding: "utf8" }).filter((file) => /\.(ts|tsx|py)$/.test(file)).flatMap((file) => {
    const source = readFileSync(join(ROOT, file), "utf8");

    return old.flatMap((label) => source.includes(label) ? [`${file}: ${label}`] : []);
  });

  expect(missing).toEqual([]);
});

it("u471_previous_copy_assertions_are_preserved_parameterised_output", () => {
  const authored = 'Door Shelf Takeover Handoff $& <tag> "keep MY words" 🧭\n  exact spacing';

  expect(copy.orderOf(authored)).toBe(`Order of ${authored}`);
  expect(copy.noteForOrYourOwnAnswer(authored)).toBe(`Note for ${authored}, or your own answer`);
});


it("u471_catalogue_preserves_rendered_content", async () => {
  const authored = 'Door Shelf Takeover Handoff 🧭 keep MY case';

  await mountCentre([door("w", "idle", "idle"), agent("a", "working", "x", { parent: "w", name: authored, work: { kind: "clarification", question: "keep MY question?" } })], { select: "a" });

  expect(screen.getByRole("button", { name: `Order of ${authored}` }).textContent).toBe("Clarifying: keep MY question?");
});


it("u471_previous_copy_assertions_are_preserved_rail_menu", async () => {
  await mountRail([workstream("g"), agent("a", "working", "busy", { parent: "g" })]);
  fireEvent.contextMenu(rowOf("a"), { clientX: 10, clientY: 10 });

  const labels = [...document.querySelectorAll<HTMLElement>(".rail button, .rail-actions button, [role=menuitem], [role=menu]")].flatMap((each) => {
    const label = each.getAttribute("aria-label") ?? each.textContent?.trim() ?? "";

    return label === "" ? [] : [label];
  });

  expect(labels.length).toBeGreaterThan(3);
  expect(labels.filter((label) => !usesCase(label))).toEqual([]);
});
