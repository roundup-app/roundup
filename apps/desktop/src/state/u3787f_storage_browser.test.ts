import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("u3787f_failed_migration_keeps_recovery_rendered_retry", async () => {
  const lane = await openLane(1512, "dark", "u3787f-retention");

  try {
    const origin = await lane.evaluate<string>("location.origin");

    for (const seed of ["tree-40", "tabs-8", "conflict"]) {
      await lane.browser("open", `${origin}/harness.html?seed=${seed}&todos=worst`);
      await lane.until("!!document.querySelector('[role=tree]')");
      await lane.evaluate("window.dispatchEvent(new Event('open-app-settings'))");
      await lane.until("!!document.querySelector('.settings-font input')");
      await lane.capture("U3787f", `head-${seed}-before`);
      await lane.evaluate(`(async () => {
        const original = Storage.prototype.setItem;
        window.__restoreStorage = () => { Storage.prototype.setItem = original; };
        window.__failureCause = "write work.json: disk quota exceeded at /original/調査/résumé — committed records remain available; retry after freeing space";
        Storage.prototype.setItem = function(key, value) {
          if (key === 'roundup:app-settings') throw new Error(window.__failureCause);
          return original.call(this, key, value);
        };
        const settings = await import('/src/settings/preferences.ts');
        await settings.saveAppSettings({ fontFamily: 'Original font 雪' });
      })()`);
      await lane.until("!!document.querySelector('.storage-failure [data-button]')");
      expect(await lane.evaluate<boolean>("document.querySelector('.storage-failure p').textContent.includes(window.__failureCause)")).toBe(true);
      await lane.capture("U3787f", `head-${seed}-retention-failure`);
      await lane.evaluate("window.__restoreStorage()");
      await lane.browser("click", ".storage-failure button");
      await lane.until("!document.querySelector('.storage-failure')");
      expect(await lane.evaluate("document.querySelector('.settings-font input').value")).toBe("Original font 雪");
      await lane.capture("U3787f", `head-${seed}-retained`);
    }
  } finally { await lane.close(); }
}, 180_000);
