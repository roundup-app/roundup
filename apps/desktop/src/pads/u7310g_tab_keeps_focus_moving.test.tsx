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

it("u7310g_tab_leaves_a_paragraph_without_writing", async () => {
  const { app } = await openShelf([
    padOf(
      "note",
      USER,
      "Paragraph\n\n# Heading\n\n> Quote\n\n- one\n- two\n\n```\ncode\n```\n\n| left | right |\n| --- | --- |\n| a1 | a2 |\n",
    ),
  ]);

  let view: EditorView | undefined;
  const make = Editor.make.bind(Editor);

  vi.spyOn(Editor, "make").mockImplementation(() => {
    const editor = make();

    editor.onStatusChange((status) => {
      if (status === "Created")
        view = editor.action((ctx) => ctx.get(editorViewCtx));
    });

    return editor;
  });
  const field = await openPad("note");
  const body = screen.getByRole("textbox", { name: "Pad body" });
  const user = userEvent.setup();

  if (!view) throw new Error("editor did not open");

  const editor = view;

  /** The caret goes after the first character of the text node that reads `text`, and the body holds focus; a frame first, since Crepe's list block puts its own caret back one frame after a list Tab. */
  const focusIn = async (text: string) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    let at = -1;

    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === text) at = pos + 1;
    });

    if (at < 0) throw new Error(`no text reads ${text}`);
    editor.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)),
    );
    editor.focus();
    expect(document.activeElement).toBe(body);
  };

  const written = field.value;

  // The next or previous control can be a heading's fold control inside the body, so the proof is that the body no longer holds focus.
  for (const text of ["Paragraph", "Heading", "Quote"])
    for (const shift of [false, true]) {
      await focusIn(text);
      await user.tab({ shift });
      expect(document.activeElement, `${text} shift=${shift}`).not.toBe(body);
      expect(field.value).toBe(written);
    }

  await focusIn("two");
  await user.tab();
  expect(document.activeElement).toBe(body);
  expect(field.value).toMatch(/- one\n\s+- two/);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(body);
  expect(field.value).toBe(written);

  await focusIn("code");
  await user.tab();
  expect(document.activeElement).toBe(body);
  expect(field.value).toContain("c    ode");

  await focusIn("left");
  const cell = editor.state.selection.from;
  const indented = field.value;
  await user.tab();
  expect(document.activeElement).toBe(body);
  expect(editor.state.selection.from).toBeGreaterThan(cell);
  expect(field.value).toBe(indented);

  expect(
    app.calls.filter(
      (call) => call.method === "pad.write" || call.method === "todo.update",
    ),
  ).toEqual([]);
});
