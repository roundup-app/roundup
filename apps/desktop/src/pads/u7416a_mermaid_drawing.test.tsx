import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { copy } from "./copy";
import { AGENT, openPad, openShelf, padOf } from "./padsFixture";
import type { CanvasApi, CanvasProps } from "./drawingBlock";
import { bundledRenderers, useRenderers } from "./visualKinds";

let props: CanvasProps | undefined;

let converted: string[] = [];

const flow = "flowchart TD\n  A[Plan] --> B[Ship]";

const fake: CanvasApi = {
  convertToExcalidrawElements: (skeleton) => skeleton.map((element, index) => ({ id: String(element.id ?? `e${index}`), version: 1 })),
  restoreElements: (stored) => stored.map((element) => ({ id: String(element.id), version: element.version ?? 1 })),
  fromMermaid: async (text) => {
    converted.push(text);

    if (!text.startsWith("flowchart") && !text.startsWith("sequenceDiagram")) throw new Error("no parser");

    return [{ id: "plan", version: 1 }, { id: "ship", version: 1 }, { id: "edge", version: 1 }];
  },
  Excalidraw: (next) => {
    props = next;

    return createElement("div", { "data-testid": "canvas" }, `${next.initialData.elements.length} elements`);
  },
};

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

beforeEach(() => {
  useRenderers({ ...bundledRenderers, canvas: async () => fake });
});

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
  props = undefined;
  converted = [];
});

const writes = (calls: { method: string; params?: unknown }[]) => calls.filter((call) => call.method === "pad.write");

describe("u7416a a Drawing block holding Mermaid shows an auto-laid-out scene", () => {
  it("u7416a_a_mermaid_flowchart_block_mounts_labelled_nodes_and_arrows", async () => {
    await openShelf([padOf("note", AGENT, `\`\`\`excalidraw\n${flow}\n\`\`\`\n`)]);
    await openPad("note");

    await screen.findByTestId("canvas");
    expect(props?.initialData.elements).toHaveLength(3);
    expect(converted).toEqual([flow]);
  });

  it("u7416a_an_unedited_mermaid_block_keeps_its_source_byte_for_byte", async () => {
    const source = `\`\`\`excalidraw\n${flow}\n\`\`\`\n`;
    const { app, connected, state } = await openShelf([padOf("note", AGENT, source)]);
    const field = await openPad("note");

    await screen.findByTestId("canvas");
    props?.onChange(props.initialData.elements);
    fireEvent.focusOut(field);
    connected.drawer.close();
    await new Promise((done) => setTimeout(done, 0));

    expect(writes(app.calls)).toHaveLength(0);
    expect(state.pads[0]?.text).toBe(source);
  });

  it("u7416a_the_first_edit_stores_the_full_scene_in_one_write", async () => {
    const { app, connected } = await openShelf([padOf("note", AGENT, `\`\`\`excalidraw\n${flow}\n\`\`\`\n`)]);
    const field = await openPad("note");
    const host = (await screen.findByTestId("canvas")).closest(".visual-drawing");

    if (!host || !props) throw new Error("the canvas did not mount");
    fireEvent.pointerDown(host);
    const [first, ...rest] = props.initialData.elements;

    if (!first) throw new Error("no elements");
    props.onChange([{ ...first, version: 2 }, ...rest]);
    fireEvent.focusOut(field);
    connected.drawer.close();

    await waitFor(() => expect(writes(app.calls)).toHaveLength(1));
    expect(JSON.stringify(writes(app.calls)[0]?.params)).toContain("\\\"type\\\":\\\"excalidraw\\\"");
  });

  it("u7416a_a_malformed_block_shows_the_not_a_scene_line_never_a_blank_canvas", async () => {
    await openShelf([padOf("note", AGENT, "```excalidraw\nnot a diagram\n```\n")]);
    await openPad("note");

    await waitFor(() => expect(document.querySelectorAll(".visual-error")).toHaveLength(1));
    expect(document.querySelector(".visual-error")?.textContent).toBe(copy.notAnExcalidrawScene);
    expect(screen.queryByTestId("canvas")).toBeNull();
  });

  it("u7416a_the_converter_loads_only_for_a_mermaid_body", async () => {
    await openShelf([padOf("note", AGENT, '```excalidraw\n{"type":"excalidraw","elements":[]}\n```\n')]);
    await openPad("note");

    await screen.findByTestId("canvas");
    expect(converted).toEqual([]);
  });
});
