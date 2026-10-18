import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import type { EditorView } from "@milkdown/kit/prose/view";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";

afterEach(cleanup);

it("p2544c_only_edited_ranges_change_keeps_authored_neighbouring_blocks", async () => {
  const source = "first\n\n* keep this marker\n\n| A    | B    |\n| ---- | ---- |\n| one  | two  |\n\nlast\n\n";
  const expected = "changed\n\n* keep this marker\n\n| A    | B    |\n| ---- | ---- |\n| one  | two  |\n\nlast\n\n";
  let handle: PadEditorHandle | undefined;
  let view: EditorView | undefined;
  const make = Editor.make.bind(Editor);
  const originalMake = Editor.make;
  Editor.make = () => {
    const editor = make();
    editor.onStatusChange((status) => {
      if (status === "Created") view = editor.action((ctx) => ctx.get(editorViewCtx));
    });
    return editor;
  };
  try {
    render(() => <PadRichEditor text={source} readonly={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={(ready) => { handle = ready; }} />);
    await waitFor(() => expect(handle).toBeDefined());
    if (!view || !handle) throw new Error("editor not ready");
    view.dispatch(view.state.tr.insertText("changed", 1, 6));
    expect(handle.getText()).toBe(expected);
  } finally {
    Editor.make = originalMake;
  }
});
