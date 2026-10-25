import { afterEach, expect, it, vi } from "vitest";
import { createFrameRun } from "./frame_run";
import { createKeystrokeRun, reportTerminal, terminalReady, SETUP_BOUND_MS } from "./run";
import { createFakeApp } from "../testing/fakeApp";


afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["keys", "frames"])("r3841a_terminal_setup_waits_for_agent_before_opening_shell (%s)", async (kind) => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", vi.fn());
  document.body.innerHTML = '<button>Add</button>';
  const button = document.querySelector("button")!;
  button.setAttribute("aria-label", "Add Workstream");
  button.onclick = () => document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div>');
  const app = createFakeApp();

  app.handlers["terminal.read"] = () => ({ from: 0, next: 6, text: "ready\n", truncated: false });
  app.handlers["terminal.write"] = () => null;
  const rpc = vi.spyOn(app, "rpc");
  const run = kind === "keys" ? createKeystrokeRun(app) : createFrameRun(app, "unknown", "/tmp");
  let opens = 0;

  const open = (event: KeyboardEvent) => {
    if (event.key !== "t") return;
    opens += 1;
    document.body.insertAdjacentHTML("beforeend", '<div class="bubble" data-bubble="shell"><textarea class="xterm-helper-textarea"></textarea></div>');

  };

  document.addEventListener("keydown", open);
  const done = run.start();
  // Drains the selected-row/MutationObserver promises without advancing the setup bound.
  await vi.advanceTimersByTimeAsync(0);
  expect(opens).toBe(0);
  document.body.insertAdjacentHTML("beforeend", '<textarea class="xterm-helper-textarea"></textarea>');
  await vi.advanceTimersByTimeAsync(0);
  expect(opens).toBe(1);
  expect(document.activeElement?.closest<HTMLElement>("[data-bubble]")?.dataset.bubble).toBe("shell");
  document.body.insertAdjacentHTML("beforeend", '<div class="bubble" data-bubble="later"><textarea class="xterm-helper-textarea"></textarea></div>');
  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
  await done;
  expect(rpc.mock.calls.filter(([method]) => method === "terminal.write")).toHaveLength(1);
  expect(rpc.mock.calls.filter(([method]) => method === "terminal.write").every(([, params]) => params !== null && "id" in params && params.id === "shell")).toBe(true);
  document.removeEventListener("keydown", open);
});

const bytes = (text: string) => new TextEncoder().encode(text);

const setup = (options: { agent?: boolean; shell?: boolean; retained?: string } = {}) => {
  document.body.innerHTML = '<button aria-label="Add Workstream"></button>';
  document.querySelector("button")!.onclick = () => {
    document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div>');

    if (options.agent !== false) document.body.insertAdjacentHTML("beforeend", '<textarea class="xterm-helper-textarea"></textarea>');
  };

  const app = createFakeApp();

  app.handlers["terminal.read"] = () => ({ from: 0, next: (options.retained ?? "").length, text: options.retained ?? "", truncated: false });
  const rpc = vi.spyOn(app, "rpc");
  const terminal = reportTerminal(() => ({ write: (_: Uint8Array, parsed?: () => void) => parsed?.() }));

  const open = (event: KeyboardEvent) => {
    if (event.key === "t" && options.shell !== false) document.body.insertAdjacentHTML("beforeend", '<div class="bubble" data-bubble="shell"><textarea class="xterm-helper-textarea"></textarea></div>');
  };

  document.addEventListener("keydown", open);
  cleanups.push(() => document.removeEventListener("keydown", open));

  return { app, rpc, terminal, shell: terminal.createEmulator("shell"), agent: terminal.createEmulator("agent") };
};

const cleanups: (() => void)[] = [];

afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); });

it.each(["before", "after"])("r3841b_ready_before_or_after_bubble_open_releases_setup (%s)", async (order) => {
  vi.useFakeTimers();
  const fixture = setup({ retained: order === "before" ? "ready\r\n" + "stream\n".repeat(200) : "stream\n" });
  const done = terminalReady(fixture.app, fixture.terminal);
  await vi.advanceTimersByTimeAsync(0);

  if (order === "after") fixture.shell.write(bytes("ready\n"));
  expect(await done).toBe(document.querySelector('[data-bubble="shell"] textarea'));
  expect(fixture.terminal.target()).toBe("shell");
  expect(fixture.rpc).toHaveBeenCalledWith("terminal.read", { id: "shell", after: 0, reader: null, max: null });
  // A screen snapshot would contain only the tail of the stream; readiness must use the log instead.
  expect(fixture.rpc.mock.calls.every(([method]) => method === "terminal.read")).toBe(true);
});

it.each(["live", "retained"])("r3841c_only_the_measured_shell_can_release_setup_and_receive_report (%s)", async (source) => {
  vi.useFakeTimers();
  const fixture = setup({ retained: "already\nnot ready\nreadying\nready" });
  let recover: ((read: { from: number; next: number; text: string; truncated: boolean }) => void) | undefined;

  if (source === "retained") fixture.rpc.mockReturnValueOnce(new Promise<{ from: number; next: number; text: string; truncated: boolean }>((resolve) => { recover = resolve; }));
  fixture.agent.write(bytes("ready\n"));
  const continued = vi.fn();
  const done = terminalReady(fixture.app, fixture.terminal).then(continued);
  await vi.advanceTimersByTimeAsync(0);
  expect(continued).not.toHaveBeenCalled();
  // Incomplete retained READY cannot be joined to the overlapping live stream.
  fixture.shell.write(bytes("\n"));
  expect(fixture.terminal.target()).toBeNull();
  fixture.shell.write(bytes("rea"));
  fixture.agent.write(bytes("ready\n"));
  expect(continued).not.toHaveBeenCalled();

  if (source === "retained") recover?.({ from: 0, next: 7, text: "ready\r\n", truncated: false });
  else fixture.shell.write(bytes("dy\r\n"));
  await done;
  fixture.shell.write(bytes("ready\n"));
  fixture.terminal.createEmulator("later").write(bytes("ready\n"));
  expect(continued).toHaveBeenCalledTimes(1);
  expect(fixture.terminal.target()).toBe("shell");
  expect(fixture.terminal.input()).toBe(document.activeElement);
});

it.each([
  [{ agent: false }, "Agent input"],
  [{ shell: false }, "shell Terminal's input"],
  [{ retained: "ready" }, "shell Terminal's ready line"],
] as const)("r3841d_missing_readiness_stops_before_workload (%j)", async (options, step) => {
  vi.useFakeTimers();
  const fixture = setup(options);
  const workload = vi.fn();
  const done = terminalReady(fixture.app, fixture.terminal).then(workload).catch((error: Error) => error);
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
  expect(await done).toMatchObject({ message: expect.stringContaining(step) });
  expect(workload).not.toHaveBeenCalled();
});

it("r3841b_retained_readiness_crosses_read_pages_without_restarting_the_shell", async () => {
  vi.useFakeTimers();
  const fixture = setup();
  fixture.rpc.mockResolvedValueOnce({ from: 0, next: 9, text: "noise\nrea", truncated: true });
  fixture.rpc.mockResolvedValueOnce({ from: 9, next: 13, text: "dy\r\n", truncated: false });
  await terminalReady(fixture.app, fixture.terminal);
  expect(fixture.terminal.target()).toBe("shell");
  expect(fixture.rpc.mock.calls).toEqual([
    ["terminal.read", { id: "shell", after: 0, reader: null, max: null }],
    ["terminal.read", { id: "shell", after: 9, reader: null, max: null }],
  ]);
});
