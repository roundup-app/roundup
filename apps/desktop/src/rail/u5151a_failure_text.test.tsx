import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseAction, mountRail, rowOf, settled } from "./railFixture";
import { agent, NOW, workstream } from "../testing/nodes";

afterEach(cleanup);

const LABEL = "Claude's servers failed; send the Agent a message to retry. The next turn replaces this mark.";

describe("U5151a", () => {
  it("u5151a_stop_failure_reaches_the_rail", async () => {
    const boom = agent("boom", "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });

    await mountRail([boom]);

    expect(rowOf("boom").textContent).toContain(boom.status!.label);
  });
});

describe("U5151c", () => {
  it("u5151c_dismissal_clears_only_the_chosen_failure", async () => {
    const failed = (id: string) => agent(id, "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
    const { app, rail } = await mountRail([failed("one"), failed("two")]);

    await chooseAction(app, "one", "Dismiss error");
    fireEvent.click(rowOf("one"));
    await settled();

    expect(rowOf("one").getAttribute("data-kind")).toBe("idle");
    expect(rowOf("one").textContent).toContain(`Dismissed: ${LABEL}`);
    expect(rowOf("one").closest("[role=treeitem]")?.getAttribute("aria-label") ?? rowOf("one").getAttribute("aria-label")).toContain(`Dismissed: ${LABEL}`);
    expect(rowOf("two").getAttribute("data-kind")).toBe("error");
    expect(rail.dismissed(rail.nodes.find((node) => node.id === "one")!)).toBe(true);
    expect(rail.dismissed(rail.nodes.find((node) => node.id === "two")!)).toBe(false);
    expect(app.calls.map((call) => call.method).filter((method) => /^(agent|terminal)\.(send|write|stop|restart)|^message\.(?!list$)|^workstream\./.test(method))).toEqual([]);
  });

  it("u5151c_dismissal_clears_a_collapsed_workstream_summary", async () => {
    const failed = agent("nested", "error", "x", { parent: "g", status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
    const { app } = await mountRail([workstream("g"), failed]);

    await chooseAction(app, "nested", "Dismiss error");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));

    expect(rowOf("g").getAttribute("data-kind")).not.toBe("error");
  });
});

describe("U5151e", () => {
  beforeEach(() => { localStorage.clear(); });

  const failed = (id: string) => agent(id, "error", "x", { status: { kind: "error", label: LABEL, since: NOW, finished: "0" } });
  const turns = (app: { calls: { method: string }[] }) => app.calls.map((call) => call.method).filter((method) => /^(agent|terminal)\.(send|write|stop|restart)|^message\.(?!list$)/.test(method));

  it("u5151e_unsaved_dismissal_is_explained", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const { app } = await mountRail([failed("one")]);

    await chooseAction(app, "one", "Dismiss error");
    await settled();

    expect(rowOf("one").getAttribute("data-kind")).toBe("idle");
    expect(screen.getByText(/dismissal for one did not save/)).toBeTruthy();
    expect(turns(app)).toEqual([]);
    writes.mockRestore();
  });

  it("u5151e_retry_saves_the_dismissal", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const { app } = await mountRail([failed("one")]);

    await chooseAction(app, "one", "Dismiss error");
    await settled();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settled();
    expect(screen.getByText(/dismissal for one did not save/)).toBeTruthy();

    writes.mockRestore();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await settled();

    expect(screen.queryByText(/did not save/)).toBeNull();
    expect(Object.entries(localStorage).some(([key, value]) => key.startsWith("roundup:dismissed:") && value.includes("one:"))).toBe(true);
    expect(turns(app)).toEqual([]);
  });
  it("u5151g_later_saved_dismissal_clears_the_earlier_line", async () => {
    const real = Storage.prototype.setItem;
    let refuse = true;
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) { if (refuse) throw new Error("full"); real.call(this, key, value); });
    const { app } = await mountRail([failed("one"), failed("two")]);

    await chooseAction(app, "one", "Dismiss error");
    await settled();
    expect(screen.getByText(/dismissal for one did not save/)).toBeTruthy();

    refuse = false;
    await chooseAction(app, "two", "Dismiss error");
    await settled();

    expect(screen.queryByText(/did not save/)).toBeNull();
    const stored = Object.entries(localStorage).find(([key]) => key.startsWith("roundup:dismissed:"))?.[1] ?? "";
    expect(stored).toContain("one:");
    expect(stored).toContain("two:");
    expect(turns(app)).toEqual([]);
    writes.mockRestore();
  });

  it("u5151g_each_unsaved_dismissal_keeps_its_line", async () => {
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const { app } = await mountRail([failed("one"), failed("two")]);

    await chooseAction(app, "one", "Dismiss error");
    await settled();
    await chooseAction(app, "two", "Dismiss error");
    await settled();
    expect(screen.getByText(/dismissal for one did not save/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await settled();
    expect(screen.getByText(/dismissal for two did not save/)).toBeTruthy();
    writes.mockRestore();
  });
});
