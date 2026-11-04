import { cleanup, fireEvent, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, door, event } from "../testing/nodes";
import { openTabs, path } from "../header/stripFixture";
import type { FakeApp } from "../testing/fakeApp";

beforeEach(() => {
  vi.spyOn(document, "hasFocus").mockImplementation(() => true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (id: string) => document.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"]`)!;

const unread = (element: HTMLElement) => within(element).queryByRole("img", { name: "Unread result" }) !== null;

const status = (app: FakeApp, id: string, revision: number, kind: "idle" | "needs-you" | "error", finished: string) =>
  app.of(path("api")).emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(revision), status: { kind, label: kind, since: revision, finished } } }));

const fixture = () => openTabs({ api: [door("w", "working", "x"), agent("child", "working", "x", { parent: "w" }), agent("top", "working", "x"), agent("other", "working", "x")] });

describe("u6119 a Workstream's child shows no dot", () => {
  it("u6119b_a_child_finish_is_not_unseen_and_its_need_reaches_the_door", async () => {
    const { app } = await fixture();

    fireEvent.click(row("other"));
    status(app, "child", 2, "idle", "1");
    status(app, "top", 2, "idle", "1");
    await waitFor(() => expect(unread(row("top"))).toBe(true));
    expect(unread(row("child"))).toBe(false);
    expect(unread(row("w"))).toBe(false);

    fireEvent.click(within(row("w")).getByRole("button", { name: "Collapse" }));
    expect(unread(row("w"))).toBe(false);

    status(app, "w", 2, "idle", "1");
    await waitFor(() => expect(unread(row("w"))).toBe(true));

    status(app, "child", 3, "needs-you", "1");
    await waitFor(() => expect(row("w").querySelector("[data-kind]")?.getAttribute("data-kind")).toBe("needs-you"));
  });

  it("u6119d_no_attention_marker_is_hidden", async () => {
    const { app } = await fixture();

    fireEvent.click(within(row("w")).getByRole("button", { name: "Collapse" }));
    status(app, "child", 2, "needs-you", "0");
    await waitFor(() => expect(row("w").querySelector("[data-kind]")?.getAttribute("data-kind")).toBe("needs-you"));
    expect(app.badges.at(-1)).toBeGreaterThan(0);

    status(app, "child", 3, "error", "0");
    await waitFor(() => expect(row("w").querySelector("[data-kind]")?.getAttribute("data-kind")).toBe("error"));
    expect(app.badges.at(-1)).toBeGreaterThan(0);

    fireEvent.click(row("other"));
    status(app, "w", 2, "idle", "1");
    await waitFor(() => expect(unread(row("w"))).toBe(true));
  });
});
