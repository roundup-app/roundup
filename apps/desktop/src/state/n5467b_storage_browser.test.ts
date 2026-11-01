import { mkdirSync } from "node:fs";
import { captureDir } from "../testing/captures";
import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("n5467b_old_browser_storage_is_refused_before_editors_mount", async () => {
  const lane = await openLane(1512, "dark", "n5467b-refusal");

  const capture = captureDir("N5467b");

  try {
    if (capture) {
      mkdirSync(capture, { recursive: true });
      await lane.browser("record", "start", `${capture}/refusal-and-manual-reset.webm`);
    }

    await lane.browser("set", "media", "dark");
    await lane.until("!!window.__fake");
    const origin = await lane.evaluate<string>("location.origin");
    await lane.capture("N5467b", "base-tree-40");
    await lane.evaluate("localStorage.clear(); localStorage.setItem('roundup:obsolete', '{unreadable')");
    await lane.browser("open", `${origin}/harness.html?seed=tree-40&todos=worst&storage-recovery=1`);
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('incompatible')");
    expect(await lane.evaluate("!!document.querySelector('.ask-input, [role=tree]')")).toBe(false);
    expect(await lane.calls("agent.spawn")).toEqual([]);
    await lane.capture("N5467b", "head-refused");
    await lane.browser("click", ".storage-gate button");
    await lane.until("document.querySelector('[role=alert]')?.textContent.includes('incompatible')");
    expect(await lane.evaluate("localStorage.getItem('roundup:obsolete')")).toBe("{unreadable");
    await lane.evaluate("localStorage.removeItem('roundup:obsolete')");
    await lane.browser("click", ".storage-gate button");
    await lane.until("!!document.querySelector('[role=tree]')");
    await lane.capture("N5467b", "head-fresh");
  } finally {
    try { if (capture) await lane.browser("record", "stop"); } finally { await lane.close(); }
  }
}, 120_000);
