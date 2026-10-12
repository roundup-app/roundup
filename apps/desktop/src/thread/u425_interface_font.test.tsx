import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { askingWith } from "../decisions/decisionsFixture";
import { runChecks } from "../testing/checks";
import { agent, door } from "../testing/nodes";
import { message, mountThread } from "./threadFixture";

const DOOR = { kind: "agent", id: "r1", parent: null } as const;

const WIDTHS = [700, 1280];

const at = (width: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
};

const tree = () => [door("r1", "working", "editing", { name: "lead", work: { kind: "work", ask: "Do it. Then more.", limits: [] } }), agent("a", "working", "x", { parent: "r1", name: "ann" }), agent("e", "done", "x", { parent: "r1", name: "eve" })];

afterEach(() => {
  cleanup();
  at(1024);
});

describe("u425 every word of the view is in the interface font", () => {
  it.each(WIDTHS)("u425_every_text_node_in_the_view_is_in_the_interface_font at %i", async (width) => {
    at(width);
    await mountThread(tree(), {
      messages: [message(1, { from: DOOR, to: "you", kind: "question", body: "go on?" }), message(2, { from: DOOR, to: "you", kind: "note", body: "hello" })],
      prepare: (app) => {
        app.handlers["decision.list"] = () => [askingWith("d1", "a", "Which?", [{ label: "A", description: "a" }])];
      },
    });
    await vi.waitFor(() => expect(document.querySelector("[data-question]")).not.toBeNull());
    fireEvent.click(document.querySelector(".thread-done-head")!);

    const walker = document.createTreeWalker(document.querySelector(".thread")!, NodeFilter.SHOW_TEXT);
    const wrong: string[] = [];

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement!;

      if (!node.textContent?.trim() || parent.closest("code, pre, [data-mono]")) continue;

      if (getComputedStyle(parent).fontFamily !== "var(--font-ui)") wrong.push(`${parent.className}: ${node.textContent.trim()}`);
    }

    expect(wrong).toEqual([]);
  });

  it("u425_d16_passes_on_the_view_and_fails_a_mono_word", async () => {
    await mountThread(tree());

    expect(runChecks().D16).toMatchObject({ status: "pass" });

    const name = document.querySelector<HTMLElement>(".thread-row-name")!;

    name.style.fontFamily = "var(--font-mono)";
    expect(runChecks().D16).toMatchObject({ status: "fail", value: { mono: 1 } });

    name.style.fontFamily = "";
    name.style.whiteSpace = "normal";
    expect(runChecks().D16).toMatchObject({ status: "fail", value: { wrapping: 1 } });
  });
});
