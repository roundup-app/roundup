import { cleanup, fireEvent, screen } from "@solidjs/testing-library";
import { afterEach, expect, it } from "vitest";
import { workstream } from "../testing/nodes";
import { mountRail, railCallsTo } from "./railFixture";

afterEach(() => { cleanup(); localStorage.clear(); });
const open = () => fireEvent.keyDown(document, { key: "n", metaKey: true, shiftKey: true });
const field = () => screen.getByLabelText<HTMLTextAreaElement>("Task");

it("u2773a_rail_restores_exact_work", async () => {
  const first = await mountRail([workstream("w")]);
  open();
  fireEvent.input(field(), { target: { value: " exact\ne\u0301 😀 " } });
  field().setSelectionRange(2, 5, "backward");
  fireEvent.select(field());
  fireEvent.keyDown(field(), { key: "Escape" });
  cleanup();
  const reopened = await mountRail([workstream("w")]);
  open();
  await Promise.resolve();
  expect(field().value).toBe(" exact\ne\u0301 😀 ");
  expect([field().selectionStart, field().selectionEnd, field().selectionDirection]).toEqual([2, 5, "backward"]);
  expect(railCallsTo(first.app, "agent.spawn")).toEqual([]);
  expect(railCallsTo(reopened.app, "agent.spawn")).toEqual([]);
});
