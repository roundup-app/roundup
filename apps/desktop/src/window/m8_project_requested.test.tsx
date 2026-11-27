import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requested } from "@contracts/project/Requested";
import { createProjectDrafts } from "../state/connectedProject";
import { RequestedApp as App } from "../testing/requestedApp";
import { createFakeApp } from "../testing/fakeApp";
import type { FakeApp } from "../testing/fakeApp";

const FIRST = { name: "payments-api", path: "/Users/me/repos/payments-api" };

const request = (app: FakeApp, data: Requested) => {
  app.emit({ actor: { kind: "user", id: "you", parent: null }, name: "project.requested", data });
};

const started = async () => {
  const app = createFakeApp();

  app.opened.project = FIRST;

  render(() => <App app={app} reducedMotion={() => false} clock={() => 0} />);
  await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: FIRST.name });
  await screen.findByLabelText("Create", { selector: "button" });

  return app;
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

describe("m8 an Agent opens and renames Projects", () => {
  it("m8_a_requested_rename_calls_rename_project", async () => {
    const app = await started();

    request(app, { kind: "rename", path: FIRST.path, name: "billing" });

    await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: "billing" });
  });
});


const mount = (drafts: ReturnType<typeof createProjectDrafts>) => {
  const app = createFakeApp();

  app.opened.project = FIRST;
  render(() => <App app={app} drafts={drafts} reducedMotion={() => true} clock={() => 0} />);

  return app;
};

const owners = {
  pad: async () => {
    fireEvent.click(await screen.findByRole("tab", { name: "Pads" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Pad" }));

    return screen.findByLabelText<HTMLInputElement>("Pad name");
  },
  todo: async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Add Todo: Overview" }));

    return screen.findByLabelText<HTMLInputElement>("New Todo title");
  },
  name: async () => {
    fireEvent.dblClick(document.querySelector(".tab-name")!);

    return screen.findByLabelText<HTMLInputElement>("Project name");
  },
};

it.each(Object.entries(owners))("u3021d_acknowledged_typing_has_no_outside_mutations_%s", async (_owner, openField) => {
  mount(createProjectDrafts());
  await within(await screen.findByLabelText("Projects", { selector: '[role="tablist"]' })).findByRole("tab", { name: FIRST.name });
  await screen.findByLabelText("Create", { selector: "button" });
  const field = await openField();

  await new Promise((done) => setTimeout(done, 300));
  const outside: MutationRecord[] = [];
  const observer = new MutationObserver((records) => outside.push(...records.filter((record) => !field.contains(record.target) && record.target !== field)));

  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  for (let count = 1; count <= 20; count++) {
    fireEvent.input(field, { target: { value: "x".repeat(count) } });
    await new Promise((done) => setTimeout(done));
  }

  await new Promise((done) => setTimeout(done, 50));
  outside.push(...observer.takeRecords().filter((record) => !field.contains(record.target) && record.target !== field));
  observer.disconnect();
  expect(outside.map((record) => `${record.type}:${record.target.nodeName}:${record.addedNodes.length}:${record.removedNodes.length}`)).toEqual([]);
});
