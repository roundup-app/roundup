import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { node, workstream } from "../testing/nodes";
import { mountRail, rowOf, rowNames, settled } from "./railFixture";

const tree = () => [
  node("root", { order: 0 }),
  workstream("mode", { opening_prompt: " \nDo work\n ", order: 1 }),
  node("mode-child", { parent: "mode" }),
  workstream("plain", { opening_prompt: " \n ", order: 2 }),
  node("plain-child", { parent: "plain" }),
  workstream("plain-second", { order: 3 }),
];
const heads = () => [...document.querySelectorAll<HTMLButtonElement>(".section-head")];
afterEach(() => { cleanup(); localStorage.clear(); });

it("u4547a_sections_partition_the_tree", async () => {
  await mountRail(tree());
  expect(rowNames()).toEqual(["plain", "plain-child", "plain-second", "mode", "mode-child", "root"]);
  const sections = heads().map(head => head.closest('[data-scope=collapsible]')!);
  expect(sections.map(section => within(section as HTMLElement).getAllByRole("treeitem").map(row => row.getAttribute("data-id"))))
    .toEqual([["plain", "plain-child", "plain-second"], ["mode", "mode-child"], ["root"]]);
});
