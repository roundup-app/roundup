import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Status } from "@contracts/Status";
import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { agent, event, info, NOW } from "../testing/nodes";
import { mountTodos } from "../todos/testHarness";
import { AskBar } from "../ask/AskBar";
import { ConnectedProjectContext } from "../state/connectedProject";
import { REVEAL_BUBBLE } from "../bubbles/places";

afterEach(cleanup);

beforeEach(() => localStorage.clear());

const status = (kind: Status["kind"], label: string, since = NOW): Status => ({ kind, label, since, finished: "0" });

const mount = async (terminals: TerminalInfo[]) => {
  const m = await mountTodos([], true, [agent("a", "error", "crashed", { name: "alpha", can_resume: true, status: status("error", "crashed", NOW - 5) })]);
  m.app.handlers["terminal.list"] = () => terminals;
  render(() => <ConnectedProjectContext.Provider value={m.connected}><AskBar /></ConnectedProjectContext.Provider>);
  m.connected.showView(null);
  m.connected.showView("attention");
  await screen.findByRole("region", { name: "Needs you" });
  m.app.emit(event({ name: "terminal.changed" }));
  await m.connected.rail.settled();
  await Promise.resolve();

  return m;
};

const rows = () => [...document.querySelectorAll<HTMLElement>("[data-row]")].map(row => row.getAttribute("data-row")!);

const TERMINALS = [
  info("1", { owner: "/p", title: "cargo build", status: status("needs-you", "Proceed? <b>y</b>", NOW) }),
  info("2", { owner: "/p", title: "cargo test", status: status("error", "2 failed", NOW) }),
  info("3", { owner: "/p", title: "watch", status: status("working", "compiling") }),
  info("4", { owner: "/p", title: "lint", status: status("done", "clean") }),
  info("5", { owner: "/p", title: "shell" }),
];

it("ps11_needs_you_lists_needs_you_and_error_terminals_with_their_names", async () => {
  await mount(TERMINALS);

  expect(rows()).toEqual(["a:a", "a:terminal:2", "a:terminal:1"]);

  const row = document.querySelector<HTMLElement>('[data-row="a:terminal:1"]')!;

  expect(row.querySelector(".inbox-row-name")!.textContent).toBe("cargo build");
  fireEvent.click(row.querySelector(".inbox-row")!);
  expect((await screen.findByText(/Proceed\?/)).textContent).toContain("Proceed? <b>y</b>");
  expect(Number(document.querySelector(".inbox-count")!.textContent)).toBe(3);
});

it("ps11_open_focuses_the_reporting_terminal", async () => {
  const m = await mount(TERMINALS);
  const revealed = vi.fn();
  window.addEventListener(REVEAL_BUBBLE, revealed);

  const row = document.querySelector<HTMLElement>('[data-row="a:terminal:2"]')!;

  expect(row.querySelector("button.word")!.textContent).toBe("Open");
  fireEvent.click(row.querySelector("button.word")!);

  expect(revealed).toHaveBeenCalledTimes(1);
  expect((revealed.mock.calls[0]![0] as CustomEvent).detail).toBe("2");
  expect(m.connected.rail.selected()).toBeNull();
  window.removeEventListener(REVEAL_BUBBLE, revealed);
});

it("ps11_routine_kinds_add_no_entry_and_no_interruption", async () => {
  const m = await mount(TERMINALS);
  const toasts = document.querySelectorAll("[data-toast], [role=alert]").length;

  m.app.emit(event({ name: "terminal.status", data: { id: "1", status: status("working", "building") } }));
  m.app.emit(event({ name: "terminal.status", data: { id: "2", status: null } }));
  await Promise.resolve();

  expect(rows()).toEqual(["a:a"]);
  expect(Number(document.querySelector(".inbox-count")!.textContent)).toBe(1);
  expect(document.querySelectorAll("[data-toast], [role=alert]").length).toBe(toasts);
});
