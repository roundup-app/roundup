import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { copy } from "../copy";
import { AskBar } from "./AskBar";

afterEach(cleanup);

it.each([
  { view: "ask-history", method: "ask.list", title: copy.askHistoryEmpty },
  { view: "made", method: "deliverable.list", title: copy.deliverablesEmpty },
  { view: "reactions", method: "reaction.list", title: copy.reactionsEmpty },
] as const)("u4464_no_empty_view_before_the_first_answer: $view", async ({ view, method, title }) => {
  const app = createFakeApp();
  const answer = Promise.withResolvers<[]>();
  app.handlers[method] = () => answer.promise;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  connected.showView(view);
  render(() => <ConnectedProjectContext.Provider value={connected}><AskBar /></ConnectedProjectContext.Provider>);
  expect(screen.queryByRole("group", { name: title })).toBeNull();
  answer.resolve([]);
  const empty = await screen.findByRole("group", { name: title });
  expect(within(empty).queryByRole("button")).toBeNull();
});
