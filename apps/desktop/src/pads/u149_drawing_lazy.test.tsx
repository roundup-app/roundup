import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { openPad, openShelf, padOf } from "./padsFixture";
import { USER } from "../testing/nodes";
import { bundledRenderers, useRenderers } from "./visualKinds";

afterEach(() => {
  cleanup();
  useRenderers(bundledRenderers);
});

describe("u149 the canvas loads only when a Drawing is present", () => {
  it("u149_a_pad_without_a_drawing_never_requests_the_module", async () => {
    let requested = 0;

    useRenderers({
      ...bundledRenderers,
      canvas: async () => {
        requested += 1;
        throw new Error("The canvas was requested");
      },
    });
    await openShelf([padOf("note", USER, "# Heading\n\n```json\n{}\n```\n")]);
    await openPad("note");

    await new Promise((done) => setTimeout(done, 20));
    expect(requested).toBe(0);
  });

  it("u149_choosing_drawing_in_the_slash_menu_inserts_one_block_and_loads_the_module", async () => {
    let requested = 0;

    useRenderers({
      ...bundledRenderers,
      canvas: async () => {
        requested += 1;

        return { Excalidraw: () => null, convertToExcalidrawElements: () => [], restoreElements: () => [] };
      },
    });
    await openShelf([padOf("note", USER, "")]);
    await openPad("note");

    const field = document.querySelector<HTMLElement>(".ProseMirror")!;
    const paragraph = field.querySelector("p")!;

    paragraph.textContent = "/draw";
    getSelection()?.collapse(paragraph.firstChild, 5);
    document.dispatchEvent(new Event("selectionchange"));
    // ProseMirror reads the typed text from its mutation observer.
    await new Promise((done) => setTimeout(done, 50));
    expect(requested).toBe(0);
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(requested).toBe(1));
    expect(field.querySelector("pre")).not.toBeNull();
  });
});
