import { afterAll, beforeAll, expect, it } from "vitest";
import { openLane, type LaneBrowser } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

let lane: LaneBrowser;

beforeAll(async () => {
  if (captureDir("U7208a")) lane = await openLane(1512, "dark", "u7208");
}, 60_000);

afterAll(async () => {
  await lane?.close();
}, 60_000);

/** U7208a: both versions ready, then a failed install, on the rendered Updates page. */
it.skipIf(!captureDir("U7208a"))(
  "u7208a_rendered_updates_page",
  async () => {
    await lane.seedTodos(["one", "two", "three"], true, "tree-40");
    await lane.browser("set", "media", "dark");
    await lane.evaluate(
      "(() => { window.__fake.app.emitUpdates({ roundup: { version: '0.4.0', ready: '0.5.0' }, core: { version: '0.1.21', ready: '0.1.22' } }); window.dispatchEvent(new CustomEvent('open-app-settings', { detail: 'updates' })); return true; })()",
    );
    await lane.until(
      "document.querySelectorAll('.settings-update').length === 2",
    );
    await lane.capture("U7208a", "ready");

    await lane.evaluate(
      "(() => { window.__fake.app.updateInstallFailure = new Error('replaced: the offered build was replaced and the feed offers no newer one'); return true; })()",
    );
    await lane.browser("click", ".settings-update .settings-update-button");
    await lane.until(
      "document.body.textContent.includes('That build was replaced')",
    );
    expect(
      await lane.evaluate(
        "document.querySelectorAll('.settings-update .settings-update-button').length",
      ),
    ).toBe(2);
    await lane.capture("U7208a", "failure");
  },
  60_000,
);