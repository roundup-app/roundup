import { cleanup, render, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { copy } from "./copy";
import { AskBar } from "./AskBar";

afterEach(cleanup);

it.each([
  { view: "made", method: "deliverable.list", title: copy.deliverablesEmpty, heading: copy.deliverables },
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
