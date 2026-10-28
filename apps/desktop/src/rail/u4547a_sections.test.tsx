import { cleanup, fireEvent, render, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { createFakeApp } from "../testing/fakeApp";
import { RequestedApp } from "../testing/requestedApp";
import { node, workstream, NOW } from "../testing/nodes";
import { mountRail, rowOf, rowNames, settled } from "./railFixture";

const tree = () => [
  node("root", { order: 0 }),
  workstream("mode", { opening_prompt: " \nDo work\n ", order: 1 }),
  node("mode-child", { parent: "mode" }),
  workstream("plain", { opening_prompt: " \n ", order: 2 }),
  node("plain-child", { parent: "plain" }),
  workstream("plain-second", { order: 3 }),
];

const heads = () => [...document.querySelectorAll<HTMLButtonElement>(".rail-tree .section-head")];

const heading = (at: number) => {
  const found = heads()[at];

  if (!found) throw new Error(`missing Rail heading ${at}`);

  return found;
};

afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547a_sections_partition_the_tree", async () => {
  await mountRail(tree());
  expect(rowNames()).toEqual(["plain", "plain-child", "plain-second", "mode", "mode-child", "root"]);
  const sections = heads().map(head => head.parentElement!);
  expect(sections.map(section => within(section!).getAllByRole("treeitem").map(row => row.getAttribute("data-id"))))
    .toEqual([["plain", "plain-child", "plain-second"], ["mode", "mode-child"], ["root"]]);
});

it.each([[], ["plain"], ["mode"], ["root"], ["plain", "mode"], ["plain", "root"], ["mode", "root"]].map(ids => ({ ids })))(
  "u4547a_empty_sections_disappear_without_hiding_root_agents $ids", async ({ ids }) => {
    const rows = tree().filter(row => ids.includes(row.id));
    const { rail } = await mountRail(rows);
    expect(heads()).toHaveLength(ids.length);

    if (ids.length > 0) expect(rowNames()).toHaveLength(ids.length);
    rows.splice(0);
    await rail.refresh();
    expect(heads()).toHaveLength(0);
    expect(document.querySelectorAll('[role=treeitem]')).toHaveLength(0);
    expect(document.querySelector('.empty-state')).not.toBeNull();
  },
);

it("u4547a_heading_actions_change_only_the_named_section", async () => {
  const { app, rail } = await mountRail(tree());
  rail.select("plain");
  await settled();
  app.calls.length = 0;
  const plain = heading(0);
  const mode = heading(1);
  const root = heading(2);
  plain.focus();
  fireEvent.click(plain);
  await settled();
  expect([...rail.closedSections()]).toEqual(["workstreams"]);
  expect(plain.isConnected).toBe(true);
  await waitFor(() => expect(plain.getAttribute("aria-expanded")).toBe("false"));
  expect(mode.getAttribute("aria-expanded")).toBe("true");
  expect(root.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(plain);

  for (const key of ["ArrowLeft", "ArrowLeft", "ArrowRight", "ArrowRight"]) {
    fireEvent.keyDown(plain, { key });
    await settled();
    await waitFor(() => expect(plain.getAttribute("aria-expanded")).toBe(String(key === "ArrowRight")));
    expect(document.activeElement).toBe(plain);
  }

  expect(rail.selected()).toBe("plain");
  expect(app.calls).toEqual([]);
});

it("u4547a_section_state_survives_reopen_per_project", async () => {
  const reopen = async (path: string) => {
    const app = createFakeApp();
    app.opened.project = { name: "Project", path };
    app.handlers["rail.tree"] = tree;
    render(() => <RequestedApp app={app} reducedMotion={() => true} clock={() => NOW} />);
    await waitFor(() => expect(heads()).toHaveLength(3));
  };

  await reopen("/p");
  fireEvent.click(rowOf("plain").querySelector('button[aria-label="Collapse"]')!);
  await settled();
  fireEvent.click(heading(0));
  fireEvent.click(heading(2));
  await settled();
  cleanup();
  await reopen("/other");
  expect(heads().map(head => head.getAttribute("aria-expanded"))).toEqual(["true", "true", "true"]);
  fireEvent.click(heading(1));
  await settled();
  cleanup();
  await reopen("/p");
  await waitFor(() => expect(heads().map(head => head.getAttribute("aria-expanded"))).toEqual(["false", "true", "false"]));
  fireEvent.click(heading(0));
  await settled();
  expect(rowOf("plain").closest('[role=treeitem]')?.getAttribute("aria-expanded")).toBe("false");
  expect(document.querySelector('[data-id="plain-child"]')).toBeNull();
  cleanup();
  await reopen("/other");
  expect(heads().map(head => head.getAttribute("aria-expanded"))).toEqual(["true", "false", "true"]);
});
