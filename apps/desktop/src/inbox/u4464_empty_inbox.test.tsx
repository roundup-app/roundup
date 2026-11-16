import { cleanup, render, screen } from "@solidjs/testing-library";
import { flush } from "solid-js";
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
  render(() => <ConnectedProjectContext value={connected}><Inbox /></ConnectedProjectContext>);
  flush();
  expect(document.querySelector(".overview-quiet")).toBeNull();
  answer.resolve([]);
  await screen.findByText("Nothing needs you");
});
