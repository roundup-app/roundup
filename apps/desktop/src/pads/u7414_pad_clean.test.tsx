import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createElement } from "react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { notices } from "../testing/notices";
import { copy } from "./copy";
import { USER } from "./owner";
import { openPad, openShelf, padOf, RpcError } from "./padsFixture";
import type { CanvasApi, CanvasProps } from "./drawingBlock";
import { bundledRenderers, useRenderers } from "./visualKinds";

let props: CanvasProps | undefined;

const fake: CanvasApi = {
  convertToExcalidrawElements: (skeleton) => skeleton.map((element, index) => ({ id: String(element.id ?? `e${index}`), version: 1 })),
  restoreElements: (stored) => stored.map((element) => ({ id: String(element.id), version: element.version ?? 1 })),
  fromMermaid: async () => [],
  exportToSvg: async () => "",
  Excalidraw: (next) => {
    props = next;

    return createElement("div", { "data-testid": "canvas", "data-tools": String(!next.viewModeEnabled) });
  },
};

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

beforeEach(() => useRenderers({ ...bundledRenderers, canvas: async () => fake }));

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
  props = undefined;
});

const body = (field: HTMLElement) => field.closest<HTMLElement>(".pad-editor") ?? field;

it("u7414a_the_pad_shows_no_saved_caption", async () => {
  const { app } = await openShelf([padOf("notes", USER, "old")]);
  const field = await openPad("notes");

  app.handlers["pad.write"] = ({ text }) => padOf("notes", USER, text);
  fireEvent.input(field, { target: { value: "new" } });
  fireEvent.focusOut(field);
  await waitFor(() => expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(1));
  await new Promise((done) => setTimeout(done, 0));
  expect(document.querySelector(".pad-head .message-body")).toBeNull();
  expect(notices("status")).toEqual([]);

  app.handlers["pad.write"] = () => { throw new RpcError(-32002, "Write refused"); };

  fireEvent.input(field, { target: { value: "newer" } });
  fireEvent.focusOut(field);
  await waitFor(() => expect(notices("alert")).toHaveLength(1));
});

it("u7414b_a_click_in_the_body_focuses_the_editor", async () => {
  await openShelf([padOf("empty", USER, ""), padOf("full", USER, "one two")]);
  const empty = await openPad("empty");

  fireEvent.click(body(empty));

  await waitFor(() => expect(document.activeElement).toBe(empty.querySelector(".ProseMirror") ?? empty));
  expect(empty.selectionStart).toBe(empty.selectionEnd);
  expect(empty.selectionStart).toBe(1);
  cleanup();

  await openShelf([padOf("full", USER, "one two")]);
  const full = await openPad("full");

  fireEvent.click(body(full));
  await waitFor(() => expect(full.selectionStart).toBe("one two".length + 1));
});

const scene = '{"type":"excalidraw","version":2,"elements":[{"type":"rectangle","id":"a","version":1}]}';

const block = `\`\`\`excalidraw\n${scene}\n\`\`\`\n`;

const tools = () => screen.getByTestId("canvas").dataset.tools;

it("u7414c_edit_toggles_the_drawings_tools", async () => {
  const { app } = await openShelf([padOf("note", USER, block)]);

  await openPad("note");
  await screen.findByTestId("canvas");
  expect(tools()).toBe("false");
  expect(props?.zenModeEnabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: copy.editDrawing }));
  await waitFor(() => expect(tools()).toBe("true"));
  expect(props?.zenModeEnabled).toBe(false);
  expect(screen.queryByRole("button", { name: copy.editDrawing })).toBeNull();

  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(tools()).toBe("false"));
  expect(app.calls.filter((call) => call.method === "pad.write")).toHaveLength(0);
});

it("u7414c_escape_leaves_drawing_edit", async () => {
  await openShelf([padOf("note", USER, block)]);
  await openPad("note");
  await screen.findByTestId("canvas");

  fireEvent.click(screen.getByRole("button", { name: copy.editDrawing }));
  await waitFor(() => expect(tools()).toBe("true"));
  fireEvent.keyDown(screen.getByTestId("canvas"), { key: "Escape" });
  await waitFor(() => expect(tools()).toBe("false"));
  expect(props?.viewModeEnabled).toBe(true);
});
