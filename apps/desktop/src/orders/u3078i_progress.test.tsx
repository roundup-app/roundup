import { fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { expect, it } from "vitest";
import { gate, mountApp, select } from "../decisions/decisionsFixture";
import { WorkProgress } from "./WorkProgress";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { INTERNAL_CODE, RpcError } from "../app/seam";
import type { ResumeWork } from "@contracts/message/ResumeWork";
import type { FakeApp } from "../testing/fakeApp";
import { progressSeed } from "../testing/progressSeed";
import { agent, clarifying, door } from "../testing/nodes";

const WRITES = ["message.send", "message.resumeWork", "agent.setOrder", "agent.spawn", "agent.resume", "terminal.write"];

const seeded = progressSeed({ project: "/p", agent: "a" });

const openWork = async (prepare: (app: FakeApp) => void = () => {}) => {
  const mounted = await mountApp([], (app) => {
    app.handlers["rail.tree"] = () => [
      agent("a", "working", "editing", { name: "alpha", order: 0, work: { kind: "work", ask: "Fix login", done: "Login passes", limits: [] } }),
      agent("b", "working", "editing", { name: "beta", order: 1, work: clarifying("which?") }),
      door("r", "working", "editing", { name: "harbor", order: 2, work: clarifying("why?") }),
    ];
    app.handlers["agent.spawnPrompt"] = () => ({ prompt: "p" });
    app.handlers["message.progress"] = () => seeded.progress;
    app.handlers["message.reconcileWork"] = () => seeded.plan;
    app.handlers["deliverable.resolve"] = ({ id }) => id === "output-r-gone" ? { kind: "unavailable", cause: "missing-revision" } : { kind: "retained", path: "/p/output.txt", sha256: "0" };
    prepare(app);
  });

  select("alpha");
  await waitFor(() => expect(document.querySelector(".order-line")).not.toBeNull());
  fireEvent.click(document.querySelector(".order-line")!);

  return { ...mounted, section: await screen.findByRole("region", { name: "Progress" }) };
};

/** SAFETY: the handlers under test are the only callers, and each is given this shape. */
const paramsOf = <T,>(app: FakeApp, method: string): T[] => app.calls.filter((call) => call.method === method).map((call) => call.params as T);

const wrote = (app: FakeApp) => app.calls.filter((call) => WRITES.includes(call.method));

it("u3078i_open_inspect_resume_and_reconcile", async () => {
  let accepted = false;

  const { app, section } = await openWork((fake) => {
    let resumes = 0;

    fake.handlers["message.resumeWork"] = () => {
      resumes += 1;

      if (resumes === 1) throw new RpcError(INTERNAL_CODE, "the reply was lost");
      accepted = true;

      return { decision: { id: "d1", request: "r", actions: ["action-login"], message: 7 }, reconciliation: seeded.plan };
    };

    fake.handlers["message.reconcileWork"] = () => accepted ? { ...seeded.plan, actions: [{ ...seeded.action, decision: "d1" }] } : seeded.plan;
  });

  // Open reads; it sends nothing.
  expect(wrote(app)).toEqual([]);
  const view = within(section);
  expect(view.getByText("Login output with the repair still pending")).toBeTruthy();
  expect(view.getAllByText("Accepted").length).toBe(1);
  expect(view.getAllByText("Checked independently").length).toBe(1);
  expect(view.getByText("Unknown outcome")).toBeTruthy();
  expect(view.getByText("Evidence unavailable")).toBeTruthy();
  expect(view.getByText(/never issue the effect again/)).toBeTruthy();
  expect(view.queryByText("Login output, first try")).toBeNull();

  // Older versions open on request and read as older.
  fireEvent.click(view.getByRole("button", { name: "Earlier versions (1)" }));
  const older = (await view.findByText("Login output, first try")).closest("li")!;
  expect(within(older).getByText("Older version")).toBeTruthy();

  // Evidence opens its exact identity, or says it is unavailable.
  fireEvent.click(view.getByRole("button", { name: "Open login v2" }));
  await waitFor(() => expect(app.openedTargets).toEqual([{ kind: "path", path: "/p/output.txt", line: null }]));
  expect(app.calls.filter((call) => call.method === "deliverable.resolve").at(-1)?.params).toEqual({ project: "/p", id: "output-r-login" });
  fireEvent.click(view.getByRole("button", { name: "Open notes v1" }));
  expect((await view.findByRole("alert")).textContent).toContain("retained revision is missing");
  expect(app.openedTargets.length).toBe(1);
  expect(wrote(app)).toEqual([]);

  // The first Resume gets no answer; the retry reconciles first and keeps the request.
  const resume = view.getByRole("button", { name: "Resume unfinished work" });
  resume.focus();
  fireEvent.click(resume);
  await waitFor(() => expect(view.getByRole("button", { name: "Try resuming again" })).toBeTruthy());
  expect(view.getByText(/may have reached the Daemon/)).toBeTruthy();
  expect(document.activeElement).toBe(view.getByRole("button", { name: "Try resuming again" }));
  const reads = app.calls.filter((call) => call.method === "message.reconcileWork").length;
  fireEvent.click(view.getByRole("button", { name: "Try resuming again" }));
  await waitFor(() => expect(view.getByText("Resumed: the Agent has the unfinished work.")).toBeTruthy());
  expect(app.calls.filter((call) => call.method === "message.reconcileWork").length).toBeGreaterThan(reads);

  const sent = paramsOf<{ project: string; id: string; request: string; action: string }>(app, "message.resumeWork");
  expect(sent.length).toBe(2);
  expect(sent[1]).toEqual(sent[0]);
  expect(sent[0]).toMatchObject({ project: "/p", id: "a", action: "action-login" });
  // The accepted action has its decision: the Resume leaves and focus moves to the status line.
  await waitFor(() => expect(view.queryByRole("button", { name: "Resume unfinished work" })).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(view.getByRole("status")));
});

it("u3078i_a_reconciled_acceptance_is_not_resumed_again", async () => {
  let accepted = false;

  const { app, section } = await openWork((fake) => {
    fake.handlers["message.resumeWork"] = () => { accepted = true; throw new RpcError(INTERNAL_CODE, "lost after commit"); };

    fake.handlers["message.reconcileWork"] = () => accepted ? { ...seeded.plan, actions: [{ ...seeded.action, decision: "d1" }] } : seeded.plan;
  });

  const view = within(section);
  fireEvent.click(view.getByRole("button", { name: "Resume unfinished work" }));
  // The unknown reply reads the Daemon again and finds the decision; nothing is sent twice.
  await waitFor(() => expect(view.queryByRole("button", { name: /Resume|resuming/ })).toBeNull());
  expect(app.calls.filter((call) => call.method === "message.resumeWork").length).toBe(1);
});

it("u3078i_navigation_preserves_input_and_original_identity", async () => {
  const slow = gate<ResumeWork>();

  const { app, drafts, section } = await openWork((fake) => {
    // SAFETY: the fake Daemon awaits whatever a handler returns, so a pending promise is a held reply.
    fake.handlers["message.resumeWork"] = () => slow.promise as never;
  });

  // An edit of the Order is unsent input; Resume neither sends nor discards it.
  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  fireEvent.input(document.querySelector<HTMLTextAreaElement>("textarea[name=ask]")!, { target: { value: "Fix login and logout" } });
  expect(drafts("/p").list().map((draft) => draft.value["ask"])).toEqual(["Fix login and logout"]);
  fireEvent.click(within(section).getByRole("button", { name: "Resume unfinished work" }));

  // The user moves to beta while the answer is pending; the request keeps Agent a.
  select("beta");
  slow.resolve({ decision: { id: "d1", request: "r", actions: ["action-login"], message: 7 }, reconciliation: seeded.plan });
  await waitFor(() => expect(app.calls.some((call) => call.method === "message.resumeWork")).toBe(true));
  select("alpha");

  expect(paramsOf<{ id: string }>(app, "message.resumeWork").map((params) => params.id)).toEqual(["a"]);
  expect(wrote(app).map((call) => call.method)).toEqual(["message.resumeWork"]);
  expect(drafts("/p").list().map((draft) => [draft.value["ask"], draft.status])).toEqual([["Fix login and logout", "draft"]]);
});

it.each(["dismiss", "same report recovery", "unrelated report recovery", "report removal", "read failure"] as const)("p3557c_failure_lifetime_work_progress: %s", async transition => {
  let progress = seeded.progress;
  let unavailable = true;
  let unreadable = false;

  const { app, drafts, section } = await openWork(fake => {
    fake.handlers["message.progress"] = () => {
      if (unreadable) throw new RpcError(-32003, "Progress read failed; retry");

      return progress;
    };

    fake.handlers["deliverable.resolve"] = ({ id }) => {
      if (unavailable && id === "output-r-login") throw new RpcError(-32003, "Cannot open login; retry");

      if (unavailable && id === "output-r-deploy") throw new RpcError(-32003, "Cannot open deployment; retry");

      return { kind: "retained", path: "/p/output.txt", sha256: "0" };
    };
  });

  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const exact = "  Unfinished\n草稿 📝  ";
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: exact } });
  const before = drafts("/p").list();
  const view = within(section);
  fireEvent.click(view.getByRole("button", { name: "Open login v2" }));
  await view.findByText("Cannot open login; retry");
  fireEvent.click(view.getByRole("button", { name: "Open deployment v1" }));
  await view.findByText("Cannot open deployment; retry");
  const row = (report: string) => section.querySelector<HTMLElement>(`[data-report="${report}"]`);
  expect(within(row("r-login")!).getByText("Cannot open login; retry")).toBeTruthy();
  expect(within(row("r-deploy")!).getByText("Cannot open deployment; retry")).toBeTruthy();

  if (transition === "dismiss") fireEvent.click(within(section.querySelector<HTMLElement>('[data-report="r-login"]')!).getByRole("button", { name: "Clear error" }));

  if (transition.includes("recovery")) {
    unavailable = false;
    fireEvent.click(view.getByRole("button", { name: transition === "same report recovery" ? "Open login v2" : "Open deployment v1" }));
    await waitFor(() => expect(app.openedTargets).toHaveLength(1));
  }

  if (transition === "report removal" || transition === "read failure") {
    unreadable = transition === "read failure";
    progress = { ...progress, results: progress.results.filter(result => result.report.report !== "r-login") };
    app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });

    if (unreadable) await screen.findByText(/Progress read failed; retry/);
    else await waitFor(() => expect(section.querySelector('[data-report="r-login"]')).toBeNull());
  }

  const login = row("r-login");
  expect(login !== null && within(login).queryByText("Cannot open login; retry") !== null).toBe(transition === "unrelated report recovery" || transition === "read failure");
  expect(within(row("r-deploy")!).queryByText("Cannot open deployment; retry") !== null).toBe(transition !== "unrelated report recovery");
  expect(within(row("r-deploy")!).queryByText("Cannot open login; retry")).toBeNull();
  expect(drafts("/p").list()).toEqual(before);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe(exact);
});

it.each(["dismiss", "acknowledge"] as const)("p3557c_failure_lifetime_work_progress_resume: %s", async transition => {
  const { app, section } = await openWork(fake => {
    fake.handlers["message.resumeWork"] = () => { throw new RpcError(-32003, "Agent stopped; start it again"); };
  });

  const view = within(section);
  fireEvent.click(view.getByRole("button", { name: "Resume unfinished work" }));
  await view.findByText(/Agent stopped; start it again/);

  if (transition === "dismiss") fireEvent.click(view.getByRole("button", { name: "Clear error" }));
  else {
    const reply = gate<ResumeWork>();
    app.handlers["message.resumeWork"] = () => reply.promise;
    fireEvent.click(view.getByRole("button", { name: "Try resuming again" }));
    expect(view.getByText(/Agent stopped; start it again/)).toBeTruthy();
    reply.resolve({ decision: { id: "d1", request: "r", actions: ["action-login"], message: 7 }, reconciliation: seeded.plan });
    await view.findByText("Resumed: the Agent has the unfinished work.");
  }

  expect(view.queryByText(/Agent stopped; start it again/)).toBeNull();
});

it.each(["dismiss", "recover", "unrelated removal"] as const)("p3557c_failure_lifetime_work_progress_read: %s", async transition => {
  let unreadable = false;

  const { app, drafts } = await openWork(fake => {
    fake.handlers["message.progress"] = () => {
      if (unreadable) throw new RpcError(-32003, "Progress read failed; retry");

      return seeded.progress;
    };
  });

  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const exact = "  still editing\n草稿  ";
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: exact } });
  const before = drafts("/p").list();
  unreadable = true;
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
  await screen.findByText(/Progress read failed; retry/);

  if (transition === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Clear error" }));

  if (transition === "recover") {
    unreadable = false;
    fireEvent.click(screen.getByRole("button", { name: "Read again" }));
    await waitFor(() => expect(screen.queryByText(/Progress read failed; retry/)).toBeNull());
  }

  if (transition === "unrelated removal") {
    app.handlers["rail.tree"] = () => [agent("a", "working", "editing", { name: "alpha", work: { kind: "work", ask: "Fix login", done: "Login passes", limits: [] } }), door("r", "working", "editing", { name: "harbor" })];
    app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "rail.changed" });
    await waitFor(() => expect(document.querySelector('.rail-row[data-id="b"]')).toBeNull());
  }

  expect(screen.queryByText(/Progress read failed; retry/) !== null).toBe(transition === "unrelated removal");
  expect(drafts("/p").list()).toEqual(before);
  expect(screen.getByLabelText<HTMLTextAreaElement>("Ask").value).toBe(exact);
});

it("p3557c_failure_lifetime_work_progress_navigation", async () => {
  const { drafts, section } = await openWork(fake => {
    fake.handlers["deliverable.resolve"] = () => { throw new RpcError(-32003, "Cannot open alpha; retry"); };
  });

  fireEvent.click(screen.getByRole("button", { name: "Edit order" }));
  const exact = "  alpha only\n草稿  ";
  fireEvent.input(screen.getByLabelText("Ask"), { target: { value: exact } });
  const before = drafts("/p").list();
  fireEvent.click(within(section).getByRole("button", { name: "Open login v2" }));
  await screen.findByText("Cannot open alpha; retry");
  select("beta");
  fireEvent.click(await screen.findByRole("button", { name: "Order of beta" }));
  await screen.findByLabelText("Full order of beta");
  expect(screen.queryByText("Cannot open alpha; retry")).toBeNull();
  expect(drafts("/p").list()).toEqual(before);
  expect(before.map(draft => [draft.destination, draft.value["ask"]])).toEqual([[{ surface: "orders", object: "a", recipient: "a" }, exact]]);
});


it.each(["dismiss", "unrelated removal"] as const)("p3557c_failure_lifetime_work_progress_without_rail_fact: %s", async transition => {
  const app = createFakeApp();
  let nodes = [agent("other", "working", "editing")];
  app.handlers["rail.tree"] = () => nodes;
  app.handlers["message.progress"] = () => { throw new RpcError(-32003, "History could not be read; retry"); };

  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  const draft = connected.drafts.edit({ surface: "orders", object: "other", recipient: "other" }, { ask: "  retained 草稿\n" }, null, "ordinary").draft;
  render(() => <ConnectedProjectContext.Provider value={connected}><WorkProgress id="historical" /></ConnectedProjectContext.Provider>);
  await screen.findByRole("alert");

  if (transition === "dismiss") fireEvent.click(screen.getByRole("button", { name: "Clear error" }));
  else {
    nodes = [];
    await connected.rail.refresh();
  }

  expect(screen.queryByRole("alert") !== null).toBe(transition === "unrelated removal");
  expect(connected.drafts.list()).toEqual([draft]);
});
