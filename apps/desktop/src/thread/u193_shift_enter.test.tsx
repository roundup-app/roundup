import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountThread, threadInput } from "./threadFixture";

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

  if (proceeded) typeText(`${threadInput().value}\n`);

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

    expect(threadInput().style.height).toMatch(/px$/);

    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await waitFor(() => expect(threadInput().value).toBe(""));

    expect(threadInput().style.height).toBe("0px");
  });

  it("u193_line_breaks_reach_message_send_and_the_feed", async () => {
    const { app } = await mountThread(tree());

    typeText("a\nb");
    fireEvent.keyDown(threadInput(), { key: "Enter" });
    await waitFor(() => expect(sends(app)[0]?.params).toMatchObject({ body: "a\nb" }));

    expect(sheet).toMatch(/\.thread-body,\s*\.thread-card-body\s*{[^}]*white-space:\s*pre-wrap/);
  });
});
