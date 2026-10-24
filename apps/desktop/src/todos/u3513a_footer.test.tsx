import { cleanup, fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { App } from "../App";
import { rowOf } from "../rail/railFixture";
import { createFakeApp } from "../testing/fakeApp";
import { agent, door } from "../testing/nodes";
import { showShelfTab } from "../testing/shelfTabs";
import { todo } from "./testHarness";

afterEach(cleanup);

it("u3513a_todo_footer_four_entries_and_help", async () => {
  const app = createFakeApp();

  app.opened.project = { name: "p", path: "/p" };
  app.handlers["rail.tree"] = () => [door("w", "idle", "idle", { name: "lead" }), agent("a", "idle", "x", { parent: "w" })];
  app.handlers["todo.list"] = () => [todo(1), todo(2)];
  render(() => <App app={app} reducedMotion={() => true} clock={() => 0} />);
  await waitFor(() => rowOf("a"));
  showShelfTab("Todos");

  const first = await waitFor(() => {
    const row = document.querySelector<HTMLButtonElement>('[data-todo="1"] .todo-row-button');

    expect(row).not.toBeNull();

    return row!;
  });

  first.focus();
  fireEvent.keyDown(first, { key: "t", code: "KeyT" });
  await waitFor(() => expect(document.querySelector(".triage-hints")).not.toBeNull());
  const entries = () => [...document.querySelectorAll(".triage-hints .triage-hint")].map(hint => hint.textContent!.replace(/\s+/g, " ").trim().toLowerCase());

  expect(entries()).toEqual(["j k move", "a assign", "x done", "? more"]);
  expect(document.querySelector(".triage-hints .key-chip")).toBeNull();

  fireEvent.keyDown(first, { key: "?", code: "Slash", shiftKey: true });

  const help = await waitFor(() => {
    const panel = document.querySelector<HTMLElement>(".help");

    expect(panel).not.toBeNull();

    return panel!;
  });

  for (const what of ["Workstream", "Nest", "Un-nest", "Comment", "Leave"]) expect(help.textContent).toContain(what);
});
