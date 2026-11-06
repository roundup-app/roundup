import { cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { agent, workstream } from "../testing/nodes";
import { mountRail, rowOf, settled } from "./railFixture";

afterEach(cleanup);

const STATE = ["aria-selected", "aria-current", "data-selected"] as const;

const stateOf = (element: Element) => STATE.filter(name => element.getAttribute(name) === "true" || name === "aria-current" && element.hasAttribute(name));

it("u6399a_a_fold_row_carries_no_selected_state", async () => {

  await mountRail([workstream("stream"), agent("helper", "idle", "idle", { parent: "stream", visibility: "internal" })]);
  await settled();
  const stream = rowOf("stream");
  fireEvent.click(stream);
  await settled();
  const fold = document.querySelector<HTMLElement>('[data-id="fold:internal:stream"] [data-part="branch-control"]')!;
  fireEvent.click(fold);
  await settled();
  expect(stateOf(stream.closest('[role="treeitem"]')!)).toContain("aria-selected");
  expect(stateOf(stream)).toContain("data-selected");
  expect(stateOf(fold.closest('[role="treeitem"]')!)).toEqual([]);
  expect(stateOf(fold)).toEqual([]);
});
