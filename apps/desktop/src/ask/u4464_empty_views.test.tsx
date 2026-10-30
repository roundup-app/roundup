import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { copy } from "../copy";
import type { Reaction } from "@contracts/reaction/Reaction";
import { AskBar } from "./AskBar";

afterEach(cleanup);

it.each([
  { view: "made", method: "deliverable.list", title: copy.deliverablesEmpty, heading: copy.deliverables },
  { view: "reactions", method: "reaction.list", title: copy.reactionsEmpty, heading: copy.reactions },
] as const)("u4464_no_empty_view_before_the_first_answer: $view", async ({ view, method, title, heading }) => {
  const app = createFakeApp();
  const answer = Promise.withResolvers<[]>();
  app.handlers[method] = () => answer.promise;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  connected.showView(view);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  await screen.findByRole("heading", { name: heading });
  expect(app.calls.filter(call => call.method === method)).toHaveLength(1);
  expect(screen.queryByRole("group", { name: title })).toBeNull();
  answer.resolve([]);
  const empty = await screen.findByText(title);
  expect(screen.getAllByText(title)).toHaveLength(1);
  expect(within(empty).queryByRole("button")).toBeNull();
});

const views = [
  { view: "reactions", method: "reaction.list", title: copy.reactionsEmpty, heading: copy.reactions, item: "Ship it" },
] as const;

it.each(views)("u4607_a_populated_first_reply_shows_items_instead_of_an_empty_view: $view", async ({ view, method, title, heading, item }) => {
  const app = createFakeApp();
  const reactions = Promise.withResolvers<Reaction[]>();

  app.handlers["reaction.list"] = () => reactions.promise;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);

  connected.showView(view);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  await screen.findByRole("heading", { name: heading });
  expect(app.calls.filter(call => call.method === method)).toHaveLength(1);

  reactions.resolve([{
    project: "p", reason: null, id: "r1", name: "Ship it", actor: { kind: "user", id: "u", parent: null }, home: null, target: "a",
    instruction: "go", condition: { kind: "agents", ids: ["a"], any: false }, max_firings: 1, remaining: 1, rearm: false,
    expires_at: "2026-10-21T09:00:00Z", created_at: "2026-10-20T09:00:00Z", state: "active",
    observation: { health: "observing", health_code: "observing", cause_code: "unknown", gap_code: "unknown", recovery_code: "unknown", cursor: null, gap: null, recovery: null, evidence: null }, firings: [],
  }]);
  const surface = await screen.findByRole("region", { name: heading });

  expect(await within(surface).findByText(item)).not.toBeNull();
  expect(within(surface).queryByRole("group", { name: title })).toBeNull();
});

it.each(views)("u4607_a_failed_first_reply_shows_the_failure_instead_of_an_empty_view: $view", async ({ view, method, title, heading }) => {
  const app = createFakeApp();
  const answer = Promise.withResolvers<[]>();
  const message = `Cannot read ${heading}: connection lost`;

  app.handlers[method] = () => answer.promise;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);

  connected.showView(view);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  await screen.findByRole("heading", { name: heading });
  expect(app.calls.filter(call => call.method === method)).toHaveLength(1);
  answer.reject(new Error(message));
  expect(await screen.findByRole("alert", { name: message })).not.toBeNull();
  expect(screen.queryByRole("group", { name: title })).toBeNull();
});
