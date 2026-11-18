import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";
import { ToastHost } from "../testing/toastHost";

Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

afterEach(cleanup);

// The Todo body's own mount (`todos/EditableText.tsx`): `item="todo"` with its field label.
it("u7312b_a_todo_body_renders_a_callout", async () => {
  const source = "> [!IMPORTANT]\n> Ship it\n\nAfter\n";
  let editor: PadEditorHandle | undefined;
  const { container } = render(() => <ToastHost><PadRichEditor item="todo" label="Body" text={source} readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={(ready) => { editor = ready; }} /></ToastHost>);
  await waitFor(() => expect(editor).toBeDefined());

  expect(container.querySelector("[data-pad-callout='important']")?.textContent).toMatch(/Ship it/);
  expect(container.querySelector(".ProseMirror")?.textContent).not.toMatch(/\[!IMPORTANT\]/);
  expect(editor?.getText()).toBe(source);
});
