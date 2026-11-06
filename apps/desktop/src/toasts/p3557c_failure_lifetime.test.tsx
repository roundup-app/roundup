import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { connectProject } from "../state/connectedProject";
import { watchProject } from "./watch";
import { agent, USER } from "../testing/nodes";
import { TOAST_AGENT as AGENT, by, mountToasts, status, toastTodo as todo } from "./toastFixture";

const tree = () => [agent("a", "working", "x", { name: "scout" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(400);
};

const alert = () => screen.queryByRole("alert");

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("p3557c_failure_lifetime_todo", () => {
  const fail = async () => {
    // The Daemon refuses the read, so opening it fails.
    const mounted = await mountToasts(tree(), { unreadable: true });

    mounted.app.emit(by(AGENT, { name: "todo.updated", data: todo(1, USER) }));
    await settle();
    fireEvent.click(await screen.findByRole("button", { name: /Changed Todo/ }));
    await settle();
    expect(alert()).not.toBeNull();

    return mounted;
  };

  it("u3791c_replacement_keeps_failure_ownership", async () => {
    const mounted = await fail();
    const draft = mounted.connected.drafts.edit({ surface: "ask", object: "ask-bar", recipient: "a" }, { text: " retained 🌿 " }, null, "ordinary").draft;
    mounted.app.emit(by(AGENT, { name: "todo.updated", data: todo(2, USER) }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Changed Todo/ }));
    await settle();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    mounted.app.emit(by(USER, { name: "todo.updated", data: todo(1, USER) }));
    mounted.app.emit(by(USER, { name: "todo.deleted", data: { id: 1 } }));
    await settle();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(mounted.connected.drafts.list()).toContainEqual(draft);
    mounted.app.emit(by(USER, { name: "todo.deleted", data: { id: 2 } }));
    await settle();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mounted.connected.drafts.list()).toContainEqual(draft);
  });

  it("deleting the item clears its failure; another item's deletion does not", async () => {
    const { app } = await fail();

    app.emit(by(USER, { name: "todo.deleted", data: { id: 2 } }));
    await settle();
    expect(alert()).not.toBeNull();
    app.emit(by(USER, { name: "todo.deleted", data: { id: 1 } }));
    await settle();
    expect(alert()).toBeNull();
  });

  it("a save of the same item clears it; a save of another does not", async () => {
    const { app } = await fail();

    app.emit(by(USER, { name: "todo.updated", data: todo(2, USER) }));
    await settle();
    expect(alert()).not.toBeNull();
    app.emit(by(USER, { name: "todo.updated", data: todo(1, USER) }));
    await settle();
    expect(alert()).toBeNull();
  });

  it("an unrelated activation keeps another item's failure", async () => {
    const { app } = await fail();

    app.handlers["rail.tree"] = () => tree();
    app.emit(status("a", "needs-you"));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /scout/ }));
    await settle();
    expect(alert()).not.toBeNull();
  });
});


it("u3791c_same_scope_failure_replaces_only_in_original_project", async () => {
  const first = await mountToasts(tree(), { unreadable: true });
  const app = createFakeApp();
  app.handlers["rail.tree"] = tree;
  app.handlers["todo.list"] = () => { throw new Error("Daemon unavailable"); };

  const second = await connectProject(app, { path: "/other", name: "other" }, () => true, () => 0);
  const stop = watchProject(second, first.queue.push, () => {}, () => true, first.queue.settle);

  try {
    first.app.emit(by(AGENT, { name: "todo.updated", data: todo(1, USER, "first") }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Changed Todo.*first/ }));
    await settle();
    app.emit(by(AGENT, { name: "todo.updated", data: todo(1, USER, "second") }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Changed Todo.*second/ }));
    await settle();
    expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(2);
    first.app.emit(by(USER, { name: "todo.deleted", data: { id: 1 } }));
    await settle();
    expect(screen.getAllByRole("alert", { hidden: true })).toHaveLength(1);
    app.emit(by(USER, { name: "todo.deleted", data: { id: 1 } }));
    await settle();
    expect(screen.queryByRole("alert", { hidden: true })).toBeNull();
  } finally { stop(); second.stopTerminalScheme(); }
});
