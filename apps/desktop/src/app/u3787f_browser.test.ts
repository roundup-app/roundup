import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

it.each(["tree-40", "tabs-8", "conflict"])("u3787f_deep_link_preserves_identity_and_authority_failure_remains_actionable_%s", async seed => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");

  await browser("open", url(`/harness.html?seed=${seed}&renderer=dom`));
  await wait("!!window.__fake && document.querySelector('.window')");
  await read("window.__fake.app.handlers['link.read'] = () => { throw new Error('The linked Pad is unavailable. Open its Project and copy the link again.'); }");
  await read("window.__fake.app.nativeOpen({kind:'link', url:'roundup://pad/missing?project=unavailable'})");
  await wait("document.body.textContent.includes('The linked Pad is unavailable.')");
  expect(await read("window.__fake.app.calls.filter(call => /spawn|start|input|write/.test(call.method))")).toEqual([]);
  const dir = captureDir("U3787f");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await browser("screenshot", join(dir, `${seed}-native-link-failure.png`));
    writeFileSync(join(dir, `${seed}-native-link-failure.checks.json`), JSON.stringify(await read("window.__checks()"), null, 2));
  }
});
