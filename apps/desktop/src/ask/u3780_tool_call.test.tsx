import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { copy } from "./copy";
import type { ToolCall } from "@contracts/agent/ToolCall";
import { agent, door, event } from "../testing/nodes";
import { mountAskBar as mountQuietAskBar } from "./askFixture";

const START = 1_700_000_000_000;

const call = (over: Partial<ToolCall> = {}): ToolCall => ({ tool: "Bash", summary: "just check", arguments: "{\"command\":\"just check\"}", state: "running", started: START, ...over });

const tree = (calls: Record<string, ToolCall> = { ann: call() }) => [
  door("lead", "working", "busy"),
  agent("ann", "working", "busy", { parent: "lead", name: "ann", ...(calls.ann && { tool_call: calls.ann }) }),
  agent("bob", "working", "busy", { parent: "lead", name: "bob", ...(calls.bob && { tool_call: calls.bob }) }),
];

const line = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name} `) });

const row = (name: string) => line(name).closest(".call-line")!;

const toggle = async (name: string) => {
  fireEvent.click(line(name));
  await vi.advanceTimersByTimeAsync(50);
};

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout", "Date", "requestAnimationFrame", "cancelAnimationFrame"] });
  vi.setSystemTime(START);
});

afterEach(() => {
  setVisibility("visible");
  cleanup();
  vi.useRealTimers();
});

const send = async (app: Awaited<ReturnType<typeof mountAskBar>>["app"], connected: Awaited<ReturnType<typeof mountAskBar>>["connected"], id: string, next: ToolCall) => {
  app.emit(event({ name: "agent.toolCall", data: { id, call: next } }));
  await vi.advanceTimersByTimeAsync(0);
  await connected.rail.settled();
};

it("u3780b_a_running_call_ticks_and_a_finished_one_does_not", async () => {
  const { app, connected } = await mountAskBar([], null, tree());

  expect(row("ann").textContent).toContain("Running");
  expect(row("ann").textContent).toContain("0s");
  vi.advanceTimersByTime(3000);
  expect(row("ann").textContent).toContain("3s");

  await send(app, connected, "ann", call({ state: "done", duration_ms: 3200, result: "ok" }));
  vi.advanceTimersByTime(5000);
  expect(row("ann").textContent).toContain("Done");
  expect(row("ann").textContent).toContain("3s");
});

it("u3780b_a_hidden_window_does_not_tick", async () => {
  await mountAskBar([], null, tree());
  setVisibility("hidden");
  vi.advanceTimersByTime(5000);
  expect(row("ann").textContent).toContain("0s");
  setVisibility("visible");
  vi.advanceTimersByTime(2000);
  expect(row("ann").textContent).toContain("7s");
});

it("u3780b_a_new_call_replaces_the_line_in_place", async () => {
  const { app, connected } = await mountAskBar([], null, tree());
  const before = line("ann");

  await send(app, connected, "ann", call({ tool: "Read", summary: "src/a.ts", state: "failed", result: "no file", duration_ms: 40 }));

  expect(line("ann")).toBe(before);
  expect(row("ann").textContent).toContain("Read");
  expect(row("ann").textContent).toContain("src/a.ts");
  expect(row("ann").textContent).toContain("Failed");
  expect(row("ann").querySelector("[data-tone=red]")?.textContent).toBe("Failed");
});

it("u3780b_only_the_changed_line_updates", async () => {
  const { app, connected } = await mountAskBar([], null, tree({ ann: call(), bob: call({ summary: "ls" }) }));
  const bob = line("bob");
  const summary = bob.querySelector(".call-summary")!.firstChild;

  await send(app, connected, "ann", call({ summary: "just test" }));

  expect(line("bob")).toBe(bob);
  expect(bob.querySelector(".call-summary")!.firstChild).toBe(summary);
});

it("u3780c_enter_opens_and_closes_the_fold", async () => {
  await mountAskBar([], null, tree());
  const trigger = line("ann");

  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  trigger.focus();
  await toggle("ann");
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Arguments")).toBeDefined();
  await toggle("ann");
  await vi.advanceTimersByTimeAsync(500);
  document.querySelector(".call-fold")?.dispatchEvent(new Event("animationend"));
  await vi.advanceTimersByTimeAsync(50);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
});

it("u3780c_a_new_call_keeps_the_fold_state", async () => {
  const { app, connected } = await mountAskBar([], null, tree());

  await toggle("ann");
  await send(app, connected, "ann", call({ arguments: "second", state: "done", result: "fine", duration_ms: 1 }));

  expect(line("ann").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("second")).toBeDefined();
  expect(screen.getByText("fine")).toBeDefined();

  await send(app, connected, "ann", call({ arguments: "third" }));
  expect(line("ann").getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("third")).toBeDefined();
});

it("u3780c_copy_writes_the_shown_text", async () => {
  const written: string[] = [];

  const writeText = (text: string) => {
    written.push(text);

    return Promise.resolve();
  };

  const { app } = await mountAskBar([], null, tree({ ann: call({ state: "done", result: "out… (cut, 5 bytes more)", duration_ms: 1 }) }));
  vi.spyOn(app, "clipboardWrite").mockImplementation(writeText);
  await toggle("ann");

  const copies = screen.getAllByRole("button", { name: "Copy" });

  fireEvent.click(copies[1]!);
  await vi.advanceTimersByTimeAsync(0);
  expect(written).toEqual(["out… (cut, 5 bytes more)"]);
  expect(copies[1]!.textContent).toBe("Copied");
  await vi.advanceTimersByTimeAsync(2000);
  expect(copies[1]!.textContent).toBe("Copy");
});

it("u3780c_a_running_call_has_no_result_to_copy", async () => {
  await mountAskBar([], null, tree());
  await toggle("ann");

  expect(screen.getAllByRole("button", { name: "Copy" })).toHaveLength(1);
  expect(screen.getByText("No result yet")).toBeDefined();
});

it("u3780c_the_fold_calls_nothing_and_selects_nothing", async () => {
  const { app, connected } = await mountAskBar([], null, tree());
  const calls = app.calls.length;

  fireEvent.click(line("ann"));

  expect(app.calls).toHaveLength(calls);
  expect(connected.rail.selected()).toBeNull();
});

it("u3780c_reduced_motion_folds_at_once", async () => {
  await mountAskBar([], null, tree(), false, undefined, true);
  fireEvent.click(line("ann"));

  expect(document.querySelector(".call")?.getAttribute("data-reduced-motion")).toBe("true");
});

it("u3780c_payload_text_is_inert", async () => {
  await mountAskBar([], null, tree({ ann: call({ arguments: "<img src=x onerror=alert(1)>" }) }));
  fireEvent.click(line("ann"));

  // SAFETY: the open fold renders this region, or the next line throws.
  const region = document.querySelector(".call-fold") as HTMLElement;

  expect(region.querySelector("img")).toBeNull();
  expect(within(region).getByText("<img src=x onerror=alert(1)>")).toBeDefined();
});

const mountAskBar = async (...args: Parameters<typeof mountQuietAskBar>) => {
  const mounted = await mountQuietAskBar(...args);
  mounted.connected.showView(null);
  mounted.connected.showView("workstreams");

  if (args[1] == null) await vi.waitFor(() => expect(screen.getByRole("region", { name: copy.projectOverview })).toBeTruthy(), { interval: 0 });

  return mounted;
};
