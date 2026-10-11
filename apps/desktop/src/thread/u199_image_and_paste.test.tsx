import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { door } from "../testing/nodes";
import { mountThread, threadInput } from "./threadFixture";

const image = (name: string) => new File([new Uint8Array(10)], name, { type: "image/png" });

const chips = () => [...document.querySelectorAll(".thread-attachment")].map((chip) => chip.textContent?.trim());

const forty = Array.from({ length: 40 }, (_, at) => `line ${at}`).join("\n");

const sends = (app: { calls: { method: string; params: unknown }[] }) => app.calls.filter((call) => call.method === "message.send");

// SAFETY: a `message.send` call's params always hold `body`.
const bodyOf = (call: { params: unknown }): string => (call.params as { body: string }).body;

const rect = (element: Element) =>
  (element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 60, width: 100, height: 50, x: 10, y: 10, toJSON: () => ({}) }));

beforeEach(() => {
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
});

afterEach(cleanup);

describe("u199 the Thread's input takes an image and shows long text as a placeholder", () => {
  it("u199_a_pasted_image_in_items_becomes_an_attachment", async () => {
    await mountThread([door("workstream", "idle", "idle")]);
    const file = image("shot.png");

    fireEvent.paste(threadInput(), { clipboardData: { files: [], items: [{ kind: "file", type: "image/png", getAsFile: () => file }] } });

    expect(chips()).toEqual(["shot.png 10 B"]);
    expect(threadInput().value).toBe("");
  });

  it("u199_a_native_drop_of_an_image_path_becomes_an_attachment", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    rect(document.querySelector(".thread-composer")!);
    await waitFor(() => expect(app.dropFiles).toBeDefined());
    app.dropFiles({ phase: "drop", paths: ["/p/dir/Shot.PNG"], x: 20, y: 20 });
    app.dropFiles({ phase: "drop", paths: ["/p/outside.png"], x: 500, y: 500 });

    expect(chips()).toEqual(["Shot.PNG"]);
  });

  it("u199_a_native_drop_of_a_text_file_is_refused", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    rect(document.querySelector(".thread-composer")!);
    app.dropFiles({ phase: "drop", paths: ["/p/notes.txt"], x: 20, y: 20 });

    expect(chips()).toEqual([]);
    expect(document.querySelector("[role=alert]")?.textContent).toContain("notes.txt is not an image");
  });

  it("u199_a_long_paste_shows_a_placeholder", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => "a\nb\nc\nd" } })).toBe(false);
    expect(threadInput().value).toBe("[Pasted text #1 +3 lines]");
  });

  it("u199_a_short_paste_shows_as_typed", async () => {
    await mountThread([door("workstream", "idle", "idle")]);

    expect(fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => "a\nb\nc" } })).toBe(true);
  });

  it("u199_backspace_removes_a_placeholder_whole", async () => {
    await mountThread([door("workstream", "idle", "idle")]);
    fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => forty } });
    fireEvent.keyDown(threadInput(), { key: "Backspace" });

    expect(threadInput().value).toBe("");
  });

  it("u199_the_full_text_reaches_message_send", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => forty } });
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(sends(app)).toHaveLength(1));
    expect(bodyOf(sends(app)[0]!)).toBe(forty);
    expect(threadInput().value).toBe("");

    fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => forty } });

    expect(threadInput().value).toBe("[Pasted text #1 +39 lines]");
  });

  it("u199_a_deleted_placeholder_sends_no_text", async () => {
    const { app } = await mountThread([door("workstream", "idle", "idle")]);

    fireEvent.paste(threadInput(), { clipboardData: { files: [], getData: () => forty } });
    threadInput().value = "hi [Pasted text #1 +39 line";
    fireEvent.input(threadInput());
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(sends(app)).toHaveLength(1));
    expect(bodyOf(sends(app)[0]!)).toBe("hi [Pasted text #1 +39 line");
  });
});
