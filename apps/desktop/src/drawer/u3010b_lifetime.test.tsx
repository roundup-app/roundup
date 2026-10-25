import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { mountApp } from "../testing/appFixture";
import { openRecovery } from "../testing/recovery";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { ItemDrawer } from "./ItemDrawer";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each(["dismiss", "discard", "acknowledged", "same-copy", "other-copy", "other-discard", "other-save", "failed", "retention"] as const)("p3557c_failure_lifetime_draft_recovery_%s", async action => {
  localStorage.clear();
  const { app, drafts } = await mountApp();
  const store = drafts("/p");
  const original = store.edit({ surface: "terminal_selection", object: "original", recipient: "a" }, { note: "  original é\n雪  ", excerpt: "exact excerpt", source: "gone" }, null, "ordinary").draft;
  const other = store.edit({ surface: "terminal_selection", object: "other", recipient: "b" }, { note: "  unrelated 🪁\n  ", source: "gone-too" }, null, "ordinary").draft;
  const retained = store.list();
  const clipboard = vi.fn().mockRejectedValue(new Error("clipboard refused"));
  vi.spyOn(app, "clipboardWrite").mockImplementation(clipboard);
  await openRecovery();
  const panel = await screen.findByLabelText("Unfinished work");
  const row = panel.querySelector<HTMLElement>(`[data-revision="${original.revision}"]`)!;
  fireEvent.click(within(row).getByRole("button", { name: "Copy" }));
  await screen.findByText(/clipboard refused/);

  if (action === "dismiss" || action === "retention") {
    if (action === "retention") {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
      store.retry();
      expect(screen.getAllByRole("alert")).toHaveLength(2);
    }

    fireEvent.click(screen.getByRole("button", { name: "Dismiss copy failure" }));
  } else if (action === "discard") {
    fireEvent.click(within(row).getByRole("button", { name: "Discard" }));
  } else if (action === "acknowledged" || action === "failed") {
    store.submit(original.revision);
    store.settle(original.revision, action);
  } else if (action === "other-discard") {
    store.discard(other.revision);
  } else if (action === "other-save") {
    store.submit(other.revision);
    store.settle(other.revision, "acknowledged");
  } else {
    clipboard.mockResolvedValue(undefined);
    const copied = action === "same-copy" ? original : other;
    fireEvent.click(within(panel.querySelector<HTMLElement>(`[data-revision="${copied.revision}"]`)!).getByRole("button", { name: "Copy" }));
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(2));
  }

  expect(Boolean(screen.queryByText(/clipboard refused/))).toBe(["other-copy", "other-discard", "other-save", "failed"].includes(action));
  expect(store.list().find(draft => draft.revision === other.revision)).toEqual(action === "other-discard" || action === "other-save" ? undefined : other);

  if (action === "discard" || action === "acknowledged") expect(store.list()).toEqual([other]);
  else if (action === "other-discard" || action === "other-save") expect(store.list()).toEqual([original]);
  else if (action !== "failed") expect(store.list()).toEqual(retained);
  else expect(store.list().find(draft => draft.revision === original.revision)).toEqual({ ...original, status: "failed" });

  if (action === "retention") expect(screen.getByRole("alert").textContent).toContain("reload");
  expect(clipboard.mock.calls[0]).toEqual(["  original é\n雪  \nexact excerpt"]);
});

it.each(["history", "read", "render"].flatMap(failure => ["retry", "switch"].map(action => ({ failure, action }))))("p3557c_failure_lifetime_item_drawer_$failure_$action", async ({ failure, action }) => {
  localStorage.clear();
  let fixed = false;
  const app = createFakeApp();
  app.handlers["provenance.history"] = () => {
    if (failure === "history") throw new Error("opening refused");

    return [];
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  const draft = connected.drafts.edit({ surface: "orders", object: "other", recipient: "b" }, { ask: "  unfinished é\n雪  " }, null, "ordinary").draft;
  const [item, setItem] = createSignal("original");
  render(() => <ConnectedProjectContext.Provider value={connected}>
    <ItemDrawer item={item()} read={async () => {
      if (item() === "original" && failure === "read" && !fixed) throw new Error("opening refused");

      return item();
    }}>
      {value => {
        if (value === "original" && failure === "render" && !fixed) throw new Error("opening refused");

        return <p>{value}</p>;
      }}
    </ItemDrawer>
  </ConnectedProjectContext.Provider>);
  await screen.findByText("opening refused");

  if (action === "retry") {
    fixed = true;
    app.handlers["provenance.history"] = () => [];
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("original");
    expect(screen.queryByRole("alert")).toBeNull();
  } else {
    app.handlers["provenance.history"] = () => [];
    setItem("next item");
    await screen.findByText("next item");
    expect(screen.queryByRole("alert")).toBeNull();
  }

  expect(connected.drafts.list()).toEqual([draft]);
});
