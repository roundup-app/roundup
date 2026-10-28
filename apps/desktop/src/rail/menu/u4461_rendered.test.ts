import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { captureDir } from "../../testing/captures";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { openLane, type LaneBrowser } from "../../todos/laneBrowser";

vi.setConfig({ testTimeout: 60_000 });

let lane: LaneBrowser;

beforeAll(async () => { lane = await openLane(1512, "dark", "u4461"); }, 180_000);

afterAll(async () => { await lane?.close(); });

it("u4461_removal_failure_keeps_the_captured_workstream_in_the_rendered_app", async () => {
  await lane.until("!!document.querySelector('.rail-row[data-id=backend]')");
  await lane.capture("U4461", "before");
  const dir = captureDir("U4461");

  if (dir) {
    const url = await lane.evaluate<string>("location.href");
    await lane.browser("record", "start", "/tmp/u4461.webm");
    await lane.browser("set", "media", "dark");
    await lane.browser("open", url);
    await lane.until("!!document.querySelector('.rail-row[data-id=backend]')");
  }

  await lane.browser("click", '.rail-row[data-id="backend"]');
  await lane.browser("press", "Meta+Backspace");
  await lane.until("window.__question.shown !== null");
  await lane.capture("U4461", "question-request");
  await lane.evaluate(`(() => {
    window.__fake.app.handlers['rail.remove'] = () => { throw new Error('Stop failed. Retry Remove.'); };
    window.__question.answer('all');
    return true;
  })()`);
  await lane.until("document.body.textContent.includes('Stop failed. Retry Remove.')");
  expect(await lane.calls("rail.remove")).toEqual([{ method: "rail.remove", params: { id: "backend", scope: "all" } }]);
  await lane.capture("U4461", "failure");
  await lane.browser("set", "viewport", "1512", "800");
  await lane.capture("U4461", "failure-800");

  if (dir) {
    await lane.browser("record", "stop");
    copyFileSync("/tmp/u4461.webm", join(dir, "removal.webm"));
  }
});
