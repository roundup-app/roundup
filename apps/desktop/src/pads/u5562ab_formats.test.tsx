import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import PadRichEditor from "./PadRichEditor";
import type { PadEditorHandle } from "./PadRichEditor";

Range.prototype.getClientRects ??= () => document.body.getClientRects();
Range.prototype.getBoundingClientRect ??= () => new DOMRect();
afterEach(cleanup);

it.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])("u5562a_callouts_in_each_pad_view: %s", async kind => {
  const source = `> [!${kind}]\n> Keep this\n> and this\n\nOrdinary\n`;
  let editor: PadEditorHandle | undefined;
  const { container } = render(() => <PadRichEditor text={source} readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; }} />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(container.querySelector(`[data-pad-callout="${kind.toLowerCase()}"]`)?.textContent).toContain("Keep this");
  expect(container.querySelector(".ProseMirror")?.textContent).not.toContain(`[!${kind}]`);
  expect(editor!.getText()).toBe(source);
});

it("u5562b_selection_colour_and_highlight", async () => {
  const source = '<mark><span data-pad-color="blue">a *linked* [word](https://example.com)</span></mark>\n';
  let editor: PadEditorHandle | undefined;
  const { container } = render(() => <PadRichEditor text={source} readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; }} />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(container.querySelector('mark [data-pad-color="blue"] a')?.textContent).toBe("word");
  expect(container.querySelector('mark em')?.textContent).toBe("linked");
  expect(editor!.getText()).toBe(source);
});
