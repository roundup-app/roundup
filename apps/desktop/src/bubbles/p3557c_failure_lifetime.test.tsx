import { flush } from "solid-js";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../testing/nodes";
import { answerQuestion, questionClosed, questionDialog } from "../shelf/bulkQuestionHarness";
import { mountBubbles, TERMINALS } from "./bubblesFixture";
import { notices } from "../testing/notices";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tab = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${id}"]`)!;

const close = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab-pair[data-bubble="${id}"] > button:last-of-type`)!;

const closeAccepted = async (id: string) => {
  fireEvent.click(close(id));
  flush();
  await questionDialog();
  await answerQuestion(true);
  await questionClosed();
};

const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input")!;

const edit = async (id: string) => {
  tab(id).focus();
  fireEvent.dblClick(tab(id).querySelector(".terminal-tab-name")!);
  flush();
  await waitFor(() => expect(field()).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

const transitions = ["delete", "other-delete", "open", "dismiss", "save", "other-save", "cancel-edit", "failed-delete", "cancel-delete", "replace", "successful-delete", "navigate"];

it.each(["close", "rename", "context"].flatMap(source => transitions.map(transition => ({ source, transition }))))(
  "p3557c_failure_lifetime_bubbles: $source $transition", async ({ source, transition }) => {
    const mounted = await mountBubbles();
    const { app, connected, setListed } = mounted;
    fireEvent.click(document.querySelector(".bubble:not([hidden]) [aria-label=Minimise]")!);
    flush();
    const remove = app.handlers["terminal.close"]!;
    const refusal = "Close refused\nTry again";

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
      flush();
      fireEvent.keyDown(field(), { key: "Enter" });
      flush();
      const dialog = await screen.findByRole("dialog", { name: "Unfinished work" });
      storage.mockRestore();
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      flush();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(tab("2")));
    } else {
      app.handlers["daemon.ping"] = () => { throw new Error("Close refused\nTry again"); };

      fireEvent.contextMenu(tab("2"), { clientX: 10, clientY: 10 });
      flush();
      await app.pickMenu("Copy link");
      await screen.findByRole("alert", { name: refusal });
    }

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
      flush();
      await app.closeMenu();
    } else if (transition === "other-delete") {
      await closeAccepted("1");
      await waitFor(() => expect(tab("1")).toBeNull());
      await connected.rail.refresh({ terminals: true });
    } else if (transition === "open") {
      fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
      flush();
      await waitFor(() => expect(tab("9")).not.toBeNull());
      await connected.rail.refresh({ terminals: true });
    } else if (transition === "dismiss") {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      flush();
    } else if (transition === "save" || transition === "other-save" || transition === "cancel-edit") {
      await edit(transition === "other-save" ? "1" : "2");

      if (transition !== "cancel-edit") { fireEvent.input(field(), { target: { value: "saved name" } }); flush(); }

      fireEvent.keyDown(field(), { key: transition === "cancel-edit" ? "Escape" : "Enter" });
      flush();
      await waitFor(() => expect(field()).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(tab(transition === "other-save" ? "1" : "2")));
    } else {
      app.handlers["terminal.close"] = () => { throw new Error("Still refused"); };

      await closeAccepted("2");
      await screen.findByRole("alert", { name: "Still refused" });
    }

    if (["delete", "dismiss", "save", "replace", "successful-delete"].includes(transition)) {
      await waitFor(() => expect(notices("alert")).toHaveLength(0));
    } else expect(screen.getByRole("alert", { name: transition === "failed-delete" ? "Still refused" : refusal })).toBeDefined();
  });

it.each(["delete", "save", "dismiss", "recover"])("p3557c_failure_lifetime_bubbles_open: %s", async transition => {
  const { app, connected, setListed } = await mountBubbles();
  const open = app.handlers["terminal.open"]!;
  app.handlers["terminal.open"] = () => { throw new Error("Cannot open Terminal"); };

  fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
  flush();
  await screen.findByRole("alert", { name: "Cannot open Terminal" });

  if (transition === "delete") {
    setListed(TERMINALS.filter(terminal => terminal.id !== "2"));
    app.emit(event({ name: "terminal.changed" }));
    await waitFor(() => expect(tab("2")).toBeNull());
  } else if (transition === "save") {
    await edit("2");
    fireEvent.input(field(), { target: { value: "renamed" } });
    flush();
    fireEvent.keyDown(field(), { key: "Enter" });
    flush();
    await waitFor(() => expect(field()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(tab("2")));
  } else if (transition === "recover") {
    app.handlers["terminal.open"] = open;
    fireEvent.click(screen.getByRole("button", { name: "New Terminal" }));
    flush();
    await waitFor(() => expect(tab("9")).not.toBeNull());
  } else { fireEvent.click(screen.getByRole("button", { name: "Dismiss" })); flush(); }

  if (["dismiss", "recover"].includes(transition)) await waitFor(() => expect(notices("alert")).toHaveLength(0));
  else expect(notices("alert")).toHaveLength(1);
});

it("p3557c_failure_lifetime_bubbles_close: Retry then Keep leaves the failure with its Retry", async () => {
  const { app } = await mountBubbles();
  app.handlers["terminal.close"] = () => { throw new Error("Close refused"); };

  await closeAccepted("2");
  await screen.findByRole("alert", { name: "Close refused" });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  flush();
  await questionDialog();
  await answerQuestion(false);
  await waitFor(() => expect(document.activeElement).toBe(close("2")));
  expect(screen.getByRole("alert", { name: "Close refused" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
});
