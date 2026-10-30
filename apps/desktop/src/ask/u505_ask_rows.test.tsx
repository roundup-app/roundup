import { createSignal } from "solid-js";
import { captureDir } from "../testing/captures";
import { copy } from "../copy";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { appServer } from "../testing/appServer";
import { chromePath } from "../testing/chromePage";
import { cleanup, fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { event } from "../testing/nodes";
import { ask, mountAskBar as mountQuietAskBar, rowTexts } from "./askFixture";

afterEach(cleanup);

const typed = ask("a1", 2, [{ text: "ship it", placement: { kind: "routed", workstream: "ops" }, state: "typed" }]);

type Browser = (...args: string[]) => Promise<{ result?: unknown }>;

const observe = async (run: (browser: Browser, origin: string) => Promise<void>) => {
  const profile = await mkdtemp(join(tmpdir(), "u505-"));
  const config = join(profile, "config.json");
  await writeFile(config, "{}");
  const server = await appServer();
  const session = basename(profile);
  const executable = chromePath();

  if (!executable) throw new Error("U505 needs headless Chromium");

  const browser = async (...args: string[]) => {
    const { stdout } = await promisify(execFile)("agent-browser", ["--executable-path", executable, "--args", "--no-sandbox", "--config", config, "--session", session, "--profile", profile, "--json", ...args], {
      timeout: 60_000,
      env: Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_BROWSER_"))),
    });

    const reply = JSON.parse(stdout);

    expect(reply.success, stdout).toBe(true);

    return reply.data;
  };

  try {
    await browser("set", "viewport", "1512", "950");
    await browser("set", "media", "dark");
    await run(browser, server.resolvedUrls.local[0]!);
  } finally {
    await browser("close");
    await server.close();
    await rm(profile, { recursive: true, force: true });
  }
};

describe("u505 an Ask row shows progress from Agent state", () => {
  it("u505_a_row_follows_the_doors_status", async () => {
    const { app } = await mountAskBar([
      ask("a0", 1, [{ text: "later", placement: { kind: "routed", workstream: "lead" }, state: "queued" }]),
      typed,
    ]);

    await waitFor(() => expect(rowTexts()).toEqual([`ship it | ops | ${copy.askSent}`, `later | lead | ${copy.askQueued}`]));

    app.emit(event({ name: "ask.changed", data: { ask: ask("a0", 1, [{ text: "later", placement: { kind: "routed", workstream: "lead" }, state: "typed" }]) } }));
    await waitFor(() => expect(rowTexts()[1]).toBe(`later | lead | ${copy.askSent}`));
    expect(within(document.querySelectorAll<HTMLElement>(".ask-row")[1]!).getByRole("img", { name: copy.idle })).toBeTruthy();
    app.emit(event({ name: "agent.status", data: { id: "lead", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: 2, finished: "0" } } }));
    await waitFor(() => expect(within(document.querySelectorAll<HTMLElement>(".ask-row")[1]!).getByRole("img", { name: copy.working })).toBeTruthy());
  });

  it("u505_selecting_a_row_selects_its_workstream", async () => {
    await observe(async (browser, origin) => {
      for (const activation of ["click", "Enter"]) {
        await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&view=workstreams", origin).href);
        await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
        await browser("eval", "window.__fake.app.projects().then(list => window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:list.at(-1).path,command:'view:workstreams'}})))");
        await browser("eval", `(() => {
          window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed",
            data: {ask: {id: "native", at: "1", text: "ship it", parts: [{text: "ship it",
              placement: {kind: "routed", workstream: "payments"}, state: "typed"}]}}});
        })()`);
        await browser("click", ".overview-sections [data-part=item]:nth-child(2) [data-part=item-trigger]");
        await browser("wait", "--fn", "!!document.querySelector('button.ask-line') && document.fonts.status === 'loaded'");
        await browser("eval", `(() => {
          window.__activations = 0;
          document.querySelector('button.ask-line').addEventListener('click', () => window.__activations++);
          window.__calls = window.__fake.app.calls.length;
        })()`);

        if (activation === "click") await browser("click", "button.ask-line");
        else {
          await browser("focus", "button.ask-line");
          await browser("press", activation);
        }

        await browser("wait", "--fn", `document.querySelector('.rail-row[data-id="payments"]')?.dataset.selected === "true"
          && !!document.querySelector('.pane-screen') && document.querySelector('.pane-screen').contains(document.activeElement) && !document.querySelector('.ask-input')`);

        const observed = await browser("eval", `({
          clicks: window.__activations,
          writes: window.__fake.app.calls.slice(window.__calls).filter(c =>
            ["rail.startDoor", "terminal.write"].includes(c.method) || c.method.startsWith("ask.")).length
        })`);

        expect(observed.result).toEqual({ clicks: 1, writes: 0 });
        await browser("eval", "localStorage.clear()");
      }
    });
  }, 60_000);

  it("u505_arrows_move_between_openable_rows", async () => {
    await observe(async (browser, origin) => {
      await browser("open", new URL("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40&view=workstreams", origin).href);
      await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
        await browser("eval", "window.__fake.app.projects().then(list => window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:list.at(-1).path,command:'view:workstreams'}})))");
      await browser("eval", `(() => {
        const parts = [
          {text: "first", placement: {kind: "routed", workstream: "backend"}, state: "queued"},
          {text: "plain", placement: {kind: "unclear", question: "Which?", candidates: ["payments"]}, state: "waiting"},
          {text: "last", placement: {kind: "routed", workstream: "payments"}, state: "typed"}
        ];
        window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed",
          data: {ask: {id: "arrows", at: "1", text: "arrows", parts}}});
      })()`);
      await browser("click", ".overview-sections [data-part=item]:nth-child(2) [data-part=item-trigger]");
      await browser("wait", "--fn", "document.querySelectorAll('button.ask-line').length === 2");

      await browser("focus", ".ask-row[data-state=queued] button.ask-line");

      for (const [key, state] of [["ArrowUp", "queued"], ["ArrowDown", "typed"], ["ArrowDown", "typed"], ["ArrowUp", "queued"], ["ArrowDown", "typed"]] as const) {
        await browser("press", key);
        await browser("wait", "--fn", `document.activeElement === document.querySelector('.ask-row[data-state="${state}"] button.ask-line')`);
      }

      await browser("press", "Enter");
      await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=payments]')?.dataset.selected === 'true' && !document.querySelector('.ask-input')");
      expect((await browser("eval", "document.querySelector('.pane-screen').contains(document.activeElement)")).result).toBe(true);
    });
  }, 60_000);

  it("u505_a_row_is_a_button_named_by_its_cells", async () => {
    await mountAskBar([typed, ask("plain", 1, [{ text: "plain", placement: { kind: "new", title: "future" }, state: "placing" }])]);
    expect(await screen.findByRole("button", { name: new RegExp(typed.parts[0]!.text) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plain/ })).toBeNull();
  });

  it("u505_a_failed_row_shows_its_reason", async () => {
    await mountAskBar([ask("a1", 1, [{ text: "go", placement: { kind: "routed", workstream: "ops" }, state: "failed", reason: "the Door ended before this reached it" }])]);

    await waitFor(() => expect(document.querySelector(".ask-reason")?.textContent).toBe("the Door ended before this reached it"));
    expect(rowTexts()).toEqual(["go | ops | Failed"]);
  });
});

const mountAskBar = mountQuietAskBar;


it("u2539b_history_shows_each_doors_current_status_once", async () => {
  const { app, connected } = await mountAskBar(Array.from({ length: 12 }, (_, n) => ask(`history-${n}`, n, [
    { text: `Authored request ${n}`, placement: { kind: "routed", workstream: "ops" }, state: "typed" },
  ])));

  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(12));
  expect(document.querySelectorAll(".ask-kind")).toHaveLength(1);
  connected.rail.select("ops");
  await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
  connected.rail.select(null);
  fireEvent.click(await screen.findByRole("button", { name: /Earlier/ }));
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(12));
  expect(document.querySelectorAll(".ask-kind")).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "ask.send" || call.method === "terminal.write")).toHaveLength(0);
});

it("u504_empty_overview_mounts_no_attention_or_asks", async () => {
  const { app } = await mountAskBar([], null, []);
  await waitFor(() => expect(app.calls.some(call => call.method === "ask.list")).toBe(true));
  expect(document.querySelector(".ask-parts")).toBeNull();
  expect(document.querySelector(".overview-entry, .inbox-row")).toBeNull();
  expect(screen.queryByRole("button", { name: /Earlier/ })).toBeNull();
  expect(document.querySelector(".ask-input")).toBeTruthy();
  expect(app.calls.filter(call => ["ask.send", "agent.spawn", "terminal.write"].includes(call.method))).toHaveLength(0);
});

it("u505_only_sent_parts_viewed_in_their_target_fold", async () => {
  const split = ask("split", 4, [
    { text: "first", placement: { kind: "routed", workstream: "ops" }, state: "typed" },
    { text: "second", placement: { kind: "routed", workstream: "lead" }, state: "queued" },
  ]);

  const [viewing, setViewing] = createSignal(true);
  const { connected, app } = await mountAskBar([split], null, undefined, false, undefined, false, viewing);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(2));
  connected.rail.select("lead");
  await waitFor(() => expect(connected.rail.selected()).toBe("lead"));
  connected.rail.select(null);
  expect(screen.queryByRole("button", { name: /Earlier/ })).toBeNull();
  connected.rail.select("ops");
  await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
  connected.rail.select(null);
  await waitFor(() => expect(screen.getByRole("button", { name: /Earlier/ }).getAttribute("aria-expanded")).toBe("false"));
  expect(rowTexts()).toEqual([`second | lead | ${copy.askQueued}`]);
  setViewing(false);
  connected.rail.select("lead");
  app.emit(event({ name: "ask.changed", data: { ask: { ...split, parts: split.parts.map(part => ({ ...part, state: "typed" })) } } }));
  expect(connected.asks.acknowledged(connected.asks.entries()[0]!, 1)).toBe(false);
  setViewing(true);
  await waitFor(() => expect(connected.rail.selected()).toBe("lead"));
  connected.rail.select(null);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(0));
  expect(screen.getByRole("button", { name: /Earlier.*2$/ })).toBeTruthy();
  app.emit(event({ name: "ask.changed", data: { ask: ask("later", 5, [
    { text: "first", placement: { kind: "routed", workstream: "ops" }, state: "typed" },
  ]) } }));
  expect(rowTexts()).toEqual([`first | ops | ${copy.askSent}`]);
  expect(app.calls.filter(call => ["ask.send", "rail.startDoor", "terminal.write"].includes(call.method))).toHaveLength(0);
});


it("u505_acknowledgement_survives_restart_per_project", async () => {
  const path = `/ack-${crypto.randomUUID()}`;
  const first = await mountAskBar([typed], null, undefined, false, path);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(1));
  first.connected.rail.select("ops");
  await waitFor(() => expect(first.connected.asks.acknowledged(first.connected.asks.entries()[0]!, 0)).toBe(true));
  first.unmount();
  first.connected.stopTerminalScheme();
  const reopened = await mountAskBar([typed], null, undefined, false, path);
  const control = await screen.findByRole("button", { name: /Earlier/ });
  expect(control.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelectorAll(".ask-row")).toHaveLength(0);
  fireEvent.click(control);
  await waitFor(() => expect(rowTexts()).toEqual([`ship it | ops | ${copy.askSent}`]));
  reopened.unmount();
  reopened.connected.stopTerminalScheme();
  await mountAskBar([typed]);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(1));
  expect(screen.queryByRole("button", { name: /Earlier/ })).toBeNull();
});

it("u505_waiting_and_failed_parts_keep_recovery_until_resolved", async () => {
  const failed = ask("recover", 1, [
    { text: "waiting", placement: { kind: "unclear", question: "Which?", candidates: ["ops"] }, state: "waiting" },
    { text: "failed", placement: { kind: "routed", workstream: "ops" }, state: "failed", reason: "Door ended. Choose a destination to retry." },
  ]);

  const { connected, app } = await mountAskBar([failed]);
  await waitFor(() => expect(document.querySelectorAll(".ask-back")).toHaveLength(2));
  connected.rail.select("ops");
  await waitFor(() => expect(connected.rail.selected()).toBe("ops"));
  connected.rail.select(null);
  expect(document.querySelectorAll(".ask-back")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: /Earlier/ })).toBeNull();
  app.emit(event({ name: "ask.changed", data: { ask: { ...failed, parts: [failed.parts[0]!, { ...failed.parts[1]!, state: "typed" }] } } }));
  expect(document.querySelectorAll(".ask-row")).toHaveLength(2);
  connected.rail.select("ops");
  await waitFor(() => expect(connected.asks.acknowledged(connected.asks.entries()[0]!, 1)).toBe(true));
  connected.rail.select(null);
  expect(document.querySelectorAll(".ask-back")).toHaveLength(1);
  expect(document.querySelectorAll(".ask-row")).toHaveLength(1);
});

const earlierOverview = async (browser: Browser, origin: string) => {
  await browser("set", "media", "dark");
  await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
  await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.ask-input')");
  await browser("eval", `window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed", data: {ask: {id: "fold", at: "1", text: "sent", parts: [{text: "sent", placement: {kind: "routed", workstream: "payments"}, state: "typed"}]}}})`);
  await browser("click", ".overview-sections [data-part=item]:nth-child(2) [data-part=item-trigger]");
  await browser("wait", "--fn", "!!document.querySelector('button.ask-line')");
  await browser("click", "button.ask-line");
  await browser("wait", "--fn", "!!document.querySelector('.pane-screen') && !document.querySelector('.ask-input')");
  await browser("click", ".todo-project-root");
  await browser("wait", "--fn", "!!document.querySelector('.ask-earlier button')");
  await browser("eval", "window.__calls = window.__fake.app.calls.length");
};

it("u505_earlier_toggles_by_click_and_keyboard", async () => {
  await observe(async (browser, origin) => {
    await earlierOverview(browser, origin);

    for (const activation of ["click", "Enter", "Space"]) {
      for (const expanded of [true, false]) {
        if (activation === "click") await browser("click", ".ask-earlier button");
        else {
          await browser("focus", ".ask-earlier button");
          await browser("press", activation);
        }

        await browser("wait", "--fn", `document.querySelector('.ask-earlier button').getAttribute('aria-expanded') === '${expanded}' && document.querySelectorAll('.ask-earlier .ask-row').length === ${expanded ? 1 : 0}`);
      }
    }

    expect((await browser("eval", "window.__fake.app.calls.slice(window.__calls).filter(c => ['ask.send','rail.startDoor','agent.spawn','terminal.write'].includes(c.method)).length")).result).toBe(0);
  });
}, 60_000);

it("u505_expanded_earlier_retains_row_navigation", async () => {
  await observe(async (browser, origin) => {
    await earlierOverview(browser, origin);

    const capture = async (step: string) => {
      for (const id of ["U504", "U505"]) {
        const directory = captureDir(id);

        if (!directory) continue;

        await mkdir(directory, { recursive: true });
        await browser("screenshot", join(directory, `${step}.png`));
        await writeFile(join(directory, `${step}.checks.json`), JSON.stringify((await browser("eval", "window.__checks()")).result));
      }
    };

    await capture("tree-40-earlier-closed");

    await browser("eval", `window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed", data: {ask: {id: "live", at: "2", text: "live", parts: [
      {text: "Keep the full failure actionable", placement: {kind: "routed", workstream: "backend"}, state: "failed", reason: "The Door ended before this reached it. Choose another Workstream or New Workstream to retry."},
      {text: "Which work should own this?", placement: {kind: "unclear", question: "Choose a destination", candidates: ["payments"]}, state: "waiting"},
      {text: "Long request ".repeat(20), placement: {kind: "routed", workstream: "payments"}, state: "queued"},
      {text: "Placing a new request", placement: {kind: "new", title: "New work"}, state: "placing"},
      {text: "Dropped request", placement: {kind: "unclear", question: "Earlier choice", candidates: []}, state: "dropped"}
    ]}}})`);
    await browser("wait", "--fn", "document.querySelectorAll('.ask-back').length === 2");
    await capture("tree-40-live-recovery");
    await browser("eval", "document.querySelector('.ask-earlier').scrollIntoView({block: 'center'})");
    await browser("click", ".ask-earlier .disclosure-trigger");
    await browser("wait", "--fn", "document.querySelector('.ask-earlier .disclosure-trigger').getAttribute('aria-expanded') === 'true' && document.querySelectorAll('.ask-earlier .ask-row').length === 1");
    await browser("eval", "document.querySelector('.ask-earlier').scrollIntoView({block: 'end'})");
    await capture("tree-40-live-earlier-open");
    await capture("tree-40-earlier-open");
    await browser("focus", ".ask-row[data-state=queued] button.ask-line");
    await browser("press", "ArrowDown");
    await browser("wait", "--fn", "document.activeElement === document.querySelector('.ask-earlier button.ask-line')");
    await browser("press", "Enter");
    await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=payments]')?.dataset.selected === 'true' && !!document.querySelector('.pane-screen')");
    expect((await browser("eval", "window.__fake.app.calls.slice(window.__calls).filter(c => ['ask.send','rail.startDoor','agent.spawn','terminal.write'].includes(c.method)).length")).result).toBe(0);
    await browser("open", new URL("/harness.html?seed=empty-project", origin).href);
    await browser("wait", "--fn", "!!document.querySelector('.ask-input') && document.querySelectorAll('.overview-section-trigger').length === 4");
    await capture("empty-project");
  });
}, 60_000);
