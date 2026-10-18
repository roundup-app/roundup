import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { Editor, editorViewCtx, parserCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
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

  return { handle, view: surface, replace };
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
  { name: "split", source: "first last\n\n* untouched", edit: "first\n\nlast\n\n* untouched", expected: "first\n\nlast\n\n* untouched" },
  { name: "join", source: "first\n\nlast\n\n* untouched", edit: "first last\n\n* untouched", expected: "first last\n\n* untouched" },
  { name: "non-ASCII CRLF without final newline", source: "café\r\n\r\n* 日本語", edit: "café ☕\n\n* 日本語", expected: "café ☕\r\n\r\n* 日本語" },
  { name: "reordered authored list", source: "* authored\n\nlast\n", edit: "last\n\n* authored", expected: "last\n\n* authored\n" },
  { name: "new unordered list", source: "first\n\n* authored", edit: "- new\n\nfirst\n\n* authored", expected: "- new\n\nfirst\n\n* authored" },
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

it("p2544c_no_edit_preserves_bytes_including_undo_redo", async () => {
  const source = `first\n\n${table}\n\n`;
  const { handle, view } = await open(source);
  expect(handle.getText()).toBe(source);
  view.dispatch(view.state.tr.insertText("!", 6));
  expect(handle.getText()).toBe(`first!\n\n${table}\n\n`);
  undo(view.state, view.dispatch);
  expect(handle.getText()).toBe(source);
  redo(view.state, view.dispatch);
  expect(handle.getText()).toBe(`first!\n\n${table}\n\n`);
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
