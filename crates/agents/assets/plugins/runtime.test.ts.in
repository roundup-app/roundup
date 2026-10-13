import { test, expect } from "claude-code/testing";
import { update } from "claude-code";
import { register as hope } from "../hope/hooks/slop.tsx";
import { register as hunch } from "../hunch/hooks/tend.tsx";

test("Q11 runtime hook closure", () => {
  expect(update).toBeDefined();
  const hopeEvents: string[] = [];
  const hunchEvents: string[] = [];
  hope((event: string) => { hopeEvents.push(event); });
  hunch((event: string) => { hunchEvents.push(event); });
  expect(hopeEvents).toContain("turn.complete");
  expect(hopeEvents).toContain("prompt.submit");
  expect(hopeEvents).toContain("ui.render");
  expect(hunchEvents).toContain("session.start");
  expect(hunchEvents).toContain("tool.call");
  expect(hunchEvents).toContain("ui.render");
});
