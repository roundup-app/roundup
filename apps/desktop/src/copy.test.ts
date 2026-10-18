import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { door, workstream } from "./testing/nodes";
import { copy } from "./copy";
import { mountRailAndPane } from "./terminal/paneHarness";

afterEach(cleanup);

it("u471_action_labels_describe_the_existing_action_start_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: copy.start })).find((button) => button.closest(".pane-door"))!);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
});

import { parse } from "@babel/parser";
import { isNode } from "@babel/types";
import type { Node } from "@babel/types";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

    if (!text.trim() || STRUCTURE.has(text) && !uiAttribute && !inContent && !textBinding || /^(--|\.|\[|#|var\(|translate|calc\(|rgba|https|url\(|@|\.\.\/|\/)/.test(text)) return;

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

it("u471_action_labels_describe_the_existing_action_retry_supervisor", async () => {
  const { app, connected } = await mountRailAndPane([workstream("w")]);

  app.handlers["rail.startDoor"] = () => { throw new Error("keep THIS launch failure 🧭"); };

  connected.rail.select("w");
  fireEvent.click((await screen.findAllByRole("button", { name: copy.start })).find((button) => button.closest(".pane-door"))!);
  const retry = (await screen.findAllByRole("button", { name: copy.retry })).find((button) => button.closest(".pane-door"))!;

  expect(document.body.textContent).toContain("keep THIS launch failure 🧭");
  app.handlers["rail.startDoor"] = () => door("w", "working", "starting");
  fireEvent.click(retry);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "rail.startDoor").map((call) => call.params)).toEqual([{ id: "w" }, { id: "w" }]));
  expect(connected.rail.selected()).toBe("w");
  expect(app.calls.filter((call) => call.method === "rail.createWorkstream")).toEqual([]);
});
