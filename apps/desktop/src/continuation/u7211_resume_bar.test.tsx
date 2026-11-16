import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import type { RailNode } from "@contracts/agent/RailNode";
import type { ContinuationAction } from "@contracts/message/ContinuationAction";
import type { Reconciliation } from "@contracts/message/Reconciliation";
import type { ResumeWork } from "@contracts/message/ResumeWork";
import type { ResumeWorkParams } from "@contracts/message/ResumeWorkParams";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import { copy as inkCopy } from "../ink/copy";
import { captureActions } from "../keys/registry";
import { ConnectedProjectContext, connectProject } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { agent } from "../testing/nodes";
import type { Candidate } from "../toasts/queue";
import { copy } from "./copy";
import { ResumeBar } from "./ResumeBar";

afterEach(cleanup);

const CODE = INTERNAL_CODE + 1;

const action = (id: string): ContinuationAction => ({ id, report: "r1", target: { id: "t1", revision: "1" }, output: "v1", instruction: "i1", next: "repair", decision: null });

const planOf = (id: string, actions: readonly ContinuationAction[]): Reconciliation => ({ agent: id, actions: [...actions], blocked: [], context: [], pending_checks: [] });

const resumedOf = (id: string, actions: readonly ContinuationAction[]): ResumeWork => ({
  decision: { id: "d1", request: "q1", actions: actions.map(each => each.id), message: 1 },
  reconciliation: planOf(id, actions),
});

const idle = (...ids: string[]): RailNode[] => ids.map(id => agent(id, "idle", "waiting"));

type Setup = {
  nodes?: RailNode[];
  work: Record<string, ContinuationAction[]>;
  read?: (id: string) => Reconciliation;
  resume?: (params: ResumeWorkParams) => ResumeWork;
};

const mount = async (setup: Setup) => {
  const app = createFakeApp();
  const toasts: Candidate[] = [];
  const reads: string[] = [];
  const sent: ResumeWorkParams[] = [];

  app.handlers["rail.tree"] = () => setup.nodes ?? idle("a", "b");

  app.handlers["message.reconcileWork"] = ({ id }) => {
    reads.push(id);

    return (setup.read ?? (each => planOf(each, setup.work[each] ?? [])))(id);
  };

  app.handlers["message.resumeWork"] = params => {
    sent.push(params);

    return (setup.resume ?? (each => resumedOf(each.id, setup.work[each.id] ?? [])))(params);
  };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => false, () => 0);

  render(() => <ConnectedProjectContext.Provider value={connected}><ResumeBar notify={candidate => toasts.push(candidate)} /></ConnectedProjectContext.Provider>);
  await connected.rail.settled();

  const bar = () => document.querySelector<HTMLElement>(".resume-bar");

  const inBar = () => {
    const found = bar();

    if (found === null) throw new Error("the resume bar is not showing");

    return within(found);
  };

  return { toasts, reads, sent, select: connected.rail.select, bar, inBar };
};

const command = () => captureActions(document.body).find(each => each.name === "leader.resume");

it("u7211a_the_bar_shows_only_while_the_selected_agent_has_unfinished_work", async () => {
  const nodes = [...idle("a", "b", "d"), agent("c", "working", "busy"), agent("e", "idle", "waiting", { terminal_id: null }), agent("f", "needs-you", "asking"), agent("g", "error", "crashed")];
  const { reads, sent, select, bar, inBar } = await mount({ nodes, work: { a: [action("x1")], c: [action("x2")], e: [action("x3")], f: [action("x4")], g: [action("x5")] } });

  expect(bar()).toBeNull();

  select("a");
  await waitFor(() => expect(bar()).not.toBeNull());
  expect(inBar().getByRole("button", { name: copy.resume })).toBeTruthy();
  expect(inBar().getByRole("button", { name: copy.dismiss })).toBeTruthy();

  for (const id of ["b", "c", "e", "f", "g"]) {
    select(id);
    expect(bar(), id).toBeNull();
  }

  expect(reads.toSorted()).toEqual(["a", "b", "d"]);
  expect(sent).toEqual([]);
});

it("u7211a_a_failed_read_says_so_and_retries", async () => {
  let failing = true;

  const { select, bar, inBar } = await mount({ work: { a: [action("x1")] }, read: id => {
    if (failing) throw new RpcError(CODE, "refused");

    return planOf(id, id === "a" ? [action("x1")] : []);
  } });

  await waitFor(() => expect(bar()?.textContent).toContain(copy.checkFailed(copy.rpcFailure(CODE))));

  failing = false;
  select("a");
  fireEvent.click(inBar().getByRole("button", { name: inkCopy.retry }));
  await waitFor(() => expect(inBar().getByRole("button", { name: copy.resume })).toBeTruthy());
  expect(bar()?.textContent).not.toContain(copy.checkFailed(copy.rpcFailure(CODE)));
});

it("u7211b_resume_sends_one_request_and_the_bar_goes_once_it_succeeds", async () => {
  const { sent, select, bar } = await mount({ work: { a: [action("x1")] } });

  select("a");
  fireEvent.click(await screen.findByRole("button", { name: copy.resume }));
  await waitFor(() => expect(bar()).toBeNull());

  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ project: "/p", id: "a", action: "x1" });
  expect(sent[0]?.request).toMatch(/\S/);
});

it("u7211b_a_failed_resume_shows_its_error_and_retries_with_the_same_request", async () => {
  let failing = true;

  const { sent, select, bar, inBar } = await mount({ work: { a: [action("x1")] }, resume: params => {
    if (failing) throw new RpcError(CODE, "refused");

    return resumedOf(params.id, [action("x1")]);
  } });

  select("a");
  fireEvent.click(await screen.findByRole("button", { name: copy.resume }));
  await waitFor(() => expect(bar()?.textContent).toContain(copy.rpcFailure(CODE)));

  failing = false;
  fireEvent.click(inBar().getByRole("button", { name: copy.resume }));
  await waitFor(() => expect(bar()).toBeNull());

  const [first, second] = sent;

  expect(second?.request).toBe(first?.request);
});

it("u7211c_dismiss_hides_the_bar_for_that_work_and_resumes_nothing", async () => {
  const { sent, select, bar, inBar } = await mount({ work: { a: [action("x1")], b: [action("x2")] } });

  select("a");
  fireEvent.click(await screen.findByRole("button", { name: copy.dismiss }));
  expect(bar()).toBeNull();

  select("b");
  await waitFor(() => expect(bar()).not.toBeNull());
  fireEvent.keyDown(inBar().getByRole("button", { name: copy.resume }), { key: "Escape" });
  expect(bar()).toBeNull();

  select("a");
  expect(bar()).toBeNull();
  expect(sent).toEqual([]);
});

it("u7211d_the_command_is_offered_only_while_an_agent_has_unfinished_work", async () => {
  await mount({ work: {} });
  expect(command()).toBeUndefined();
  cleanup();

  const { select } = await mount({ work: { b: [action("x1")] } });

  await waitFor(() => expect(command()?.label).toBe(copy.title));

  select("b");
  fireEvent.click(await screen.findByRole("button", { name: copy.dismiss }));
  expect(command()).toBeDefined();
});

it("u7211d_the_command_resumes_every_agent_with_work_and_reports_how_many", async () => {
  const { sent, toasts } = await mount({ nodes: idle("a", "b", "c"), work: { a: [action("x1")], b: [action("x2")] } });

  await waitFor(() => expect(command()).toBeDefined());
  command()?.run();
  await waitFor(() => expect(toasts).toHaveLength(1));

  expect(sent.map(each => each.id).toSorted()).toEqual(["a", "b"]);
  expect(toasts[0]).toMatchObject({ kind: "done", line: copy.resumedAgents(2) });
  expect(command()).toBeUndefined();
});

it("u7211d_the_report_counts_the_agents_that_could_not_resume", async () => {
  const { toasts } = await mount({ work: { a: [action("x1")], b: [action("x2")] }, resume: params => {
    if (params.id === "b") throw new RpcError(CODE, "refused");

    return resumedOf(params.id, [action("x1")]);
  } });

  await waitFor(() => expect(command()).toBeDefined());
  command()?.run();
  await waitFor(() => expect(toasts).toHaveLength(1));

  expect(toasts[0]).toMatchObject({ kind: "error", line: copy.resumedSome(1, 2) });
  expect(command()).toBeDefined();
});
