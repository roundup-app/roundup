import { cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { door, USER } from "../testing/nodes";
import { message, mountThread, sent, threadInput } from "./threadFixture";

const image = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });

const paste = (file: File) => fireEvent.paste(threadInput(), { clipboardData: { files: [file] } });

const rect = (element: Element) =>
  (element.getBoundingClientRect = () => ({ left: 10, top: 10, right: 110, bottom: 60, width: 100, height: 50, x: 10, y: 10, toJSON: () => ({}) }));

const calls = (app: { calls: { method: string; params: unknown }[] }, method: string) => app.calls.filter((call) => call.method === method);

// SAFETY: a `message.send` call's params always hold `body`.
const bodyOf = (call: { params: unknown }): string => (call.params as { body: string }).body;

const chips = () => [...document.querySelectorAll(".thread-attachment")].map((chip) => chip.textContent?.trim());

const tree = [door("workstream", "idle", "idle")];

beforeEach(() => {
  URL.createObjectURL = () => "blob:fake";
  URL.revokeObjectURL = () => {};
});

afterEach(cleanup);

describe("u419 an Attachment is sent to the Door as a file path in the Message", () => {
  it("u419_a_pasted_attachment_is_saved_then_sent", async () => {
    const { app } = await mountThread(tree, { prepare: (fake) => (fake.handlers["attachment.save"] = (params) => ({ path: `/d/attachments/1-${params.name}` })) });

    paste(image("a.png"));
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    expect(calls(app, "attachment.save")[0]!.params).toEqual({ name: "a.png", data: "AQID" });
    expect(app.calls.map((call) => call.method).filter((method) => method === "attachment.save" || method === "message.send")).toEqual(["attachment.save", "message.send"]);
  });

  it("u419_the_body_ends_with_one_quoted_path_per_attachment", async () => {
    const { app } = await mountThread(tree, { prepare: (fake) => (fake.handlers["attachment.save"] = (params) => ({ path: `/d/it's/${params.name}` })) });

    paste(image("a.png"));
    paste(image("b.png"));
    threadInput().value = "look";
    fireEvent.input(threadInput());
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    expect(bodyOf(calls(app, "message.send")[0]!)).toBe("look\n'/d/it'\\''s/a.png'\n'/d/it'\\''s/b.png'");
  });

  it("u419_an_attachment_alone_can_be_sent", async () => {
    const { app } = await mountThread(tree, { prepare: (fake) => (fake.handlers["attachment.save"] = () => ({ path: "/d/a.png" })) });

    paste(image("a.png"));
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    expect(bodyOf(calls(app, "message.send")[0]!)).toBe("'/d/a.png'");
  });

  it("u419_a_native_drop_sends_its_own_path", async () => {
    const { app } = await mountThread(tree);

    rect(document.querySelector(".thread-composer")!);
    await waitFor(() => expect(app.dropFiles).toBeDefined());
    app.dropFiles({ phase: "drop", paths: ["/p/dir/Shot.PNG"], x: 20, y: 20 });
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    expect(calls(app, "attachment.save")).toEqual([]);
    expect(bodyOf(calls(app, "message.send")[0]!)).toBe("'/p/dir/Shot.PNG'");
  });

  it("u419_a_failed_save_sends_nothing_and_keeps_the_composer", async () => {
    const { app } = await mountThread(tree, {
      prepare: (fake) =>
        (fake.handlers["attachment.save"] = () => {
          throw new Error("disk full");
        }),
    });

    paste(image("a.png"));
    threadInput().value = "look";
    fireEvent.input(threadInput());
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(document.querySelector("[role=alert]")?.textContent).toContain("disk full"));
    expect(calls(app, "message.send")).toEqual([]);
    expect(threadInput().value).toBe("look");
    expect(chips()).toEqual(["a.png 3 B"]);
  });

  it("u419_a_removed_attachment_is_not_saved", async () => {
    const { app } = await mountThread(tree, { prepare: (fake) => (fake.handlers["attachment.save"] = () => ({ path: "/d/a.png" })) });

    paste(image("a.png"));
    fireEvent.click(document.querySelector("[aria-label='remove a.png']")!);
    threadInput().value = "hi";
    fireEvent.input(threadInput());
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    expect(calls(app, "attachment.save")).toEqual([]);
    expect(bodyOf(calls(app, "message.send")[0]!)).toBe("hi");
  });

  it("u419_the_feed_shows_the_chip_not_its_path_line", async () => {
    const { app } = await mountThread(tree, { prepare: (fake) => (fake.handlers["attachment.save"] = () => ({ path: "/d/a.png" })) });

    paste(image("a.png"));
    threadInput().value = "look";
    fireEvent.input(threadInput());
    fireEvent.keyDown(threadInput(), { key: "Enter" });

    await waitFor(() => expect(calls(app, "message.send")).toHaveLength(1));
    app.emit(sent(message(50, { from: USER, to: "workstream", body: "look\n'/d/a.png'\n'/other/x.png'" })));

    await waitFor(() => expect(document.querySelector("[data-message-body]")?.textContent).toContain("look"));
    const shown = document.querySelector("[data-message-body]")!.textContent!;

    expect(shown).not.toContain("'/d/a.png'");
    expect(shown).toContain("'/other/x.png'");
    expect(chips()).toContain("a.png 3 B");
  });
});
