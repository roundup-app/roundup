import { expect, it, vi } from "vitest";
import { createIdleEvidence } from "./idle";

it("r24_retains_transient_visibility_and_selection_changes_in_order", async () => {
  const records: unknown[] = [];
  let at = 10;
  const evidence = createIdleEvidence(document, window, () => at++, async record => { records.push(record); });

  evidence.selected("/fixture", "terminal-a");
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  evidence.selected("/fixture", "terminal-b");
  await evidence.flush();

  expect(records).toMatchObject([
    { seq: 1, at_ms: 10, cause: "initial", visibility: "visible", terminal: null },
    { seq: 2, at_ms: 11, cause: "selection", terminal: "terminal-a" },
    { seq: 3, at_ms: 12, cause: "visibility", visibility: "hidden", terminal: "terminal-a" },
    { seq: 4, at_ms: 13, cause: "visibility", visibility: "visible", terminal: "terminal-a" },
    { seq: 5, at_ms: 14, cause: "selection", terminal: "terminal-b" },
  ]);
  evidence.stop();
});
