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

it("r24_reports_collection_loss_when_changes_outrun_the_bounded_transport", async () => {
  const records: { cause: string }[] = [];
  const evidence = createIdleEvidence(document, window, () => 0, async record => { records.push(record); });

  for (let index = 0; index < 300; index += 1) evidence.selected("/fixture", `terminal-${index}`);
  await expect(evidence.flush()).rejects.toThrow("queue overflow");
  expect(records.at(-1)?.cause).toBe("collection-lost");
  evidence.stop();
});

it("r24_missing_native_transport_never_becomes_successful_evidence", async () => {
  const evidence = createIdleEvidence(document, window, () => 0, async () => { throw new Error("native producer unavailable"); });

  await expect(evidence.flush()).rejects.toThrow("native producer unavailable");
  evidence.stop();
});

it("r24_records_teardown_as_collection_loss", async () => {
  const records: { cause: string }[] = [];
  const evidence = createIdleEvidence(document, window, () => 0, async record => { records.push(record); });

  window.dispatchEvent(new Event("pagehide"));
  await evidence.flush();
  expect(records.at(-1)?.cause).toBe("collection-lost");
  evidence.stop();
});

it("r24_renderer_evidence_belongs_to_the_selected_terminal_and_reports_fallback", async () => {
  const records: { terminal: string | null; renderer: string | null }[] = [];
  const evidence = createIdleEvidence(document, window, () => 0, async record => { records.push(record); });

  evidence.selected("/fixture", "a");
  evidence.renderer(true, "a");
  evidence.selected("/fixture", "b");
  evidence.renderer(false, "b");
  evidence.selected("/fixture", "a");
  evidence.renderer(false, "a");
  await evidence.flush();
  expect(records.slice(1)).toEqual([
    expect.objectContaining({ terminal: "a", renderer: null }),
    expect.objectContaining({ terminal: "a", renderer: "webgl" }),
    expect.objectContaining({ terminal: "b", renderer: null }),
    expect.objectContaining({ terminal: "b", renderer: "dom" }),
    expect.objectContaining({ terminal: "a", renderer: "webgl" }),
    expect.objectContaining({ terminal: "a", renderer: "dom" }),
  ]);
  expect(evidence.checkpoint()).toEqual({ seq: 7, pending: 0, error: null });
  evidence.stop();
});

it("r24_checkpoint_exposes_delivery_still_pending_and_failed_acknowledgements", async () => {
  let refuse: (error: Error) => void = () => {};

  const evidence = createIdleEvidence(document, window, () => 0, () => new Promise<void>((_resolve, reject) => { refuse = reject; }));

  expect(evidence.checkpoint()).toEqual({ seq: 1, pending: 1, error: null });
  // The producer chains sends on a microtask so event snapshots precede asynchronous IPC.
  await Promise.resolve();
  refuse(new Error("ack lost"));
  await expect(evidence.flush()).rejects.toThrow("ack lost");
  expect(evidence.checkpoint()).toEqual({ seq: 1, pending: 0, error: "Error: ack lost" });
  evidence.stop();
});

it("r24_focus_and_resize_events_carry_observed_state_and_dimensions", async () => {
  const records: { focused: boolean; width: number; height: number }[] = [];
  const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  const evidence = createIdleEvidence(document, window, () => 0, async record => { records.push(record); });

  focus.mockReturnValue(false);
  window.dispatchEvent(new Event("blur"));
  vi.stubGlobal("innerWidth", 1100);
  vi.stubGlobal("innerHeight", 700);
  window.dispatchEvent(new Event("resize"));
  await evidence.flush();
  expect(records).toMatchObject([
    { focused: true },
    { focused: false },
    { focused: false, width: 1100, height: 700 },
  ]);
  evidence.stop();
  focus.mockRestore();
  vi.unstubAllGlobals();
});
