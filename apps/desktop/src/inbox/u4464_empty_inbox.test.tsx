import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { connectProject, ConnectedProjectContext } from "../state/connectedProject";
import { createFakeApp } from "../testing/fakeApp";
import { Inbox } from "./Inbox";

afterEach(cleanup);

it("u4464_no_empty_view_before_the_first_answer", async () => {
  const app = createFakeApp();
  const answer = Promise.withResolvers<[]>();
  app.handlers["todo.unread"] = () => answer.promise;
  const connected = await connectProject(app, { name: "p", path: "/p" }, () => true, () => 0);
  render(() => <ConnectedProjectContext.Provider value={connected}><Inbox /></ConnectedProjectContext.Provider>);
  expect(screen.queryByText("Nothing waits for you")).toBeNull();
  answer.resolve([]);
  await screen.findByText("Nothing waits for you");
});
