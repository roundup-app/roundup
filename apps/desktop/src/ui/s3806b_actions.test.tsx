import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { answerQuestion, questionDialog } from "../shelf/bulkQuestionHarness";
import { RpcError } from "../app/seam";
import { questionProbe } from "../testing/menuProbe";
import type { RailNode } from "@contracts/agent/RailNode";
import type { FakeApp } from "../testing/fakeApp";
import { Rail } from "../rail/Rail";
import { ConnectedProjectContext } from "../state/connectedProject";
import { agent } from "../testing/nodes";
import { field, mountSwitcher, openSwitcher, switcherKey } from "../switcher/switcherFixture";

afterEach(() => { Object.defineProperty(questionProbe, "shown", { configurable: true, writable: true, value: null }); cleanup(); localStorage.clear(); sessionStorage.clear(); });

type Pending = { resolve: () => void; reject: (error: Error) => void };

/** One call the fake Daemon has received and not yet answered. */
const pending = <T,>(entered: () => void, value: T) => {
  const reply = Promise.withResolvers<T>();

  const handler = (): Promise<T> => {
    entered();

    return reply.promise;
  };

  return { handler, gate: { resolve: () => reply.resolve(value), reject: reply.reject } satisfies Pending };
};

type Row = {
  owner: "Rail" | "Bubble";
  label: string;
  selected: string;
  origin: string;
  method: string;
  params: unknown;
  /** Installs the pending handler for this row's method; `entered` runs as the call arrives. */
  hold: (app: FakeApp, entered: () => void) => Pending;
  confirms: boolean;
  /** The row that leaves the Rail while the reply is pending. A failed Remove is shown only while its own row stays (P3557c), so that row is never this one. */
  removes: string;
};

/** The scoped Rail Switcher actions that reach `rpc`, with the opening Project's object and the arguments its activation captures. */
const ROWS: Row[] = [
  { owner: "Rail", label: "New Agent", selected: "ops", origin: '[data-id="ops"][role="treeitem"]', method: "agent.spawn", confirms: false, removes: "bob",
    params: { cwd: "/p", prompt: null, parent: "ops", model: null, effort: null, cols: 100, rows: 30 },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, agent("created", "idle", "idle", { terminal_id: "created-terminal" }));

      app.handlers["agent.spawn"] = handler;

      return gate;
    } },
  { owner: "Rail", label: "New Agent with a prompt", selected: "ops", origin: '[data-id="ops"][role="treeitem"]', method: "agent.spawn", confirms: false, removes: "bob",
    params: { cwd: "/p", prompt: "A\ne\u0301 🧭", parent: "ops", model: null, effort: null, cols: 100, rows: 30 },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, agent("created", "idle", "idle"));
      app.handlers["agent.spawn"] = handler;

      return gate;
    } },
  { owner: "Rail", label: "Remove", selected: "ann", origin: '[data-id="ann"][role="treeitem"]', method: "rail.remove", confirms: true, removes: "bob",
    params: { id: "ann" },
    hold: (app, entered) => {
      const { handler, gate } = pending(entered, null);

      app.handlers["rail.remove"] = handler;

      return gate;
    } },

];

const options = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.switcher [role="option"]')];

const activate = (row: HTMLElement, how: "enter" | "pointer"): void => {
  if (how === "pointer") {
    fireEvent.pointerDown(row, { button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(row, { button: 0, pointerType: "mouse" });
    fireEvent.click(row);
  } else switcherKey("Enter", {}, field()!);
};

const cases = ROWS.flatMap((row) => (["pointer", "enter"] as const).flatMap((how) =>
  (row.confirms ? ["dismiss", "cancel", "resolve", "reject"] as const : (row.label === "New Agent" ? ["dismiss", "resolve", "reject", "unknown", "missing"] as const : ["dismiss", "resolve", "reject", "unknown"] as const)).map((outcome) => ({ row, how, outcome }))));

it.each(cases)("s3806b_action_survives_surface_close: $row.owner $row.label by $how, pending reply $outcome", async ({ row, how, outcome }) => {
  const { app, connected } = await mountSwitcher(row.selected);
  const trace: string[] = [];
  const reply = row.hold(app, () => trace.push(`${row.method}:${field() === null ? "closed" : "open"}`));

  let shown = questionProbe.shown;

  Object.defineProperty(questionProbe, "shown", {
    configurable: true,
    get: () => shown,
    set: (value) => {
      shown = value;

      if (value !== null) trace.push(`question:${field() === null ? "closed" : "open"}`);
    },
  });

  document.querySelector<HTMLElement>(row.origin)!.focus();
  openSwitcher();
  await waitFor(() => expect(field()).not.toBeNull());
  fireEvent.input(field()!, { target: { value: row.label } });
  await waitFor(() => expect(field()!.value).toBe(row.label));
  const query = row.label;
  const option = options().find((candidate) => candidate.querySelector(".switcher-name")?.textContent === row.label)!;
  expect(option).toBeDefined();
  const before = app.calls.length;

  const ofMethod = () => app.calls.slice(before).filter((call) => call.method === row.method);

  if (outcome === "dismiss") {
    // Closing the surface alone starts no call and asks nothing.
    switcherKey("Escape", {}, field()!);
    await waitFor(() => expect(field()).toBeNull());
    expect(app.calls.slice(before)).toEqual([]);
    expect(trace).toEqual([]);

    return;
  }

  activate(option, how);
  let submitted: ReturnType<typeof connected.drafts.list>[number] | undefined;
  let newer: ReturnType<typeof connected.drafts.list>[number] | undefined;

  if (row.label === "New Agent with a prompt") {
    const prompt = await screen.findByRole<HTMLTextAreaElement>("textbox", { name: "Task" });
    fireEvent.input(prompt, { target: { value: " A\ne\u0301 🧭 " } });
    submitted = connected.drafts.list().find(entry => entry.destination.surface === "rail-task");
    switcherKey("Enter", {}, prompt);
    await waitFor(() => expect(ofMethod()).toHaveLength(1));
    fireEvent.input(prompt, { target: { value: " newer\n😀 " } });
    newer = connected.drafts.list().find(entry => entry.destination.surface === "rail-task" && entry.revision !== submitted?.revision);
    switcherKey("Escape", {}, prompt);
  }

  // The surface is dismissed first so Ark's focus trap releases focus to an action that moves it; the captured action still starts once.
  if (row.confirms) {
    await questionDialog();
    expect(trace).toEqual(["question:closed"]);
    expect(ofMethod()).toEqual([]);
    await answerQuestion(outcome !== "cancel");

    if (outcome === "cancel") {
      expect(ofMethod()).toEqual([]);
      expect(trace).toEqual(["question:closed"]);

      return;
    }
  }

  await waitFor(() => expect(ofMethod()).toHaveLength(1));
  expect(trace).toEqual(row.confirms ? ["question:closed", `${row.method}:closed`] : [`${row.method}:closed`]);
  expect(ofMethod().map((call) => call.params)).toEqual([row.params]);
  await waitFor(() => expect(field()).toBeNull());

  // Changing the tree and selection must not retarget the pending action.
  const tree = app.handlers["rail.tree"]!;
  // SAFETY: the fake Daemon's rail.tree handler answers a RailNode[].
  app.handlers["rail.tree"] = (params) => [...(tree(params) as RailNode[]).filter((node) => node.id !== (outcome === "missing" ? row.selected : row.removes)), agent("keep", "idle", "idle", { order: 9 })];
  await connected.rail.refresh({ terminals: true });
  connected.rail.select("keep");
  expect(ofMethod()).toHaveLength(1);

  if (outcome === "resolve") {
    reply.resolve();
    await Promise.resolve();
    expect(connected.rail.selected()).toBe("keep");

    if (submitted) {
      await waitFor(() => expect(connected.drafts.list().some(entry => entry.revision === submitted.revision)).toBe(false));
      expect(connected.drafts.list()).toContainEqual(newer);
    }
  } else {
    reply.reject(outcome === "unknown" ? new Error(`${row.label} rejected by the Daemon`) : new RpcError(row.label === "New Agent with a prompt" ? -32003 : -32000, `${row.label} rejected by the Daemon`));
    await waitFor(() => expect(document.body.textContent).toContain(`${row.label} rejected by the Daemon`));

    if (row.method === "agent.spawn") {
      const notice = document.querySelector(".rail-command-notice")!;
      const retry = notice.querySelector("button");
      expect(retry).not.toBeNull();
      expect(connected.rail.commandFailure.message()).toContain("New Agent");
      // Removing the rendering owner must not discard the connection's recovery.
      // guarded's finally releases the add action after publishing the failure.
      await waitFor(() => expect(document.querySelector('.rail-actions button[aria-label="New Agent"]')?.getAttribute("aria-disabled")).toBeNull());
      const recovery = connected.rail.commandFailure.retry();
      cleanup();
      expect(connected.rail.commandFailure.retry()).toBe(recovery);

      if (submitted) {
        expect(connected.drafts.list().find(entry => entry.revision === submitted.revision)).toMatchObject({ ...submitted, status: outcome === "unknown" ? "unknown" : "failed" });
        expect(connected.drafts.list()).toContainEqual(newer);
      }

      render(() => <ConnectedProjectContext.Provider value={connected}><Rail /></ConnectedProjectContext.Provider>);
      app.handlers["agent.spawn"] = () => agent("recovered", "idle", "idle");
      fireEvent.click(document.querySelector(".rail-command-notice button")!);

      if (outcome === "missing") {
        expect(ofMethod()).toHaveLength(1);
        expect(connected.rail.commandFailure.message()).toContain("unavailable");

        return;
      }

      if (submitted && outcome === "unknown") {
        expect(document.activeElement).toBe(document.querySelector(`[data-revision="${submitted.revision}"] textarea`));
        expect(ofMethod()).toHaveLength(1);
        expect(connected.drafts.list()).toContainEqual(newer);

        return;
      }

      await waitFor(() => expect(ofMethod()).toHaveLength(2));
      expect(ofMethod().map(call => call.params)).toEqual([row.params, row.params]);
      await waitFor(() => expect(connected.rail.commandFailure.message()).toBeNull());

      if (submitted) {
        expect(connected.drafts.list().some(entry => entry.revision === submitted.revision)).toBe(false);
        expect(connected.drafts.list()).toContainEqual(newer);
      }

      expect(app.calls.slice(before).filter(call => call.method === "terminal.write" || call.method === "message.send")).toEqual([]);

      return;
    }
  }

  expect(ofMethod()).toHaveLength(1);
  expect(app.calls.slice(before).filter((call) => call.method === "terminal.write")).toEqual([]);

  // The query the user typed comes back exactly.
  openSwitcher();
  await waitFor(() => expect(field()?.value).toBe(query));
});
