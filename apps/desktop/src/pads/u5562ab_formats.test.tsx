import { cleanup, render, waitFor, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { openShelf, openPad, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";
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
  expect(container.querySelector(`[data-pad-callout="${kind.toLowerCase()}"]`)).not.toBeNull();
  expect(container.querySelector(".ProseMirror")?.textContent).not.toContain(`[!${kind}]`);
  expect(editor!.getText()).toBe(source);
});

it("u5562b_selection_colour_and_highlight", async () => {
  const source = '<mark><span data-pad-color="blue">a *linked* [word](https://example.com)</span></mark>\n';
  let editor: PadEditorHandle | undefined;
  const { container } = render(() => <PadRichEditor text={source} readonly={false} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; }} />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(container.querySelector('a mark [data-pad-color="blue"]')).not.toBeNull();
  expect(container.querySelector('em mark')).not.toBeNull();
  expect(editor!.getText()).toBe(source);
});


it.each(["Blue", "Green", "Purple", "Red", "Amber"])("u5562b_selection_colour_and_highlight: %s", async colour => {
  const { app, connected } = await openShelf([padOf("note", USER, "before word after")]);
  const field = await openPad("note");
  field.setSelectionRange(8, 12, "forward");
  fireEvent.pointerDown(screen.getByRole("button", { name: "Text colour" }));
  fireEvent.pointerDown(await screen.findByRole("button", { name: colour }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }));
  await waitFor(() => expect(field.value).toBe(`before <mark><span data-pad-color="${colour.toLowerCase()}">word</span></mark> after`));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Text colour" }));
  fireEvent.pointerDown(await screen.findByRole("button", { name: "Default" }));
  expect(field.querySelector("[data-pad-color]")).toBeNull();
  expect(field.value).toBe("before <mark>word</mark> after");
  fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }));
  expect(field.querySelector("mark")).toBeNull();
  connected.drawer.close();
  expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(0);
});


it("u5562b_colour_action_saves_and_reopens", async () => {
  const { app, connected } = await openShelf([padOf("note", USER, "word")]);
  const field = await openPad("note");
  field.setSelectionRange(1, 5, "forward");
  fireEvent.pointerDown(screen.getByRole("button", { name: "Text colour" }));
  fireEvent.pointerDown(await screen.findByRole("button", { name: "Blue" }));
  fireEvent.pointerDown(screen.getByRole("button", { name: "Highlight" }));
  fireEvent.focusOut(field);
  await waitFor(() => expect(app.calls.filter(call => call.method === "pad.write")).toHaveLength(1));
  const write = app.calls.find(call => call.method === "pad.write")!;
  expect(write.params).toMatchObject({ text: '<mark><span data-pad-color="blue">word</span></mark>' });
  connected.drawer.close();
  const reopened = await openPad("note");
  expect(reopened.value).toBe('<mark><span data-pad-color="blue">word</span></mark>');
});

it("u5562b_markup_is_inert", async () => {
  const source = '<span data-pad-color="blue" onclick="alert(1)">handler</span> <span data-pad-color="unknown">unknown</span> <mark style="color:red">style</mark> <script>alert(1)</script>\n';
  let editor: PadEditorHandle | undefined;
  const { container } = render(() => <PadRichEditor text={source} readonly={true} autofocus={false} onChange={() => {}} onText={() => {}} onBlur={() => {}} onReady={ready => { editor = ready; }} />);
  await waitFor(() => expect(editor).toBeDefined());
  expect(container.querySelector('script, [onclick], [data-pad-color], mark')).toBeNull();
  expect(editor!.getText()).toBe(source);
});
