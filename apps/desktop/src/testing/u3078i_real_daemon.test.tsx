import { OrderDrawer } from "../orders/OrderDrawer";
import { ConnectedProjectContext } from "../state/connectedProject";
import type { ConnectedProject } from "../state/connectedProject";
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { RequestedApp as App } from "../testing/requestedApp";
import { fakeEmulators } from "../terminal/paneHarness";
import { startRealDaemon } from "./realDaemonFixture";
import { createServedApp } from "./realSeam";

/** U3078i: the real Daemon with a fake vendor that reports through the public CLI; the App reads, inspects and resumes. */
const REPO = resolve(process.cwd(), "../..");

const REPORTER = readFileSync(join(REPO, "crates/rup/tests/evidence_support/reporter.py"), "utf8");

afterEach(cleanup);

window.matchMedia ??= (query) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false });

const interrupted = async (mode: "replace" | "document") => {
  const logs = mkdtempSync(join(tmpdir(), "u3078i-"));
  const log = (name: string) => existsSync(join(logs, name)) ? readFileSync(join(logs, name), "utf8") : "";

  const real = await startRealDaemon({
    FAKE_CLAUDE_CHILD_PROCESS: JSON.stringify(["python3", "-c", REPORTER, join(REPO, "target/debug/rup"), join(logs, "report"), mode]),
    FAKE_CLAUDE_LAUNCH_LOG: join(logs, "launches"),
    FAKE_CLAUDE_PROMPT_LOG: join(logs, "prompts"),
  });

  const served = createServedApp(real.base);
  const home = await served.rpc("rail.createWorkstream", { name: "Original", parent: null });
  const worker = await served.rpc("agent.spawn", { cwd: real.dir, prompt: null, parent: home.id, name: "Login", order: { kind: "work", ask: "Fix login", done: "Login passes", limits: [] } });

  await waitFor(() => expect(existsSync(join(logs, "report"))).toBe(true), { timeout: 30_000 });
  await waitFor(async () => expect((await served.rpc("message.progress", { project: real.dir, id: worker.id })).results.length).toBeGreaterThan(5), { timeout: 30_000 });

  const open = async () => {
    const app = createServedApp(real.base);
    let connected: ConnectedProject | undefined;
    const view = render(() => <App app={app} reducedMotion={() => false} clock={Date.now} createEmulator={fakeEmulators().factory} prepareIdle={open => { connected = open; }} />);

    const row = await waitFor(() => {
      const found = [...document.querySelectorAll(".name")].find((each) => each.textContent === "Login");

      if (!found) throw new Error("the Login row has not arrived");

      return found;
    }, { timeout: 30_000 });

    await waitFor(() => expect(connected).toBeDefined());
    fireEvent.click(row);
    // U4453a removes the ordinary goal entry point; retained recovery still renders this component.
    connected!.drawer.open(() => <ConnectedProjectContext.Provider value={connected!}><OrderDrawer id={worker.id} /></ConnectedProjectContext.Provider>, "key");

    return { view, section: await screen.findByRole("region", { name: "Progress" }, { timeout: 30_000 }) };
  };

  return { real, served, worker, logs, log, open, messages: async () => (await served.rpc("message.list", { to: null, status: null })).length };
};

it("u3078i_real_daemon_reopen_and_resume", async () => {
  const run = await interrupted("replace");

  try {
    const before = { messages: await run.messages(), launches: run.log("launches"), prompts: run.log("prompts") };
    const first = await run.open();

    // Opening reads: the older version waits behind its disclosure, unknown effects name their cause.
    const reading = within(first.section);

    expect(reading.getAllByText("Unknown outcome").length).toBe(3);
    expect(reading.getAllByText(/never issue the effect again/).length).toBe(3);
    expect({ messages: await run.messages(), launches: run.log("launches"), prompts: run.log("prompts") }).toEqual(before);

    fireEvent.click(reading.getByRole("button", { name: "Resume unfinished work" }));
    await waitFor(async () => expect(await run.messages()).toBe(before.messages + 1), { timeout: 30_000 });
    const decided = (await run.served.rpc("message.reconcileWork", { project: run.real.dir, id: run.worker.id })).actions;

    expect(decided.every((action) => action.decision !== null)).toBe(true);

    // Reopening shows it taken, offers no second Resume, and sends nothing.
    cleanup();
    const again = await run.open();

    await waitFor(() => expect(within(again.section).queryByRole("button", { name: /Resume unfinished/ })).toBeNull());
    expect(await run.messages()).toBe(before.messages + 1);
    expect(run.log("launches")).toBe(before.launches);
  } finally {
    cleanup();
    await run.real.stop();
  }
}, 60_000);

it("u3078i_real_daemon_document_work_resumes_the_same_way", async () => {
  const run = await interrupted("document");

  try {
    const before = await run.messages();
    const opened = await run.open();
    const view = within(opened.section);

    // Reviewed prose and a diagram are results like any other: the one unfinished step is offered.
    expect(view.getByText(/Prepare the diagram/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Resume unfinished work" }));
    await waitFor(async () => expect(await run.messages()).toBe(before + 1), { timeout: 30_000 });
    const sent = (await run.served.rpc("message.list", { to: null, status: null })).slice(before);

    expect(sent.length).toBe(1);
    expect(sent[0]?.body).toContain("Prepare the diagram");
  } finally {
    cleanup();
    await run.real.stop();
  }
}, 60_000);

it("u3078i_real_daemon_failed_resume_stays_actionable", async () => {
  const run = await interrupted("replace");

  try {
    await run.served.rpc("agent.stop", { id: run.worker.id });
    const before = { messages: await run.messages(), launches: run.log("launches") };
    const stopped = await run.open();
    const view = within(stopped.section);

    fireEvent.click(view.getByRole("button", { name: "Resume unfinished work" }));
    await view.findByRole("alert", { name: /resume was not accepted/ }, { timeout: 30_000 });
    expect(document.activeElement).toBe(view.getByRole("button", { name: "Try resuming again" }));
    // A stopped Agent stays stopped: nothing was sent and no program started.
    expect(await run.messages()).toBe(before.messages);
    expect(run.log("launches")).toBe(before.launches);
  } finally {
    cleanup();
    await run.real.stop();
  }
}, 60_000);
