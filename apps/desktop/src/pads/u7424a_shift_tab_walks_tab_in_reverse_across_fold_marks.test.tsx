import { cleanup, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { Editor, editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import type { EditorView } from "@milkdown/kit/prose/view";
import { afterEach, expect, it, vi } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("u7424a_shift_tab_walks_tab_in_reverse_across_fold_marks", async () => {
  const { app } = await openShelf([padOf("note", USER, "First\n\n# Heading\n\nSecond\n")]);

  let view: EditorView | undefined;
  const make = Editor.make.bind(Editor);

  vi.spyOn(Editor, "make").mockImplementation(() => {
    const editor = make();

    editor.onStatusChange((status) => {
      if (status === "Created") view = editor.action((ctx) => ctx.get(editorViewCtx));
    });

    return editor;
  });
  const field = await openPad("note");
  const body = screen.getByRole("textbox", { name: "Pad body" });
  const user = userEvent.setup();

  if (!view) throw new Error("editor did not open");

  const editor = view;
  const written = field.value;
  let at = -1;

  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "First") at = pos + 1;
  });
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  editor.focus();
  expect(document.activeElement).toBe(body);

  const mark = body.querySelector("summary");

  const walk = async (shift: boolean) => {
    const seen: (Element | null)[] = [];

    do {
      await user.tab({ shift });
      seen.push(document.activeElement);
    } while (body.contains(document.activeElement) && document.activeElement !== body && seen.length < 5);

    return seen;
  };

  const forward = await walk(false);
  expect(forward[0]).toBe(mark);
  expect(forward).toHaveLength(2);
  expect(body.contains(forward[1] ?? null)).toBe(false);

  const backward = await walk(true);
  expect(backward[0]).toBe(mark);
  expect(backward.at(-1)).toBe(body);

  // Shift+Tab from the second paragraph's caret stops on the heading's mark, not outside the body.
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "Second") at = pos + 1;
  });
  editor.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
  editor.focus();
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(mark);

  expect(field.value).toBe(written);
  expect(app.calls.filter((call) => call.method === "pad.write" || call.method === "todo.update")).toEqual([]);
});
