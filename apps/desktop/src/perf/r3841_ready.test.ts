import { afterEach, expect, it, vi } from "vitest";
import { createFrameRun } from "./frame_run";
import { createKeystrokeRun, reportTerminal, terminalReady, startFlood, SETUP_BOUND_MS, TYPING_BOUND_MS } from "./run";
import { createFakeApp } from "../testing/fakeApp";
import { cleanup, render, waitFor } from "@solidjs/testing-library";
import { createComponent } from "solid-js";
import { RequestedApp as App } from "../testing/requestedApp";
import { door, info, workstream } from "../testing/nodes";
import { fakeEmulators } from "../terminal/paneHarness";
import { fromBase64 } from "../terminal/base64";


afterEach(() => { cleanup(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each(["idle", "flood"] as const)("u165_k3_opens_its_terminal_with_cmd_t_after_new_workstream (%s)", async (workload) => {
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
    const shell = info(`shell-${terminals.length}`, { owner: "w" });

    terminals = [...terminals, shell];

    return { terminal_id: shell.id };
  };

  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  let producing = false;
  app.handlers["terminal.write"] = () => {
    producing = true;

    return null;
  };

  app.handlers["terminal.read"] = () => ({ from: 0, next: 6, text: producing ? "roundup-flood\n" : "ready\n", truncated: false });

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
  await waitFor(() => expect(document.querySelector('[aria-label="Create"]')).not.toBeNull());
  const opened: string[] = [];

  const input = await terminalReady(app, terminal, workload === "flood" ? async (flood) => {
    await startFlood(app, flood);
    producing = false;
    opened.push(flood.closest<HTMLElement>("[data-bubble]")!.dataset.bubble!);
    expect(terminal.target()).toBeNull();
  } : undefined);

  expect(terminal.target()).toBe(workload === "flood" ? "shell-2" : "shell-1");
  expect(opened).toEqual(workload === "flood" ? ["shell-1"] : []);
  expect(app.calls.filter(call => call.method === "rail.createWorkstream")).toHaveLength(1);
  expect(input).toBe(document.activeElement);
  expect(app.calls.filter(call => call.method === "terminal.open").map(call => call.params)).toEqual(Array.from({ length: workload === "flood" ? 2 : 1 }, () => ({ workstream: "w", cols: 100, rows: 30 })));
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
  button.setAttribute("aria-label", "New Workstream");
  button.onclick = () => document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div>');
  const app = createFakeApp();

  app.handlers["terminal.list"] = () => [info("shell")];
  app.handlers["terminal.read"] = () => ({ from: 0, next: 6, text: "ready\n", truncated: false });
  app.handlers["terminal.write"] = () => null;
  const rpc = vi.spyOn(app, "rpc");
  const run = kind === "keys" ? createKeystrokeRun(app) : createFrameRun(app, "unknown", "/tmp", () => false);
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
  document.body.innerHTML = '<button aria-label="New Workstream"></button>';
  document.querySelector("button")!.onclick = () => {
    document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div>');

    if (options.agent !== false) document.body.insertAdjacentHTML("beforeend", '<textarea class="xterm-helper-textarea"></textarea>');
  };

  const app = createFakeApp();

  app.handlers["terminal.list"] = () => [info("shell")];
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
  expect(fixture.rpc.mock.calls.every(([method]) => method === "terminal.read" || method === "terminal.list")).toBe(true);
});

it.each(["live", "retained"])("r3841c_only_the_measured_shell_can_release_setup_and_receive_report (%s)", async (source) => {
  vi.useFakeTimers();
  const fixture = setup({ retained: "already\nnot ready\nreadying\nready" });
  let recover: ((read: { from: number; next: number; text: string; truncated: boolean }) => void) | undefined;

  if (source === "retained") {
    const retained = fixture.app.handlers["terminal.read"]!;
    let answered = false;

    fixture.app.handlers["terminal.read"] = (params) => answered ? retained(params) : (answered = true, new Promise<{ from: number; next: number; text: string; truncated: boolean }>((resolve) => { recover = resolve; }));
  }

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
  fixture.app.handlers["terminal.read"] = ({ after }) => after === 0
    ? { from: 0, next: 9, text: "noise\nrea", truncated: true }
    : { from: 9, next: 13, text: "dy\r\n", truncated: false };
  await terminalReady(fixture.app, fixture.terminal);
  expect(fixture.terminal.target()).toBe("shell");
  expect(fixture.rpc.mock.calls.filter(([method]) => method !== "terminal.list")).toEqual([
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
    expect(fixture.rpc.mock.calls.filter(([method]) => method !== "terminal.list")).toEqual([["terminal.read", { id: "shell", after: 0, reader: null, max: null }]]);
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
    expect(fixture.rpc.mock.calls.every(([method, params]) => method === "terminal.list" || method === "terminal.read" && params !== null && "id" in params && params.id === "shell")).toBe(true);
  },
);

it("r20_flood_counts_only_its_opened_terminal_over_the_typing_interval", async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  document.body.innerHTML = '<section data-bubble="flood"><textarea></textarea></section>';
  let producing = false;
  let offset = 100;

  app.handlers["terminal.read"] = () => ({ from: 0, next: 20, text: producing ? "roundup-flood\n" : "ready\n", truncated: false });
  app.handlers["terminal.write"] = ({ id, data }) => {
    expect(id).toBe("flood");
    expect(new TextDecoder().decode(fromBase64(data))).toBe("yes roundup-flood\n");
    producing = true;

    return null;
  };

  app.handlers["terminal.list"] = () => [info("flood")];
  app.handlers["terminal.snapshot"] = ({ id }) => {
    expect(id).toBe("flood");

    return { cols: 80, rows: 24, after: offset, data: "" };
  };

  const flood = await startFlood(app, document.querySelector("textarea")!);
  await flood.sample();
  document.querySelector<HTMLElement>("section")!.hidden = true;
  offset += 64000;
  await vi.advanceTimersByTimeAsync(1000);
  await flood.poll();
  expect(flood.evidence).toMatchObject({ id: "flood", command: "/usr/bin/yes roundup-flood", bytes: 64000, interval_ms: 1000, bytes_per_second: 64000, samples: [{ bytes: 100, state: "visible" }, { bytes: 64100, state: "folded" }] });
  await vi.advanceTimersByTimeAsync(1000);
  await expect(flood.poll()).rejects.toThrow("producer is silent");
});

it("r20_flood_samples_a_few_ms_apart_are_not_a_silent_producer", async () => {
  vi.useFakeTimers();
  const app = createFakeApp();
  document.body.innerHTML = '<section data-bubble="flood"><textarea></textarea></section>';
  let offset = 100;
  let producing = false;

  app.handlers["terminal.read"] = () => ({ from: 0, next: 20, text: producing ? "roundup-flood\n" : "ready\n", truncated: false });
  app.handlers["terminal.write"] = () => {
    producing = true;

    return null;
  };

  app.handlers["terminal.list"] = () => [info("flood")];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: offset, data: "" });
  const flood = await startFlood(app, document.querySelector("textarea")!);
  await flood.sample();
  await vi.advanceTimersByTimeAsync(1000);
  offset += 64000;
  await flood.sample();
  await vi.advanceTimersByTimeAsync(18);
  await expect(flood.sample()).resolves.toBeUndefined();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(flood.sample()).rejects.toThrow("producer is silent");
});

it.each(["missing", "exited", "pending", "silent"])("r20_inactive_flood_is_a_named_invalid_observation (%s)", async (kind) => {
  vi.useFakeTimers();
  const app = createFakeApp();
  document.body.innerHTML = '<section data-bubble="flood"><textarea></textarea></section>';
  let producing = false;

  app.handlers["terminal.read"] = () => ({ from: 0, next: 20, text: producing && kind !== "silent" ? "roundup-flood\n" : "ready\n", truncated: false });
  app.handlers["terminal.write"] = () => {
    producing = true;

    return null;
  };

  app.handlers["terminal.list"] = () => kind === "pending" ? new Promise<never>(() => {}) : kind === "missing" ? [] : [info("flood", { running: false })];
  let retained: unknown;
  const done = startFlood(app, document.querySelector("textarea")!, evidence => { retained = evidence; }).then(flood => flood.sample()).catch(error => error);
  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
  expect(await done).toMatchObject({ message: expect.stringContaining(kind === "pending" ? "liveness" : kind === "silent" ? "active output" : "missing or exited") });
  expect(retained).toMatchObject({ id: "flood", opened: true, command: "/usr/bin/yes roundup-flood" });
  expect(app.calls.some(call => call.method === "terminal.measure")).toBe(false);
  const reads = app.calls.length;
  await vi.advanceTimersByTimeAsync(SETUP_BOUND_MS);
  expect(app.calls).toHaveLength(reads);
});

it("r20_flood_reports_activity_and_drops_when_output_stops_display_frames", async () => {
  vi.useFakeTimers();
  const now = performance.now.bind(performance);
  let reads = 0;
  // Model a ticking high-resolution clock while fake timers control the typing deadline.
  const clock = vi.spyOn(performance, "now").mockImplementation(() => now() + reads++ / 1000);
  const app = createFakeApp();
  let producing = false;
  let shells = 0;
  let bytes = 0;
  const reports: Uint8Array[] = [];
  document.body.innerHTML = '<button>Add</button>';
  const create = document.querySelector("button")!;
  create.setAttribute("aria-label", "New Workstream");
  create.onclick = () => {
    document.body.insertAdjacentHTML("beforeend", '<div role="treeitem" aria-selected="true"></div><textarea class="xterm-helper-textarea"></textarea>');
  };

  const open = (event: KeyboardEvent) => {
    if (event.key !== "t") return;
    shells += 1;
    document.body.insertAdjacentHTML("beforeend", `<section class="bubble" data-bubble="shell-${shells}"><textarea class="xterm-helper-textarea"></textarea></section>`);
  };

  document.addEventListener("keydown", open);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    if (!producing) setTimeout(() => callback(now()), 8);

    return 1;
  });
  app.handlers["terminal.read"] = ({ id }) => ({ from: 0, next: 20, text: id === "shell-1" && producing ? "roundup-flood\n" : "ready\n", truncated: false });
  app.handlers["terminal.write"] = ({ id, data }) => {
    const chunk = fromBase64(data);

    if (id === "shell-1") {
      expect(new TextDecoder().decode(chunk)).toBe("yes roundup-flood\n");
      producing = true;
    } else reports.push(chunk);

    return null;
  };

  app.handlers["terminal.list"] = () => [info("shell-1"), info("shell-2")];
  app.handlers["terminal.snapshot"] = () => ({ cols: 80, rows: 24, after: bytes += 64000, data: "" });
  app.handlers["terminal.measure"] = () => ({ at: performance.now(), samples: [] });

  try {
    const done = createKeystrokeRun(app, "flood").start();
    await vi.advanceTimersByTimeAsync(TYPING_BOUND_MS + SETUP_BOUND_MS * 2);
    await done;
    const line = new TextDecoder().decode(Uint8Array.from(reports.flatMap(chunk => [...chunk])));
    const report = JSON.parse(line.slice(5));

    expect(report).toMatchObject({ terminal_id: "shell-2", n: 0, dropped: 1100, frame_ms: 8, error: "no key was echoed and rendered after the warm-up", flood: { id: "shell-1", bytes: expect.any(Number) } });
    expect(report.flood.bytes).toBeGreaterThan(0);
    expect(report.flood.samples.length).toBeGreaterThan(1);
  } finally {
    clock.mockRestore();
    document.removeEventListener("keydown", open);
  }
});

it("r20_the_recorder_addresses_the_terminal_the_daemon_listed_not_the_placeholder_of_one_still_opening", async () => {
  localStorage.clear();
  const app = createFakeApp();
  const emulators = fakeEmulators();
  let nodes: ReturnType<typeof workstream>[] = [];
  let terminals: ReturnType<typeof info>[] = [];
  let answer: () => void = () => {};

  const opening = new Promise<void>(resolve => (answer = resolve));

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

  app.handlers["terminal.open"] = async () => {
    await opening;
    terminals = [...terminals, info("7", { owner: "w" })];

    return { terminal_id: "7" };
  };

  app.handlers["terminal.resize"] = () => null;
  app.handlers["terminal.snapshot"] = () => ({ cols: 100, rows: 30, after: 0, data: "" });
  app.handlers["terminal.read"] = () => ({ from: 0, next: 6, text: "ready\n", truncated: false });

  const terminal = reportTerminal((id: string) => {
    const emulator = emulators.factory(id);
    const show = emulator.show;

    // Like xterm, the input exists as soon as the host is prepared, before `terminal.open` answers.
    const input = (host: HTMLElement) => {
      const area = document.createElement("textarea");

      area.className = "xterm-helper-textarea";
      host.appendChild(area);
    };

    return { ...emulator, prepare: async (host: HTMLElement, ...rest: unknown[]) => {
      // SAFETY: the fake emulator's prepare resolves the size it was given.
      const size = await (emulator.prepare as (...args: unknown[]) => Promise<{ cols: number; rows: number }>)(host, ...rest);

      input(host);

      return size;
    }, show: (host: HTMLElement, focus?: boolean) => {
      const size = show(host, focus);

      if (!host.querySelector("textarea")) input(host);

      return size;
    } };
  });

  render(() => createComponent(App, { app, reducedMotion: () => true, clock: () => 0, createEmulator: terminal.createEmulator }));
  await waitFor(() => expect(document.querySelector('[aria-label="Create"]')).not.toBeNull());
  const ready = terminalReady(app, terminal);

  setTimeout(answer, 100);
  await ready;
  expect(terminal.target()).toBe("7");
  // SAFETY: only terminal.read calls are kept, and they carry { id }.
  expect(app.calls.filter(call => call.method === "terminal.read").map(call => (call.params as { id: string }).id)).toEqual(["7"]);
});
