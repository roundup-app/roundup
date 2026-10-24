import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@contracts/Actor";
import { agent, event, USER } from "../testing/nodes";
import { AGENT, by, mountToasts, pad, status, todo } from "./toastFixture";

const tree = () => [agent("a", "working", "x", { name: "scout" })];

const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(400);
};

const alert = () => screen.queryByRole("alert")?.textContent ?? null;

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Owner = { name: string; changed: (id: string) => Parameters<typeof by>[1]; deleted: (id: string) => Parameters<typeof event>[0]; saved: (id: string, actor: Actor) => Parameters<typeof by>[1]; label: RegExp };

const owners: Owner[] = [
  { name: "todo", label: /Changed Todo/, changed: (id) => ({ name: "todo.updated", data: todo(Number(id), USER, `t${id}`) }), deleted: (id) => ({ name: "todo.deleted", data: { id: Number(id) } }), saved: (id) => ({ name: "todo.updated", data: todo(Number(id), USER, `t${id}`) }) },
  { name: "pad", label: /Changed Pad/, changed: (id) => ({ name: "pad.changed", data: { name: `p${id}` } }), deleted: (id) => ({ name: "pad.deleted", data: { name: `p${id}` } }), saved: (id) => ({ name: "pad.changed", data: { name: `p${id}` } }) },
];

describe.each(owners)("p3557c_failure_lifetime_$name", (owner) => {
  const fail = async () => {
    // No item exists, so opening it fails with "gone".
    const mounted = await mountToasts(tree(), { todos: [], pads: [] });

    mounted.app.handlers["pad.list"] = () => [pad("p1", USER)];
    mounted.app.emit(by(AGENT, owner.changed("1")));
    await settle();
    mounted.app.handlers["pad.list"] = () => [];
    fireEvent.click(await screen.findByRole("button", { name: owner.label }));
    await settle();
    expect(alert()).toContain("gone");

    return mounted;
  };

  it("deleting the item clears its failure; another item's deletion does not", async () => {
    const { app } = await fail();

    app.emit(by(USER, owner.deleted("2")));
    await settle();
    expect(alert()).toContain("gone");
    app.emit(by(USER, owner.deleted("1")));
    await settle();
    expect(alert()).toBeNull();
  });

  it("a save of the same item clears it; a save of another does not", async () => {
    const { app } = await fail();

    app.emit(by(USER, owner.saved("2", USER)));
    await settle();
    expect(alert()).toContain("gone");
    app.emit(by(USER, owner.saved("1", USER)));
    await settle();
    expect(alert()).toBeNull();
  });

  it("Close dismisses it and no timer does", async () => {
    await fail();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(alert()).toContain("gone");
    fireEvent.click(within(screen.getByRole("alert").closest<HTMLElement>(".app-toast")!).getByRole("button", { name: "Close" }));
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
    expect(alert()).toContain("gone");
  });
});
