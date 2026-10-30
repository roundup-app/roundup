// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { showEverythingInApp } from "./showEverything";
import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { RequestedApp as App } from "../testing/requestedApp";
import { bundledRenderers, useRenderers } from "../pads/visualKinds";
import { fakeEmulators } from "../terminal/paneHarness";
import { createFakeApp } from "./fakeApp";
import { padHandlers } from "./stores";
import { workstream } from "./nodes";
import { showShelfTab } from "./shelfTabs";

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
});

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

// jsdom has no layout; ProseMirror asks a Range for its rectangles when a selection moves.
Range.prototype.getClientRects ??= () => document.body.getClientRects();

Range.prototype.getBoundingClientRect ??= () => new DOMRect();

const mermaid = "```mermaid\ngraph TD\n  A --> B\n```\n";

const drawing = '```excalidraw\n{"type":"excalidraw","version":2,"elements":[{"type":"rectangle","id":"a","x":0,"y":0,"width":160,"height":80}]}\n```\n';

describe("u148, u149 the open Drawer renders stored blocks", () => {
  it("u149_a_stored_drawing_renders_in_the_open_drawer", async () => {
    useRenderers({
      mermaid: async () => ({ initialize: () => undefined, parse: async () => undefined, render: async () => ({ svg: "<svg></svg>" }) }),
      canvas: async () => ({
        Excalidraw: () => createElement("div", { "data-testid": "canvas" }),
        convertToExcalidrawElements: (skeleton) => skeleton.map((element, index) => ({ id: String(element.id ?? index), version: 1 })),
        restoreElements: (stored) => stored.map((element, index) => ({ id: String(element.id ?? index), version: 1 })),
      }),
    });
    const app = createFakeApp();
    app.opened.project = { name: "drawings", path: "/project" };
    const state = { pads: [{ incarnation: "stored-sketch", name: "sketch",  home: null, text: `${mermaid}\n${drawing}`, revision: 1, updated_at: 0 }], history: [] };
    app.handlers["rail.tree"] = () => [workstream("scope", { name: "scope" })];
    Object.assign(app.handlers, padHandlers(state, () => {}));
    render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} />);
    await screen.findByRole("tablist", { name: "Bench" }, { timeout: 20_000 });
    await showEverythingInApp(/scope/);
    showShelfTab("Pads");

    const group = await waitFor(() => {
      const branch = document.querySelector('[data-shelf-group="unassigned"] [data-part="branch-control"]');

      expect(branch).not.toBeNull();

      return branch!;
    });

    if (group.closest("[data-shelf-group]")?.getAttribute("aria-expanded") === "false") fireEvent.click(group.closest('[data-part="branch-control"]')!);
    const row = await screen.findByRole("button", { name: "sketch" }, { timeout: 20_000 });
    fireEvent.keyDown(row, { key: "Enter" });

    await screen.findByTestId("canvas", {}, { timeout: 20_000 });
    await waitFor(() => expect(document.querySelectorAll(".visual-block").length).toBe(2));
  }, 60_000);
});
