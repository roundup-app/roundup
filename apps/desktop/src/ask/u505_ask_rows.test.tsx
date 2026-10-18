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
import { ask, mountAskBar, rowTexts } from "./askFixture";

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

    await waitFor(() => expect(rowTexts()).toEqual(["ship it | ops | Sent", "later | lead | Queued for the supervisor"]));

    app.emit(event({ name: "ask.changed", data: { ask: ask("a0", 1, [{ text: "later", placement: { kind: "routed", workstream: "lead" }, state: "typed" }]) } }));
    await waitFor(() => expect(rowTexts()[1]).toBe("later | lead | Sent"));
    expect(within(document.querySelectorAll<HTMLElement>(".ask-row")[1]!).getByRole("img", { name: "Idle" })).toBeTruthy();
    app.emit(event({ name: "agent.status", data: { id: "lead", attempt: "1", status_revision: "2", status: { kind: "working", label: "working", since: 2 } } }));
    await waitFor(() => expect(within(document.querySelectorAll<HTMLElement>(".ask-row")[1]!).getByRole("img", { name: "Working" })).toBeTruthy());
  });

  it("u505_selecting_a_row_selects_its_workstream", async () => {
    await observe(async (browser, origin) => {
      for (const activation of ["click", "Enter", "Space"]) {
        await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
        await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
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
            ["rail.startDoor", "terminal.write", "takeover.begin"].includes(c.method) || c.method.startsWith("ask.")).length
        })`);

        expect(observed.result).toEqual({ clicks: 1, writes: 0 });
        await browser("eval", "localStorage.clear()");
      }
    });
  }, 120_000);

  it("u505_arrows_move_between_openable_rows", async () => {
    await observe(async (browser, origin) => {
      await browser("open", new URL("/harness.html?seed=tree-40", origin).href);
      await browser("wait", "--fn", "!!window.__fake && !!document.querySelector('.rail-row')");
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

      for (const mode of ["home", "over"]) {
        if (mode === "over") {
          await browser("press", "Meta+/");
          await browser("wait", "--fn", "document.querySelector('.ask-bar')?.dataset.mode === 'over'");
        }

        await browser("focus", ".ask-row[data-state=queued] button.ask-line");

        for (const [key, state] of [["ArrowUp", "queued"], ["ArrowDown", "typed"], ["ArrowDown", "typed"], ["ArrowUp", "queued"], ["ArrowDown", "typed"]] as const) {
          await browser("press", key);
          await browser("wait", "--fn", `document.activeElement === document.querySelector('.ask-row[data-state="${state}"] button.ask-line')`);
        }

        if (mode === "over") {
          await browser("press", "Escape");
          await browser("wait", "--fn", "!document.querySelector('.ask-input')");
          await browser("press", "Meta+/");
          await browser("wait", "--fn", "document.querySelector('.ask-bar')?.dataset.mode === 'over'");
          await browser("focus", ".ask-row[data-state=typed] button.ask-line");
        }

        await browser("press", "Enter");
        await browser("wait", "--fn", "document.querySelector('.rail-row[data-id=payments]')?.dataset.selected === 'true' && !document.querySelector('.ask-input')");
        expect((await browser("eval", "document.querySelector('.pane-screen').contains(document.activeElement)")).result).toBe(true);
      }
    });
  }, 120_000);

  it("u505_a_row_is_a_button_named_by_its_cells", async () => {
    await mountAskBar([typed, ask("plain", 1, [{ text: "plain", placement: { kind: "new", title: "future" }, state: "placing" }])]);
    expect(await screen.findByRole("button", { name: /ship it.*Needs-you.*ops.*Sent/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /plain/ })).toBeNull();
  });

  it("u505_a_failed_row_shows_its_reason", async () => {
    await mountAskBar([ask("a1", 1, [{ text: "go", placement: { kind: "routed", workstream: "ops" }, state: "failed", reason: "the Door ended before this reached it" }])]);

    await waitFor(() => expect(document.querySelector(".ask-reason")?.textContent).toBe("the Door ended before this reached it"));
    expect(rowTexts()).toEqual(["go | ops | Failed"]);
  });
});
