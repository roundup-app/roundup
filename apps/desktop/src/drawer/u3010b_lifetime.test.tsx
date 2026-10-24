import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, expect, it, vi } from "vitest";
import { createDrawer } from "./drawer";
import { DrawerHost } from "./DrawerHost";
import { drawerSliding } from "./sliding";
import { mountApp } from "../decisions/decisionsFixture";
import { openRecovery } from "../testing/recovery";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { ItemDrawer } from "./ItemDrawer";

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, "clipboard");

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();

  if (clipboardBefore) Object.defineProperty(navigator, "clipboard", clipboardBefore);
  else Reflect.deleteProperty(navigator, "clipboard");
});

const setup = () => {
  vi.useFakeTimers();
  const drawer = createDrawer();
  const [reduced, setReduced] = createSignal(false);
  render(() => <DrawerHost drawer={drawer} reducedMotion={reduced} />);

  return { drawer, setReduced, panel: screen.getByLabelText("Drawer") };
};

it("u3010b_latest_action_owns_layer_lifetime", () => {
  const { drawer, panel } = setup();

  drawer.open(() => <p>first</p>);
  drawer.close();
  expect(screen.queryByText("first")).not.toBeNull();
  expect(drawerSliding()).toBe(true);

  // Reopen before the exit finishes: neither the old timer nor the old completion may touch the new incarnation.
  drawer.open(() => <p>second</p>);
  vi.advanceTimersByTime(599);
  fireEvent.transitionEnd(panel);
  vi.advanceTimersByTime(600);
  expect(screen.queryByText("second")).not.toBeNull();
  expect(drawerSliding()).toBe(false);

  // A key close settles at once, with no completion to wait for.
  drawer.close("key");
  expect(screen.queryByText("second")).toBeNull();
  expect(drawerSliding()).toBe(false);
});

it("u3010b_stale_completion_has_no_new_layer_effect", () => {
  const { drawer, panel } = setup();

  drawer.open(() => <p>detail</p>);
  drawer.close();
  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);

  // The first slide's timer is gone; only the reopen's own completion ends the slide.
  vi.advanceTimersByTime(599);
  expect(drawerSliding()).toBe(true);
  fireEvent.transitionEnd(panel);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("detail")).not.toBeNull();
});

it("u3010b_dispose_mid_slide_clears_sliding", () => {
  const { drawer } = setup();

  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);
  cleanup();
  expect(drawerSliding()).toBe(false);
});

it("u3010b_exit_preserves_draft_and_submit_identity", () => {
  const { drawer, panel } = setup();
  const submit = vi.fn();

  drawer.open(() => (
    <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <textarea aria-label="draft" />
      <button type="submit">Send</button>
    </form>
  ));
  // SAFETY: the element rendered above is a `<textarea>`.
  const draft = screen.getByLabelText("draft") as HTMLTextAreaElement;

  draft.value = "line one\nline two";
  drawer.close();

  // The retained exit is the same element with the exact text, and takes no new activation.
  expect(screen.getByLabelText("draft")).toBe(draft);
  expect(draft.value).toBe("line one\nline two");
  expect(panel.dataset["open"]).toBe("false");

  fireEvent.transitionEnd(panel);
  expect(screen.queryByLabelText("draft")).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

it("u3010b_preference_change_preserves_destination_and_focus", () => {
  const { drawer, setReduced, panel } = setup();

  drawer.open(() => <p>detail</p>);
  expect(drawerSliding()).toBe(true);
  expect(panel.contains(document.activeElement)).toBe(true);

  // Opening: reduced motion settles the latest destination, content and focus stay.
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("detail")).not.toBeNull();
  expect(panel.contains(document.activeElement)).toBe(true);

  // Turning it off replays nothing.
  setReduced(false);
  expect(drawerSliding()).toBe(false);

  // Closing and reversal: the latest destination wins and the exit content is gone at once.
  drawer.close();
  expect(drawerSliding()).toBe(true);
  drawer.open(() => <p>again</p>);
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("again")).not.toBeNull();

  setReduced(false);
  drawer.close();
  expect(screen.queryByText("again")).not.toBeNull();
  setReduced(true);
  expect(drawerSliding()).toBe(false);
  expect(screen.queryByText("again")).toBeNull();
});

it.each(["dismiss", "discard", "acknowledged", "same-copy", "other-copy", "other-discard", "other-save", "failed", "retention"] as const)("p3557c_failure_lifetime_draft_recovery_%s", async action => {
  localStorage.clear();
  const { drafts } = await mountApp();
  const store = drafts("/p");
  const original = store.edit({ surface: "terminal_selection", object: "original", recipient: "a" }, { note: "  original é\n雪  ", excerpt: "exact excerpt", source: "gone" }, null, "ordinary").draft;
  const other = store.edit({ surface: "terminal_selection", object: "other", recipient: "b" }, { note: "  unrelated 🪁\n  ", source: "gone-too" }, null, "ordinary").draft;
  const retained = store.list();
  const clipboard = vi.fn().mockRejectedValue(new Error("clipboard refused"));
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
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

    fireEvent.click(screen.getByRole("button", { name: "Dismiss failure" }));
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

it.each(["history", "read", "render"].flatMap(failure => ["dismiss", "switch"].map(action => ({ failure, action }))))("p3557c_failure_lifetime_item_drawer_$failure_$action", async ({ failure, action }) => {
  localStorage.clear();
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
      if (item() === "original" && failure === "read") throw new Error("opening refused");

      return item();
    }}>
      {value => {
        if (value === "original" && failure === "render") throw new Error("opening refused");

        return <p>{value}</p>;
      }}
    </ItemDrawer>
  </ConnectedProjectContext.Provider>);
  await screen.findByText("opening refused");

  if (action === "dismiss") {
    fireEvent.click(screen.getByRole("button", { name: "Dismiss failure" }));
    expect(screen.queryByRole("alert")).toBeNull();
  }

  app.handlers["provenance.history"] = () => [];
  setItem("next item");
  await screen.findByText("next item");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(connected.drafts.list()).toEqual([draft]);
});
