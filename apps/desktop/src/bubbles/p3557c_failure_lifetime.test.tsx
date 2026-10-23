import { cleanup, fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { event } from "../testing/nodes";
import { mountBubbles, TERMINALS } from "./bubblesFixture";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const tab = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab[data-bubble="${id}"]`)!;
const close = (id: string) => document.querySelector<HTMLElement>(`.terminal-tab-pair[data-bubble="${id}"] > button:last-child`)!;
const field = () => document.querySelector<HTMLInputElement>(".terminal-tab-editor input")!;
const edit = async (id: string) => {
  fireEvent.dblClick(tab(id).querySelector(".terminal-tab-name")!);
  await waitFor(() => expect(document.activeElement).toBe(field()));
};

it.each(["delete", "other-delete", "open", "dismiss", "save", "other-save", "cancel-edit", "failed-delete"])(
  "p3557c_failure_lifetime_bubbles: %s", async transition => {
    const mounted = await mountBubbles();
    const { app, connected, setListed } = mounted;
    await edit("1");
    const text = "  unfinished e\u0301 🫧 雪  ";
    fireEvent.input(field(), { target: { value: text } });
    fireEvent.keyDown(field(), { key: "Escape" });
    const retained = connected.drafts.list();
    const remove = app.handlers["terminal.close"]!;
    app.handlers["terminal.close"] = () => { throw new Error("Close refused\nTry again"); };
    fireEvent.click(close("2"));
    await screen.findByRole("alert", { name: "Close refused\nTry again" });
    app.handlers["terminal.close"] = remove;

    if (transition === "delete") {
      setListed(TERMINALS.filter(terminal => terminal.id !== "2"));
      app.emit(event({ name: "terminal.changed" }));
      await waitFor(() => expect(tab("2")).toBeNull());
    } else if (transition === "other-delete") {
      fireEvent.click(close("1"));
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
      await waitFor(() => expect(screen.queryByRole("textbox", { name: "Terminal name" })).toBeNull());
    } else {
      app.handlers["terminal.close"] = () => { throw new Error("Still refused"); };
      fireEvent.click(close("2"));
      await screen.findByRole("alert", { name: "Still refused" });
    }

    if (["delete", "dismiss", "save"].includes(transition)) {
      await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    } else expect(screen.getByRole("alert", { name: transition === "failed-delete" ? "Still refused" : "Close refused\nTry again" })).toBeDefined();
    if (transition !== "other-save") expect(connected.drafts.list()).toEqual(retained);
    expect(retained[0]!.value.name).toBe(text);
    expect(retained[0]!.destination).toMatchObject({ object: TERMINALS[0]!.incarnation, recipient: "1", surface: "bubbles" });
  });
