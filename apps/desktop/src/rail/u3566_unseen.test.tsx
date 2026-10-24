import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { agent, door, event, workstream } from "../testing/nodes";
import { openTabs, path, tab } from "../header/stripFixture";
import type { FakeApp } from "../testing/fakeApp";

let focused = true;

beforeEach(() => {
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const row = (id: string) => document.querySelector<HTMLElement>(`[role=treeitem][data-id="${id}"]`)!;

const unread = (element: HTMLElement) => within(element).queryByRole("img", { name: "Unread result" }) !== null;

const finish = (app: FakeApp, project: string, id: string, revision: number, kind: "idle" | "done" | "working" | "needs-you", finished: string) =>
  app.of(path(project)).emit(event({ name: "agent.status", data: { id, attempt: "1", status_revision: String(revision), status: { kind, label: kind, since: revision, finished } } }));

const blur = () => {
  focused = false;
  window.dispatchEvent(new Event("blur"));
};

const refocus = () => {
  focused = true;
  window.dispatchEvent(new Event("focus"));
};

describe("u3566 a finish waits to be read", () => {
  it("u3566a_unselected_finish_is_unseen_until_selected", async () => {
    const { app } = await openTabs({ api: [agent("a", "idle", "x"), agent("b", "working", "x")] });

    fireEvent.click(row("a"));
    finish(app, "api", "b", 2, "idle", "1");

    await waitFor(() => expect(unread(row("b"))).toBe(true));
    expect(unread(row("a"))).toBe(false);

    fireEvent.click(row("b"));

    await waitFor(() => expect(unread(row("b"))).toBe(false));
  });

  it("u3566a_only_unviewed_finishes_wait", async () => {
    const { app } = await openTabs({ api: [agent("a", "working", "x"), agent("b", "working", "x")] });

    fireEvent.click(row("a"));
    finish(app, "api", "a", 2, "idle", "1");
    await waitFor(() => expect(row("a").textContent).toContain("a"));
    expect(unread(row("a"))).toBe(false);

    blur();
    finish(app, "api", "a", 3, "working", "1");
    finish(app, "api", "a", 4, "done", "2");
    await waitFor(() => expect(unread(row("a"))).toBe(true));

    finish(app, "api", "a", 5, "working", "2");
    expect(unread(row("a"))).toBe(true);

    refocus();
    await waitFor(() => expect(unread(row("a"))).toBe(false));

    finish(app, "api", "b", 2, "needs-you", "0");
    finish(app, "api", "b", 3, "needs-you", "0");
    await waitFor(() => expect(row("b").getAttribute("data-kind")).toBe("needs-you"));
    expect(unread(row("b"))).toBe(false);
  });

  it("u3566a_navigation_without_opening_keeps_unseen", async () => {
    const { app } = await openTabs({ api: [workstream("w"), agent("a", "idle", "x", { parent: "w" }), agent("b", "working", "x", { parent: "w" })], web: [agent("c", "idle", "x")] });

    fireEvent.click(tab("api"));
    await waitFor(() => expect(row("a")).not.toBeNull());
    fireEvent.click(row("a"));
    finish(app, "api", "b", 2, "idle", "1");
    await waitFor(() => expect(unread(row("b"))).toBe(true));

    fireEvent.click(tab("web"));
    fireEvent.click(tab("api"));
    fireEvent.mouseOver(row("b"));

    await waitFor(() => expect(row("a").getAttribute("aria-selected")).toBe("true"));
    expect(unread(row("b"))).toBe(true);
  });
});

describe("u3566b summaries retain every unread child", () => {
  it("u3566b_summaries_follow_their_unseen_agents", async () => {
    const { app } = await openTabs({
      api: [
        workstream("w1"), agent("a", "idle", "x", { parent: "w1" }), agent("b", "working", "x", { parent: "w1" }),
        door("w2", "working", "x"), agent("c", "idle", "x", { parent: "w2" }),
      ],
      web: [agent("a", "working", "x")],
    });

    fireEvent.click(tab("api"));
    await waitFor(() => expect(row("c")).not.toBeNull());
    fireEvent.click(row("c"));
    finish(app, "api", "b", 2, "idle", "1");
    finish(app, "web", "a", 2, "idle", "1");
    await waitFor(() => expect(unread(tab("web"))).toBe(true));
    expect(unread(row("b"))).toBe(true);
    expect(unread(tab("api"))).toBe(true);

    fireEvent.click(within(row("w1")).getByRole("button", { name: "Collapse" }));
    await waitFor(() => expect(unread(row("w1"))).toBe(true));
    expect(unread(row("w2"))).toBe(false);

    finish(app, "api", "w2", 2, "idle", "1");
    await waitFor(() => expect(unread(row("w2"))).toBe(true));
  });

  it("u3566b_unseen_is_separate_from_attention", async () => {
    const { app } = await openTabs({ api: [agent("a", "idle", "x"), agent("b", "working", "x"), agent("n", "needs-you", "x")] });

    fireEvent.click(row("a"));
    finish(app, "api", "b", 2, "idle", "1");
    await waitFor(() => expect(unread(tab("api"))).toBe(true));

    expect(app.badges.at(-1)).toBe(1);
    expect(within(tab("api")).getByRole("img", { name: "Needs you" })).toBeTruthy();
    expect(screen.queryAllByRole("img", { name: "Unread result" }).length).toBeGreaterThan(0);
  });
});

describe("u3566c reload keeps seen state and finds missed finishes", () => {
  it("u3566c_reload_reconciles_finishes_with_seen_state", async () => {
    const first = await openTabs({ api: [agent("a", "idle", "x"), agent("b", "working", "x"), agent("c", "working", "x")] });

    fireEvent.click(row("a"));
    finish(first.app, "api", "b", 2, "idle", "1");
    finish(first.app, "api", "c", 2, "idle", "1");
    await waitFor(() => expect(unread(row("c"))).toBe(true));
    fireEvent.click(row("c"));
    await waitFor(() => expect(unread(row("c"))).toBe(false));
    fireEvent.click(row("a"));
    await waitFor(() => expect(row("a").getAttribute("aria-selected")).toBe("true"));
    cleanup();

    // While the webview was away: b finished once more and went back to work, c finished again, a finished anew.
    await openTabs({ api: [agent("a", "idle", "x", { status: { kind: "idle", label: "idle", since: 5, finished: "1" } }), agent("b", "working", "x", { status: { kind: "working", label: "w", since: 5, finished: "2" } }), agent("c", "idle", "x", { status: { kind: "idle", label: "idle", since: 5, finished: "2" } })] }, true);

    await waitFor(() => expect(unread(row("b"))).toBe(true));
    expect(unread(row("c"))).toBe(true);
    expect(unread(row("a"))).toBe(false);
  });

  it("u3566c_no_record_baselines_history", async () => {
    await openTabs({ api: [agent("a", "idle", "x", { status: { kind: "idle", label: "idle", since: 5, finished: "4" } })] });

    expect(unread(row("a"))).toBe(false);
  });
});
