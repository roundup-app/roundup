import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Editor, editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undo, redo } from "@milkdown/kit/prose/history";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";

Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = async (source: string) => {
  let handle: PadEditorHandle | undefined;
  let view: EditorView | undefined;
  let instance: Editor | undefined;
  const make = Editor.make.bind(Editor);
  vi.spyOn(Editor, "make").mockImplementation(() => {
    const editor = make();
    instance = editor;
    editor.onStatusChange((status) => {
      if (status === "Created") view = editor.action((ctx) => ctx.get(editorViewCtx));
    });

    return editor;
  });
  render(() => <PadRichEditor text={source} readonly={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={(ready) => { handle = ready; }} />);
  await waitFor(() => expect(handle).toBeDefined());

  if (!view || !handle || !instance) throw new Error("editor not ready");
  const editor = instance;
  const surface = view;

  const replace = (text: string) => {
    const doc = editor.action((ctx) => ctx.get(parserCtx)(text));

    if (!doc) throw new Error("fixture did not parse");
    surface.dispatch(surface.state.tr.replaceWith(0, surface.state.doc.content.size, doc.content));
  };

  return { handle, view: surface, replace, editor };
};

const table = "| A    | B    |\n| ---- | ---- |\n| one  | two  |";

it.each([
  { name: "neighbouring table and list", source: `first\n\n* keep this marker\n\n${table}\n\nlast\n\n`, edit: `changed\n\n* keep this marker\n\n${table}\n\nlast`, expected: `changed\n\n* keep this marker\n\n${table}\n\nlast\n\n` },
  { name: "two separated edits", source: `one\n\n${table}\n\nthree`, edit: `ONE\n\n${table}\n\nTHREE`, expected: `ONE\n\n${table}\n\nTHREE` },
  { name: "insertion", source: "first\n\nlast", edit: "first\n\nnew\n\nlast", expected: "first\n\nnew\n\nlast" },
  { name: "authored empty paragraph after table", source: `first\n\n${table}\n\n<br />\n`, edit: `FIRST\n\n${table}\n\n<br />`, expected: `FIRST\n\n${table}\n\n<br />\n` },
  { name: "append", source: "first", edit: "first\n\nnew", expected: "first\n\nnew" },
  { name: "initially empty", source: "", edit: "new", expected: "new" },
  { name: "prepend", source: "last\n", edit: "new\n\nlast", expected: "new\n\nlast\n" },
  { name: "delete last without final newline", source: "first\n\nlast", edit: "first", expected: "first" },
  { name: "delete last with final newline", source: "first\n\nlast\n", edit: "first", expected: "first\n" },
  { name: "nested generated heading ID", source: "> # Heading\n\nfirst", edit: "> # Heading\n\nFIRST", expected: "> # Heading\n\nFIRST" },
  { name: "deletion", source: "first\n\nremove\n\nlast\n", edit: "first\n\nlast", expected: "first\n\nlast\n" },
  { name: "formatting", source: "first\n\n* untouched\n", edit: "**first**\n\n* untouched", expected: "**first**\n\n* untouched\n" },
  { name: "non-ASCII CRLF without final newline", source: "café\r\n\r\n* 日本語", edit: "café ☕\n\n* 日本語", expected: "café ☕\r\n\r\n* 日本語" },
  { name: "reordered authored list", source: "* authored\n\nlast\n", edit: "last\n\n* authored", expected: "last\n\n* authored\n" },
  { name: "opaque definition between edited paragraphs", source: "one\n\n[ref]: https://example.com\n\nthree", edit: "ONE\n\nTHREE", expected: "ONE\n\n[ref]: https://example.com\n\nTHREE" },
  { name: "reference definition", source: "first\n\n[link][ref]\n\n[ref]: https://example.com \"title\"\n", edit: "FIRST\n\n[link](https://example.com \"title\")", expected: "FIRST\n\n[link][ref]\n\n[ref]: https://example.com \"title\"\n" },
  { name: "front matter HTML and footnote", source: "---\ntitle: Test\n---\n\nfirst\n\n<div>opaque</div>\n\n[^1]: footnote\n", edit: "---\ntitle: Test\n---\n\nFIRST\n\n<div>opaque</div>\n\n[^1]: footnote", expected: "---\ntitle: Test\n---\n\nFIRST\n\n<div>opaque</div>\n\n[^1]: footnote\n" },
])("p2544c_only_edited_ranges_change: $name", async ({ source, edit, expected }) => {
  const { handle, replace } = await open(source);
  replace(edit);
  expect(handle.getText()).toBe(expected);
});

it("p2544c_only_edited_ranges_change_distinguishes_identical_repeated_paragraphs", async () => {
  const { handle, view } = await open("same\n\n\nsame\n\n* keep");
  const second = view.state.doc.child(0).nodeSize + 1;
  view.dispatch(view.state.tr.insertText("changed", second, second + 4));
  expect(handle.getText()).toBe("same\n\n\nchanged\n\n* keep");
});

it("p2544c_repeated_saves_and_reload_preserve_bytes", async () => {
  const { handle, replace } = await open(`one\n\n${table}\n\nthree`);
  replace(`ONE\n\n${table}\n\nthree`);
  const first = `ONE\n\n${table}\n\nthree`;
  expect(handle.getText()).toBe(first);
  handle.setText(first);
  replace(`ONE\n\n${table}\n\nTHREE`);
  expect(handle.getText()).toBe(`ONE\n\n${table}\n\nTHREE`);
  handle.setText("external\n\n* authored\n");
  replace("EXTERNAL\n\n* authored");
  expect(handle.getText()).toBe("EXTERNAL\n\n* authored\n");
});

it("p2544c_ambiguous_mapping_keeps_source_and_draft", async () => {
  const { handle, view } = await open("[ref]: https://example.com\n");
  view.dispatch(view.state.tr.insertText("draft", 1));
  expect(handle.getText()).toBeNull();
  expect(view.state.doc.textContent).toBe("draft");
});

it("p2544c_new_lists_use_dash_existing_markers_survive", async () => {
  const { handle, replace } = await open("first\n\n* authored");

  replace("- new\n\nfirst\n\n* authored");
  expect(handle.getText()).toBe("- new\n\nfirst\n\n* authored");
});

const ordinary = [
  { name: "empty line", source: "<br />\n\nalpha", at: 0, keys: ["Enter"], expected: "<br />\n\n<br />\n\nalpha", empty: 2 },
  { name: "remove before", source: "<br />\n\nalpha", paragraph: 1, at: 0, keys: ["Backspace"], expected: "alpha", empty: 0 },
  { name: "remove between", source: "al\n\n<br />\n\npha", paragraph: 2, at: 0, keys: ["Backspace"], expected: "al\n\npha", empty: 0 },
  { name: "remove after", source: "alpha\n\n<br />", paragraph: 1, at: 0, keys: ["Backspace"], expected: "alpha", empty: 0 },
  { name: "exit list", source: "* alpha\n* ", paragraph: 1, at: 0, keys: ["Enter"], expected: "* alpha\n\n<br />", empty: 1 },
  { name: "exit task", source: "- [ ] alpha", at: 5, keys: ["Enter", "Enter"], expected: "- [ ] alpha\n\n<br />", empty: 1 },
  { name: "exit quote", source: "> alpha", at: 5, keys: ["Enter", "Enter"], expected: "> alpha\n\n<br />", empty: 1 },
  { name: "start", source: "alpha", at: 0, keys: ["Enter"], expected: "<br />\n\nalpha", empty: 1 },
  { name: "middle", source: "alpha", at: 2, keys: ["Enter"], expected: "al\n\npha", empty: 0 },
  { name: "end", source: "alpha", at: 5, keys: ["Enter"], expected: "alpha\n\n<br />", empty: 1 },
  { name: "twice", source: "alpha", at: 2, keys: ["Enter", "Enter"], expected: "al\n\n<br />\n\npha", empty: 1 },
  { name: "hard break", source: "alpha", at: 2, keys: ["Shift-Enter"], expected: "al  \npha", empty: 0 },
  ...["* alpha", "1. alpha", "- [ ] alpha", "- [x] alpha", "> alpha", "# alpha"].map(source => ({
    name: source, source, at: 2, keys: ["Enter"],
    expected: source.replace("alpha", "al") + (source.startsWith("#") ? "\n\n# pha" : source.startsWith(">") ? "\n>\n> pha" : "\n" + source.replace("alpha", "pha").replace("1.", "2.")), empty: 0,
  })),
  { name: "join", source: "al\n\npha", at: 0, paragraph: 1, keys: ["Backspace"], expected: "alpha", empty: 0 },
];

const fixtures = [
  { name: "paragraphs", tail: "first\n\nlast" },
  { name: "repeated", tail: "same\n\n\nsame" },
  { name: "mixed", tail: `untouched\n\n* keep this marker\n\n${table}` },
  { name: "CRLF", tail: "untouched\r\n\r\n* 日本語\r\n\r\ncafé", newline: "\r\n" },
];

const ordinaryCases = ordinary.flatMap(action => fixtures.flatMap(fixture => [false, true].map(after => ({ action, fixture, after, name: `${action.name} / ${fixture.name} / ${after ? "after" : "before"}` }))));

ordinaryCases.push({ action: { name: "initially empty", source: "", at: 0, keys: ["Enter"], expected: "<br />", empty: 2 }, fixture: { name: "initially empty", tail: "", newline: "\n" }, after: false, name: "initially empty" });

it.each(ordinaryCases)("p3557a_ordinary_edits_preserve_source: $name", async ({ action, fixture, after }) => {
  const newline = fixture.newline ?? "\n";
  const target = action.source.replace(/\n/g, newline);
  const source = fixture.tail === "" ? target : after ? fixture.tail + newline + newline + target : target + newline + newline + fixture.tail;
  const { handle, view, editor } = await open(source);
  expect(handle.getText()).toBe(source);
  const positions: number[] = [];
  view.state.doc.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1); });
  let skip = 0;

  if (after) editor.action(ctx => ctx.get(parserCtx)(fixture.tail)!.descendants(node => { if (node.isTextblock) skip++; }));
  const position = positions[skip + ("paragraph" in action ? action.paragraph! : 0)]! + action.at;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));

  const press = (key: string) => {
    const shifted = key.startsWith("Shift-");
    const name = shifted ? key.slice(6) : key;
    const event = new KeyboardEvent("keydown", { key: name, keyCode: name === "Enter" ? 13 : 8, shiftKey: shifted, bubbles: true, cancelable: true });
    expect(view.someProp("handleKeyDown", fn => fn(view, event)), key).toBeTruthy();
  };

  const check = () => {
    const text = handle.getText();
    expect(text).not.toBeNull();

    if (fixture.tail) expect(text).toContain(fixture.tail);
    expect(editor.action(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(text!)!))).toBe(editor.action(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(handle.snapshot().text)!)));

    return text!;
  };

  for (const key of action.keys) { press(key); check(); }

  const tail = fixture.tail.replace(/\r\n/g, "\n");
  const expected = tail === "" ? action.expected : after ? tail + "\n\n" + action.expected : action.expected + "\n\n" + tail;
  const trailingCaret = (after && action.name.startsWith("exit")) || fixture.name === "initially empty";
  const serialized = editor.action(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(expected + (trailingCaret ? "\n\n<br />" : ""))!));
  expect(handle.snapshot().text).toBe(serialized);
  let empties = 0;
  view.state.doc.forEach(node => { if (node.type.name === "paragraph" && node.content.size === 0) empties++; });
  expect(empties).toBe(action.empty + (!after && fixture.name === "mixed" ? 1 : after && (["* alpha", "1. alpha", "- [ ] alpha", "- [x] alpha", "> alpha"].includes(action.name) || action.name.startsWith("exit")) ? 1 : 0));
  expect(undo(view.state, view.dispatch)).toBe(true);
  expect(check()).toBe(source);
  expect(redo(view.state, view.dispatch)).toBe(true);
  expect(handle.snapshot().text).toBe(serialized);
  check();
  const saved = check();
  handle.setText(saved);
  view.dispatch(view.state.tr.insertText("! "));
  expect(view.state.doc.textContent).toContain("! ");
  const acknowledged = check();
  handle.setText(acknowledged);
  view.dispatch(view.state.tr.insertText("next"));
  expect(view.state.doc.textContent).toContain("! next");
  const next = check();
  cleanup();
  vi.restoreAllMocks();
  const reopened = await open(next);
  let start: number | undefined;
  reopened.view.state.doc.descendants((node, pos) => { if (node.isTextblock && (after || start === undefined)) start = pos + 1; });
  reopened.view.dispatch(reopened.view.state.tr.insertText("again", start));
  const reloaded = reopened.handle.getText();
  expect(reloaded).not.toBeNull();

  if (fixture.tail) expect(reloaded).toContain(fixture.tail);
  expect(reopened.editor.action(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(reloaded!)!)))
    .toBe(reopened.editor.action(ctx => ctx.get(serializerCtx)(ctx.get(parserCtx)(reopened.handle.snapshot().text)!)));
});

it("p3557a_ordinary_edits_preserve_source_after_whitespace_acknowledgement", async () => {
  const { handle, view } = await open("");

  for (const text of [" ", " ", "x", "y", "z", "q"]) {
    view.dispatch(view.state.tr.insertText(text));
    const source = handle.getText();
    expect(source).not.toBeNull();
    handle.setText(source!);
  }

  expect(view.state.doc.textContent).toBe("  xyzq");
  expect(handle.getText()).toContain("x");
});

it.each(["\n", "\r\n"].flatMap(newline => [true, false].map(final => ({ newline, final }))))("u5561b_round_trip_keeps_authored_source $newline $final", async ({ newline, final }) => {
  const section = "<details>\n<summary>For Agents</summary>\n\nPath: `日本語/café`\n\n~~~text\nraw evidence\n~~~\n\n</details>".replace(/\n/g, newline);
  const source = `Ready.${newline}${newline}${section}${final ? newline : ""}`;
  const { handle, view } = await open(source);
  expect(handle.getText()).toBe(source);
  view.dispatch(view.state.tr.insertText("Updated", 1, 6));
  expect(handle.getText()).toBe(source.replace("Ready", "Updated"));
  undo(view.state, view.dispatch);
  expect(handle.getText()).toBe(source);
});
