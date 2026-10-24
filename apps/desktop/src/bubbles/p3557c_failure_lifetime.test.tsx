import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../testing/nodes";
import { confirmDeletion, answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { mountBubbles, TERMINALS } from "./bubblesFixture";

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, "clipboard");

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (clipboardBefore) Object.defineProperty(navigator, "clipboard", clipboardBefore);
  else Reflect.deleteProperty(navigator, "clipboard");
});

const tab = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${id}"]`)!;

const close = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab-pair[data-bubble="${id}"] > button:last-child`)!;

const closeAccepted = async (id: string) => { fireEvent.click(close(id)); await confirmDeletion(); };

const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input")!;

const edit = async (id: string) => {
  tab(id).focus();
  fireEvent.dblClick(tab(id).querySelector(".terminal-tab-name")!);
  await waitFor(() => expect(field()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

const transitions = ["delete", "other-delete", "open", "dismiss", "save", "other-save", "cancel-edit", "failed-delete", "cancel-delete", "replace", "successful-delete", "navigate"];

it.each(["close", "rename", "context"].flatMap(source => transitions.map(transition => ({ source, transition }))))(
  "p3557c_failure_lifetime_bubbles: $source $transition", async ({ source, transition }) => {
    const mounted = await mountBubbles();
    const { app, connected, setListed } = mounted;
    fireEvent.click(document.querySelector(".bubble:not([hidden]) [aria-label=Minimise]")!);
    const text = "  unfinished e\u0301 🫧 雪  ";
    const retained = connected.drafts.edit({ surface: "bubbles", object: TERMINALS[2]!.incarnation, recipient: "3" }, { name: text, base: "other run" }, null, "ordinary").draft;
    const remove = app.handlers["terminal.close"]!;

    if (source === "close") {
      app.handlers["terminal.close"] = () => { throw new Error("Close refused\nTry again"); };

      await closeAccepted("2");
      await screen.findByRole("alert", { name: "Close refused\nTry again" });
      app.handlers["terminal.close"] = remove;
    } else if (source === "rename") {
      const write = Storage.prototype.setItem;

      const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
        if (key === "roundup:bubble-places:/p") throw new Error("Close refused\nTry again");

        return write.call(this, key, value);
      });

      await edit("2");
      fireEvent.input(field(), { target: { value: "  rejected name 雪  " } });
      fireEvent.keyDown(field(), { key: "Enter" });
      const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
      storage.mockRestore();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(tab("2")));
    } else {
      app.handlers["daemon.ping"] = () => { throw new Error("Close refused\nTry again"); };

      fireEvent.contextMenu(tab("2"), { clientX: 10, clientY: 10 });
      await app.pickMenu("Copy Link");
      await screen.findByRole("alert", { name: "Close refused\nTry again" });
    }

    const before = connected.drafts.list();

    if (transition === "delete") {
      setListed(TERMINALS.filter(terminal => terminal.id !== "2"));
      app.emit(event({ name: "terminal.changed" }));
      await waitFor(() => expect(tab("2")).toBeNull());
    } else if (transition === "navigate") {
      connected.rail.select("b");
      connected.rail.select("a");
    } else if (transition === "replace") {
      setListed(TERMINALS.map(terminal => terminal.id === "2" ? { ...terminal, incarnation: "replacement" } : terminal));
      app.emit(event({ name: "terminal.changed" }));
      await waitFor(() => expect(connected.rail.terminals().find(terminal => terminal.id === "2")!.incarnation).toBe("replacement"));
    } else if (transition === "successful-delete") {
      await closeAccepted("2");
      await waitFor(() => expect(tab("2")).toBeNull());
      await connected.rail.refresh({ terminals: true });
    } else if (transition === "cancel-delete") {
      fireEvent.contextMenu(tab("2"), { clientX: 10, clientY: 10 });
      await app.closeMenu();
    } else if (transition === "other-delete") {
      await closeAccepted("1");
      await waitFor(() => expect(tab("1")).toBeNull());
      await connected.rail.refresh({ terminals: true });
    } else if (transition === "open") {
      fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
      await waitFor(() => expect(tab("9")).not.toBeNull());
      await connected.rail.refresh({ terminals: true });
    } else if (transition === "dismiss") {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    } else if (transition === "save" || transition === "other-save" || transition === "cancel-edit") {
      await edit(transition === "other-save" ? "1" : "2");

      if (transition !== "cancel-edit") fireEvent.input(field(), { target: { value: "saved name" } });
      fireEvent.keyDown(field(), { key: transition === "cancel-edit" ? "Escape" : "Enter" });
      await waitFor(() => expect(field()).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(tab(transition === "other-save" ? "1" : "2")));
    } else {
      app.handlers["terminal.close"] = () => { throw new Error("Still refused"); };

      await closeAccepted("2");
      await screen.findByRole("alert", { name: "Still refused" });
    }

    if (["delete", "dismiss", "save", "replace", "successful-delete"].includes(transition)) {
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    } else expect(screen.getByRole("alert", { name: transition === "failed-delete" ? "Still refused" : "Close refused\nTry again" })).toBeDefined();
    expect(connected.drafts.list()).toContainEqual(retained);

    if (!["save", "other-save"].includes(transition)) expect(connected.drafts.list()).toEqual(before);
    expect(retained.value.name).toBe(text);
    expect(retained.destination).toMatchObject({ object: TERMINALS[2]!.incarnation, recipient: "3", surface: "bubbles" });
  });

it.each(["delete", "save", "dismiss", "recover"])("p3557c_failure_lifetime_bubbles_open: %s", async transition => {
  const { app, connected, setListed } = await mountBubbles();
  const open = app.handlers["terminal.open"]!;
  const retained = connected.drafts.edit({ surface: "bubbles", object: TERMINALS[2]!.incarnation, recipient: "3" }, { name: "  unsent 雪  ", base: "other run" }, null, "ordinary").draft;
  app.handlers["terminal.open"] = () => { throw new Error("Cannot open Terminal"); };

  fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
  await screen.findByRole("alert", { name: "Cannot open Terminal" });

  if (transition === "delete") {
    setListed(TERMINALS.filter(terminal => terminal.id !== "2"));
    app.emit(event({ name: "terminal.changed" }));
    await waitFor(() => expect(tab("2")).toBeNull());
  } else if (transition === "save") {
    await edit("2");
    fireEvent.input(field(), { target: { value: "renamed" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    await waitFor(() => expect(field()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  } else if (transition === "recover") {
    app.handlers["terminal.open"] = open;
    fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
    await waitFor(() => expect(tab("9")).not.toBeNull());
  } else fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

  if (["dismiss", "recover"].includes(transition)) await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  else expect(screen.getByRole("alert", { name: "Cannot open Terminal" })).toBeDefined();
  expect(connected.drafts.list()).toEqual([retained]);
});

it.each(["dismiss", "discard", "copy", "other-copy", "other-discard", "retention"])("p3557c_failure_lifetime_bubbles_recovery: %s", async transition => {
  const { connected } = await mountBubbles();
  const drafts = connected.drafts;
  const destination = { surface: "bubbles", object: TERMINALS[1]!.incarnation, recipient: "2" };
  const first = drafts.edit(destination, { name: "  copied e\u0301 雪  ", base: "zsh" }, null, "ordinary").draft;
  const other = drafts.edit({ ...destination, object: TERMINALS[2]!.incarnation, recipient: "3" }, { name: "other unfinished", base: "other run" }, null, "ordinary").draft;
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Clipboard refused")) } });
  fireEvent.click(screen.getByRole("button", { name: "Recover unfinished work · Terminal name" }));
  const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
  const inspect = (name: string) => fireEvent.click(within(dialog).getByRole("button", { name: new RegExp(`Inspect.*${name}`) }));
  inspect("zsh");
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  await within(dialog).findByRole("alert", { name: /Clipboard refused/ });
  const before = drafts.list();

  if (transition === "dismiss") fireEvent.click(within(dialog).getByRole("button", { name: "Dismiss" }));
  else if (transition === "discard") fireEvent.click(within(dialog).getByRole("button", { name: "Discard this revision" }));
  else if (transition === "copy") {
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
  } else if (transition === "other-copy") {
    inspect("other run");
    vi.mocked(navigator.clipboard.writeText).mockResolvedValue(undefined);
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy name" }));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith("other unfinished"));
  } else if (transition === "other-discard") {
    inspect("other run");
    fireEvent.click(within(dialog).getByRole("button", { name: "Discard this revision" }));
  } else {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Disk full"); });
    drafts.edit(destination, { name: "still in memory", base: "zsh" }, null, "ordinary");
    expect(within(dialog).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(within(dialog).getByRole("alert")).toBeDefined();
    expect(drafts.problem()).not.toBeNull();
    expect(within(dialog).getByRole("button", { name: "Retry storage only" })).toBeDefined();
    expect(drafts.list().some(draft => draft.value.name === "still in memory")).toBe(true);
  }

  if (["dismiss", "discard", "copy"].includes(transition)) await waitFor(() => expect(within(dialog).queryByRole("alert")).toBeNull());
  else if (["other-discard", "other-copy"].includes(transition)) expect(within(dialog).getByRole("alert", { name: /Clipboard refused/ })).toBeDefined();
  expect(drafts.list()).toContainEqual(transition === "other-discard" ? first : other);

  if (["dismiss", "copy", "other-copy"].includes(transition)) expect(drafts.list()).toEqual(before);
});

it("p3557c_failure_lifetime_bubbles_close: Retry then Keep leaves the failure with its Retry", async () => {
  const { app } = await mountBubbles();
  app.handlers["terminal.close"] = () => { throw new Error("Close refused"); };

  await closeAccepted("2");
  await screen.findByRole("alert", { name: "Close refused" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await questionDialog();
  await answerQuestion(false);
  await waitFor(() => expect(document.activeElement).toBe(close("2")));
  expect(screen.getByRole("alert", { name: "Close refused" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
});
