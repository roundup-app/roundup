import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { door, terminal } from "../testing/nodes";
import { effectiveOpacity, mountThread, threadInput } from "./threadFixture";

const tree = () => [door("workstream", "idle", "idle")];

const [sheet = ""] = Object.values(import.meta.glob<string>("./styles.css", { query: "?raw", import: "default", eager: true }));

const sends = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "message.send");

const typeText = (text: string) => {
  threadInput().value = text;
  fireEvent.input(threadInput());
};

/** jsdom applies no default action, so the test plays the textarea's own `⇧⏎`: a line break at the end. */
const shiftEnter = (init: KeyboardEventInit = {}) => {
  const proceeded = fireEvent.keyDown(threadInput(), { key: "Enter", shiftKey: true, ...init });

  if (proceeded) {
    threadInput().value += "\n";
    fireEvent.input(threadInput(), { inputType: "insertLineBreak" });
  }

  return proceeded;
};

afterEach(cleanup);

describe("u193 shift-enter adds a line", () => {
  it("u193_shift_enter_adds_a_line_and_sends_nothing", async () => {
    const { app } = await mountThread(tree());

    typeText("a");

    expect(shiftEnter()).toBe(true);

    typeText(`${threadInput().value}b`);

    expect(threadInput().value).toBe("a\nb");
    expect(sends(app)).toEqual([]);
  });

  it("u193_enter_sends_the_lines_once", async () => {
    const { app } = await mountThread(tree());

    typeText("a");
    shiftEnter();
    typeText("a\nb");

    expect(fireEvent.keyDown(threadInput(), { key: "Enter" })).toBe(false);
    await waitFor(() => expect(sends(app)).toHaveLength(1));

    expect(sends(app)[0]?.params).toMatchObject({ body: "a\nb" });
    await waitFor(() => expect(threadInput().value).toBe(""));
  });

  it.each([{ metaKey: true }, { ctrlKey: true }, { altKey: true }])("u193_enter_sends_with_%o", async (modifier) => {
    const { app } = await mountThread(tree());

    typeText("a\nb");
    fireEvent.keyDown(threadInput(), { key: "Enter", ...modifier });
    await waitFor(() => expect(sends(app)).toHaveLength(1));
  });

  it("u193_the_send_button_sends_the_lines", async () => {
    const { app } = await mountThread(tree());

    typeText("a\nb");
    fireEvent.click(document.querySelector(".thread-send")!);
    await waitFor(() => expect(sends(app)[0]?.params).toMatchObject({ body: "a\nb" }));
  });

  it("u193_enter_during_composition_never_sends", async () => {
    const { app } = await mountThread(tree());

    typeText("あ");
    fireEvent.keyDown(threadInput(), { key: "Enter", isComposing: true });
    fireEvent.keyDown(threadInput(), { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(threadInput(), { key: "Enter", shiftKey: true, isComposing: true });

    expect(sends(app)).toEqual([]);
    expect(threadInput().value).toBe("あ");
  });

  it("u193_the_field_grows_to_a_cap_then_scrolls", async () => {
    await mountThread(tree());

    expect(threadInput().tagName).toBe("TEXTAREA");
    expect(threadInput().rows).toBe(1);
    expect(sheet).toMatch(/\.thread-composer textarea\s*{[^}]*max-height:\s*calc\(var\(--space-6\) \* 5\)/);
    expect(sheet).toMatch(/\.thread-composer textarea\s*{[^}]*overflow-y:\s*auto/);

    typeText("a\nb\nc");

    for (const [lines, height] of [[1, 20], [3, 60], [20, 400]] as const) {
      Object.defineProperty(threadInput(), "scrollHeight", { configurable: true, value: height });
      typeText(Array.from({ length: lines }, () => "x").join("\n"));

      expect(threadInput().style.height).toBe(`${height}px`);
    }

    Object.defineProperty(threadInput(), "scrollHeight", { configurable: true, value: 20 });
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await waitFor(() => expect(threadInput().value).toBe(""));

    expect(threadInput().style.height).toBe("20px");
  });

  it("u193_line_breaks_reach_message_send_and_the_feed", async () => {
    const { app } = await mountThread(tree());

    typeText("a\nb");
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await waitFor(() => expect(sends(app)[0]?.params).toMatchObject({ body: "a\nb" }));

    expect(sheet).toMatch(/\.thread-body,\s*\.thread-card-body\s*{[^}]*white-space:\s*pre-wrap/);
  });

  it("u193_attachment_quote_and_dim_hold_with_lines", async () => {
    const { app, connected, emulators } = await mountThread([door("workstream", "idle", "idle", { name: "lead" }), terminal("sh", { name: "shell", parent: "workstream" })]);
    const row = () => document.querySelector<HTMLElement>('[role="tree"] [data-id="workstream"]')!;

    URL.createObjectURL = () => "blob:fake";
    URL.revokeObjectURL = () => {};

    threadInput().focus();

    // U105: ⇧⏎ on its own starts no dim; typing does and the lines keep it.
    expect(shiftEnter()).toBe(true);

    expect(effectiveOpacity(row())).toBe(1);

    // U110: the Quote lands on the first printable character, not on ⇧⏎.
    connected.rail.select("sh");
    emulators.get("t-sh")!.selectedText = "boom";
    fireEvent.keyDown(threadInput(), { key: "Enter", shiftKey: true });
    expect(document.querySelectorAll("[data-quote]")).toHaveLength(0);
    fireEvent.keyDown(threadInput(), { key: "x" });
    typeText(`${threadInput().value}x`);
    expect(document.querySelectorAll("[data-quote]")).toHaveLength(1);
    expect(effectiveOpacity(row())).toBe(0.35);

    // U109: a pasted image stays beside a two-line value.
    typeText("a\nb");
    fireEvent.paste(threadInput(), { clipboardData: { files: [new File([new Uint8Array(10)], "shot.png", { type: "image/png" })] } });
    expect(document.querySelectorAll(".thread-attachment")).toHaveLength(1);
    expect(threadInput().value).toBe("a\nb");

    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await vi.waitFor(() => expect(sends(app)).toHaveLength(1));
    expect(JSON.stringify(sends(app)[0]?.params)).toContain("a\\nb");
  });
});
