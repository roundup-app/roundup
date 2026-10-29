import { copy } from "../copy";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { appServer } from "../testing/appServer";
import { chromePath } from "../testing/chromePage";
import { cleanup, screen, waitFor, within } from "@solidjs/testing-library";
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
        await browser("eval", "window.__fake.app.projects().then(list => window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:list.at(-1).path,command:'view:ask-history'}})))");
        await browser("eval", `(() => {
          window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed",
            data: {ask: {id: "native", at: "1", text: "ship it", parts: [{text: "ship it",
              placement: {kind: "routed", workstream: "payments"}, state: "typed"}]}}});
        })()`);
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
        await browser("eval", "window.__fake.app.projects().then(list => window.dispatchEvent(new CustomEvent('open-project-page', {detail:{path:list.at(-1).path,command:'view:ask-history'}})))");
      await browser("eval", `(() => {
        const parts = [
          {text: "first", placement: {kind: "routed", workstream: "backend"}, state: "queued"},
          {text: "plain", placement: {kind: "unclear", question: "Which?", candidates: ["payments"]}, state: "waiting"},
          {text: "last", placement: {kind: "routed", workstream: "payments"}, state: "typed"}
        ];
        window.__fake.emit({actor: {kind: "user", id: "you", parent: null}, name: "ask.changed",
          data: {ask: {id: "arrows", at: "1", text: "arrows", parts}}});
      })()`);
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

const mountAskBar = async (...args: Parameters<typeof mountQuietAskBar>) => { const mounted = await mountQuietAskBar(...args); mounted.connected.showView("ask-history");

 return mounted; };


it("u2539b_history_shows_each_doors_current_status_once", async () => {
  const { app } = await mountAskBar(Array.from({ length: 12 }, (_, n) => ask(`history-${n}`, n, [
    { text: `Authored request ${n}`, placement: { kind: "routed", workstream: "ops" }, state: "typed" },
  ])));

  expect(document.querySelectorAll(".ask-row")).toHaveLength(12);
  expect(document.querySelectorAll(".ask-kind")).toHaveLength(1);
  expect(app.calls.filter(call => call.method === "ask.send" || call.method === "terminal.write")).toHaveLength(0);
});

it("u4277c_empty_history_keeps_composition_without_target_actions", async () => {
  const { app } = await mountAskBar();
  const list = document.querySelector<HTMLElement>(".ask-rows")!;
  await waitFor(() => expect(list.getAttribute("aria-busy")).toBe("false"));
  expect(within(list).queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByRole("group", { name: copy.askHistoryEmpty })).toBeTruthy();
  expect(document.querySelector('.ask-input')).toBeTruthy();
  expect(app.calls.filter(call => ["ask.send", "agent.spawn", "terminal.write"].includes(call.method))).toHaveLength(0);
});

it("u505_only_sent_parts_viewed_in_their_target_fold", async () => {
  const split = ask("split", 4, [
    { text: "first", placement: { kind: "routed", workstream: "ops" }, state: "typed" },
    { text: "second", placement: { kind: "routed", workstream: "lead" }, state: "queued" },
  ]);
  const { connected, app } = await mountAskBar([split]);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(2));
  connected.rail.select("lead");
  connected.rail.select(null);
  expect(screen.queryByRole("button", { name: /Earlier/ })).toBeNull();
  connected.rail.select("ops");
  connected.rail.select(null);
  await waitFor(() => expect(screen.getByRole("button", { name: /Earlier/ }).getAttribute("aria-expanded")).toBe("false"));
  expect(rowTexts()).toEqual([`second | lead | ${copy.askQueued}`]);
  app.emit(event({ name: "ask.changed", data: { ask: { ...split, parts: split.parts.map(part => ({ ...part, state: "typed" })) } } }));
  expect(document.querySelectorAll(".ask-row")).toHaveLength(1);
  connected.rail.select("lead");
  connected.rail.select(null);
  await waitFor(() => expect(document.querySelectorAll(".ask-row")).toHaveLength(0));
  expect(screen.getByRole("button", { name: /Earlier/ }).textContent).toContain("2");
  expect(app.calls.filter(call => ["ask.send", "rail.startDoor", "terminal.write"].includes(call.method))).toHaveLength(0);
});
