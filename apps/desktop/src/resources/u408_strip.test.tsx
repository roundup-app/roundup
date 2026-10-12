import { cleanup, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Resources } from "@contracts/project/Resources";
import { RpcError } from "../app/seam";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent, NOW, workstream } from "../testing/nodes";
import { cpuText, sizeText } from "./format";
import { ResourceStrip } from "./ResourceStrip";

const RESULT: Resources = {
  agents: [{ id: "a", memory_bytes: 412e6, cpu_percent: 18, disk_bytes: 2.1e9 }],
  total: { memory_bytes: 1.4e9, cpu_percent: 61, disk_bytes: 3.2e9 },
};

const sheet = Object.values(import.meta.glob<string>("./styles.css", { query: "?raw", import: "default", eager: true }))[0] ?? "";

const mount = async (tree: RailNode[], options: { select?: string | null; result?: () => Resources | Promise<Resources> } = {}) => {
  const app = createFakeApp();
  const [exit, setExit] = createSignal<{ code: number | null } | null>(null);

  app.handlers["rail.tree"] = () => tree;
  app.handlers["project.resources"] = options.result ?? (() => RESULT);

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => NOW, exit);

  connected.rail.select(options.select === undefined ? "a" : options.select);

  const view = render(() => (
    <ConnectedProjectContext.Provider value={connected}>
      <ResourceStrip />
    </ConnectedProjectContext.Provider>
  ));

  const calls = () => app.calls.filter((call) => call.method === "project.resources").length;

  return { app, connected, view, calls, setExit };
};

const strip = () => document.querySelector<HTMLElement>(".resource-strip");

const words = () => [...(strip()?.children ?? [])].map((part) => part.textContent?.replace(/\s+/g, " ").trim()).join(" ");

const settle = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

beforeEach(() => vi.useFakeTimers());

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("u408 the Resource strip", () => {
  it("u408_the_strip_words_for_an_agent_and_the_project", async () => {
    await mount([agent("a", "working", "x")]);
    await settle();

    expect(words()).toBe("memory 412 MB · cpu 18% · disk 2.1 GB project 1.4 GB · 61% · 3.2 GB");
  });

  it("u408_units_round_by_magnitude_and_never_nan", () => {
    const cases: [number, string][] = [[0, "0 B"], [999, "999 B"], [1000, "1.0 KB"], [812000, "812 KB"], [4.25e6, "4.3 MB"], [2.1e9, "2.1 GB"], [999.9e9, "1.0 TB"], [12.3e12, "12.3 TB"], [412e6, "412 MB"]];

    for (const [bytes, text] of cases) expect(sizeText(bytes)).toBe(text);

    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined]) expect(sizeText(bad)).toBe("–");

    expect(cpuText(18.5)).toBe("19%");
    expect(cpuText(-3)).toBe("–");
    expect(cpuText(Number.NaN)).toBe("–");
  });

  it("u408_a_null_disk_reads_a_dash", async () => {
    await mount([agent("a", "working", "x")], { result: () => ({ agents: [{ id: "a", memory_bytes: 1, cpu_percent: 0, disk_bytes: null }], total: { memory_bytes: 1, cpu_percent: 0, disk_bytes: null } }) });
    await settle();

    expect(words()).toBe("memory 1 B · cpu 0% · disk – project 1 B · 0% · –");
  });

  it("u408_a_done_agent_or_a_workstream_shows_only_the_project", async () => {
    const { connected } = await mount([agent("a", "done", "x"), workstream("w"), agent("b", "working", "y")], { select: "a" });
    await settle();

    expect(words()).toBe("project 1.4 GB · 61% · 3.2 GB");

    connected.rail.select("w");
    expect(words()).toBe("project 1.4 GB · 61% · 3.2 GB");

    connected.rail.select(null);
    expect(words()).toBe("project 1.4 GB · 61% · 3.2 GB");

    connected.rail.select("b");
    expect(words()).toContain("memory – · cpu – · disk –");
  });

  it("u408_no_running_agent_draws_no_strip_and_makes_no_call", async () => {
    const { calls } = await mount([agent("a", "done", "x")]);
    await settle(10_000);

    expect(strip()).toBeNull();
    expect(calls()).toBe(0);
  });

  it("u408_polls_every_two_seconds_while_shown_and_never_twice_at_once", async () => {
    const { app, calls } = await mount([agent("a", "working", "x")]);
    let release: (value: Resources) => void = () => {};

    app.handlers["project.resources"] = () => new Promise<Resources>((resolve) => (release = resolve));
    await settle();
    expect(calls()).toBe(1);

    await settle(6000);
    expect(calls()).toBe(2);

    release(RESULT);
    await settle();
    await settle(2000);
    expect(calls()).toBe(3);
  });

  it("u408_stops_on_hide_tab_close_and_daemon_exit", async () => {
    const { calls, setExit, view } = await mount([agent("a", "working", "x")]);
    await settle();
    expect(calls()).toBe(1);

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle(10_000);
    expect(calls()).toBe(1);

    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(calls()).toBe(2);

    setExit({ code: 1 });
    await settle(10_000);
    expect(calls()).toBe(2);

    view.unmount();
  });

  it("u408_a_late_response_for_another_selection_is_dropped", async () => {
    let release: (value: Resources) => void = () => {};

    const { connected } = await mount([agent("a", "working", "x"), agent("b", "working", "y")], { result: () => new Promise<Resources>((resolve) => (release = resolve)) });

    await settle();
    connected.rail.select("b");
    release(RESULT);
    await settle();

    expect(words()).toContain("memory – · cpu – · disk –");
    expect(words()).toContain("project – · – · –");
  });

  it("u408_a_failed_call_keeps_the_last_values_and_says_so", async () => {
    const { app } = await mount([agent("a", "working", "x")]);
    await settle();
    expect(words()).not.toContain("not updating");

    app.handlers["project.resources"] = () => {
      throw new RpcError(-32603, "gone");
    };

    await settle(2000);
    expect(words()).toContain("not updating");
    expect(words()).toContain("412 MB");

    app.handlers["project.resources"] = () => RESULT;
    await settle(2000);
    expect(words()).not.toContain("not updating");
  });

  it("u408_the_rail_holds_none_of_it", async () => {
    const { view } = await mount([agent("a", "working", "x")]);
    await settle();

    expect(document.querySelector(".rail")).toBeNull();
    expect(view.container.querySelectorAll(".rail-row").length).toBe(0);
  });

  it("u408_the_strip_holds_still_as_digits_change", async () => {
    let at = 0;
    const second: Resources = { agents: [{ id: "a", memory_bytes: 999e6, cpu_percent: 1600, disk_bytes: 12.3e12 }], total: { memory_bytes: 999.9e9, cpu_percent: 1600, disk_bytes: 12.3e12 } };

    await mount([agent("a", "working", "x")], { result: () => [RESULT, second][at++ % 2] ?? RESULT });
    await settle();

    const numbers = [...document.querySelectorAll(".resource-num")];

    expect(numbers.length).toBe(6);
    expect(sheet).toMatch(/\.resource-num\s*{[^}]*font-variant-numeric:\s*tabular-nums/);
    expect(sheet).toMatch(/\.resource-num\s*{[^}]*min-width:\s*7ch/);

    await settle(2000);
    expect(document.querySelectorAll(".resource-num").length).toBe(6);
    expect(words()).toContain("999 MB · cpu 1600% · disk 12.3 TB");
  });

  it("u408_the_strip_is_a_quiet_status", async () => {
    await mount([agent("a", "working", "x")]);
    await settle();

    const element = strip()!;

    expect(element.getAttribute("role")).toBe("status");
    expect(element.getAttribute("aria-live")).toBe("off");
    expect(element.getAttribute("aria-hidden")).toBe("false");
    expect(element.hasAttribute("tabindex")).toBe(false);
    expect(element.querySelector("[tabindex],button,a")).toBeNull();
    expect(document.activeElement).toBe(document.body);

    const title = element.querySelector<HTMLElement>(".resource-agent")!.title;

    for (const phrase of ["resident memory", "CPU of one core", "Worktree on disk"]) expect(title).toContain(phrase);
  });

  it("u408_no_strip_leaves_the_pane_height_unchanged", async () => {
    await mount([agent("a", "done", "x")]);
    await settle();

    expect(strip()).toBeNull();
    expect(sheet).toMatch(/\.resource-strip\s*{[^}]*flex:\s*none/);
  });
});
