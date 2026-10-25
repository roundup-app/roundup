import { afterEach, expect, it, vi } from "vitest";
import { createFrameRun } from "./frame_run";
import { createKeystrokeRun, reportTerminal, terminalReady, SETUP_BOUND_MS } from "./run";
import { createFakeApp } from "../testing/fakeApp";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { createComponent } from "solid-js";
import { App } from "../App";
import { door, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { fromBase64 } from "../terminal/base64";


afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("r20_the_real_app_setup_reaches_the_ready_shell_before_measurement", async () => {
  localStorage.clear();
  const app = createFakeApp();
  const emulators = fakeEmulators();
  let nodes: ReturnType<typeof workstream>[] = [];
  let terminals: ReturnType<typeof info>[] = [];

  app.opened.project = { name: "isolated", path: "/r20" };
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["terminal.list"] = () => terminals;
  app.handlers["rail.createWorkstream"] = () => {
    const node = workstream("w");

    nodes = [node];

    return node;
  };

  app.handlers["rail.startDoor"] = () => {
    const node = door("w", "idle", "idle");

    nodes = [node];
    terminals = [info("t-w")];

    return node;
  };

  app.handlers["terminal.open"] = () => {
    const shell = info("shell", { owner: "w" });

    terminals.push(shell);

    return { terminal_id: shell.id };
  };

  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.read"] = () => ({ from: 0, next: 6, text: "ready\n", truncated: false });

  const terminal = reportTerminal((id: string) => {
    const emulator = emulators.factory(id);
    const show = emulator.show;

    return { ...emulator, show: (host: HTMLElement, focus?: boolean) => {
      const size = show(host, focus);
      const input = document.createElement("textarea");
      input.className = "xterm-helper-textarea";
      host.appendChild(input);

      return size;
    } };
  });

  render(() => createComponent(App, { app, reducedMotion: () => true, clock: () => 0, createEmulator: terminal.createEmulator }));
  await waitFor(() => expect(document.querySelector('[aria-label="Add Workstream"]')).not.toBeNull());
  const input = await terminalReady(app, terminal);
  expect(terminal.target()).toBe("shell");
  expect(input).toBe(document.activeElement);
  expect(app.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: "w" }]);
});

it("r20_setup_failure_without_a_ready_target_reports_its_named_step", async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  const written: Uint8Array[] = [];
  let ready = false;

  app.handlers["terminal.open"] = () => ({ terminal_id: "diagnostic" });
  app.handlers["terminal.read"] = () => ({ from: 0, next: ready ? 6 : 0, text: ready ? "ready\n" : "", truncated: false });
  app.handlers["terminal.write"] = ({ id, data }) => {
    expect(id).toBe("diagnostic");
    written.push(fromBase64(data));

    return null;
  };

  const run = createKeystrokeRun(app);
  const done = run.start();
  const outcome = done.catch(error => error);

  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
  expect(written).toEqual([]);
  ready = true;
  await vi.advanceTimersByTimeAsync(50);
  expect(await outcome).toBeUndefined();
  const line = new TextDecoder().decode(Uint8Array.from(written.flatMap(chunk => [...chunk])));

  expect(line.startsWith("PERF ")).toBe(true);
  expect(JSON.parse(line.slice(5))).toMatchObject({ error: "the new Workstream button did not appear within 10000 ms" });
  expect(app.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual([{ workstream: null }]);
  expect(app.calls.filter(call => call.method === "rail.startDoor" || call.method === "terminal.measure")).toEqual([]);
});

it.each(["silent", "pending"])("r20_a_diagnostic_shell_without_readiness_stops_without_writing (%s)", async (output) => {
  vi.useFakeTimers();
  const app = createFakeApp();

  app.handlers["terminal.open"] = () => ({ terminal_id: "diagnostic" });
  app.handlers["terminal.read"] = () => output === "pending"
    ? new Promise<never>(() => {})
    : { from: 0, next: 0, text: "", truncated: false };
  const outcome = createKeystrokeRun(app).start().catch(error => error);

  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS * 2);
  expect(await outcome).toMatchObject({ message: expect.stringContaining("shell Terminal") });
  expect(app.calls.filter(call => call.method === "terminal.write" || call.method === "terminal.measure")).toEqual([]);
});

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

it.each(["\n", "\r\n"].flatMap((ending) => ["", "stream\n", "stream\nrea"].map((initial) => ({ ending, initial }))))(
  "r4006a_ready_between_retained_read_and_first_parsed_write_releases_setup (%j)",
  async ({ ending, initial }) => {
    vi.useFakeTimers();
    const fixture = setup();
    const parsed: (() => void)[] = [];
    const terminal = reportTerminal(() => ({ write: (_: Uint8Array, callback?: () => void) => { if (callback) parsed.push(callback); } }));
    const shell = terminal.createEmulator("shell");
    let retained = initial;

    fixture.app.handlers["terminal.read"] = ({ after }) => ({ from: after ?? 0, next: retained.length, text: retained.slice(after ?? 0), truncated: false });

    const workload = vi.fn();

    const done = terminalReady(fixture.app, terminal).then((input) => {
      workload(input);

      return input;
    });

    // Drain terminalReady's DOM promises and its first retained read, without parsing a write.
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.rpc.mock.calls).toEqual([["terminal.read", { id: "shell", after: 0, reader: null, max: null }]]);
    expect(workload).not.toHaveBeenCalled();

    const rest = initial.endsWith("rea") ? "dy" : "ready";

    retained += rest;
    shell.write(bytes(rest + ending));
    // Observe incomplete readiness across non-truncated reads; the emulator callback stays deferred.
    await vi.advanceTimersByTimeAsync(100);
    expect(workload).not.toHaveBeenCalled();
    expect(terminal.target()).toBeNull();
    expect(fixture.rpc).toHaveBeenCalledWith("terminal.read", { id: "shell", after: initial.length, reader: null, max: null });
    retained += ending;
    await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS - 101);
    expect(workload).toHaveBeenCalledExactlyOnceWith(document.querySelector('[data-bubble="shell"] textarea'));
    expect(await done).toBe(terminal.input());
    expect(terminal.target()).toBe("shell");
    expect(document.activeElement).toBe(terminal.input());
    expect(document.querySelectorAll('[data-bubble="shell"]')).toHaveLength(1);
    // A later parse of the same sole emission cannot continue the workload again.

    for (const callback of parsed) callback();
    await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
    expect(workload).toHaveBeenCalledTimes(1);
    expect(fixture.rpc.mock.calls.every(([method, params]) => method === "terminal.read" && params !== null && "id" in params && params.id === "shell")).toBe(true);
  },
);
