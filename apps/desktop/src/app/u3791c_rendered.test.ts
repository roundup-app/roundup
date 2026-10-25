import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";
import { captureDir } from "../testing/captures";

it("u3791c_enter_intervene_review_failure_journey", async () => {
  const page = await openLane(1512, "dark", "u3791c");
  const { browser, evaluate, until, capture } = page;
  const video = captureDir("U3791c");

  try {
    if (video) {
      await mkdir(video, { recursive: true });
      await browser("record", "start", join(video, "failure-journey.webm"));
    }

    await browser("set", "media", "dark");
    await until("matchMedia('(prefers-color-scheme: dark)').matches && document.querySelectorAll('.rail-row').length > 10");
    await capture("U3791c", "enter");
    await browser("fill", ".ask-input", "  keep my work 🌿  ");
    await evaluate(`(() => {
      const app = window.__fake.app;
      window.readCount = 0;
      window.savedTree = app.handlers['rail.tree'];
      app.handlers['rail.tree'] = params => {
        if (++window.readCount === 1) throw new TypeError('Transient read failure');
        return window.savedTree(params);
      };
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await until("window.readCount === 2");
    expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(0);
    await evaluate(`(() => {
      window.readCount = 0;
      window.__fake.app.handlers['rail.tree'] = () => { window.readCount++; throw new Error('Cannot read work. Retry to read again.'); };
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await until("window.readCount === 2 && document.querySelector('[role=alert]')");
    await capture("U3791a", "read-exhausted");
    await capture("U3791c", "read-exhausted");
    await evaluate(`(() => {
      window.__fake.app.handlers['rail.tree'] = () => { throw new Error('Work is still unavailable. Retry to read again.'); };
      window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
      return true;
    })()`);
    await until("document.querySelector('[role=alert]')?.getAttribute('aria-label').startsWith('Work is still')");
    expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(1);
    await capture("U3791c", "read-replaced");
    await evaluate("window.__fake.app.handlers['rail.tree'] = window.savedTree; true");
    await browser("click", ".pane-failure button");
    await until("!document.querySelector('[role=alert]')");
    await evaluate(`(() => {
      window.savedWrite = Storage.prototype.setItem;
      window.writeCount = 0;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('roundup:drafts:')) { window.writeCount++; throw new Error('Storage unavailable'); }
        return window.savedWrite.call(this, key, value);
      };
      return true;
    })()`);
    await browser("fill", ".ask-input", "  failed save keeps this 🌿  ");
    await until("window.writeCount >= 2 && document.querySelector('[role=alert]')");
    await capture("U3791a", "write-exhausted");
    await capture("U3791c", "write-exhausted");
    await evaluate("Storage.prototype.setItem = window.savedWrite; true");
    await browser("find", "role", "button", "click", "--name", "Retry storage only");
    await until("!document.querySelector('[role=alert]')");
    expect(await evaluate("document.querySelector('.ask-input').value")).toBe("  failed save keeps this 🌿  ");
    await evaluate("window.__fake.app.exitDaemon({code:1,recovery:'waiting'}); true");
    expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(0);
    await evaluate("window.__fake.app.exitDaemon({code:1,recovery:'waiting',cause:'Cannot start Daemon'}); true");
    expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(0);
    await evaluate("window.__fake.app.exitDaemon({code:1,cause:'Cannot start Daemon. Reopen the Project.'}); true");
    await until("!!document.querySelector('[role=alert]')");
    await capture("U3791a", "daemon-exhausted");
    await capture("U3791c", "daemon-exhausted");
    await browser("find", "role", "button", "click", "--name", "Reopen", "--exact");
    await until("!document.querySelector('[role=alert]')");
    expect(await evaluate("document.querySelector('.ask-input').value")).toBe("  failed save keeps this 🌿  ");
    await browser("click", "#shelf-tab-pads");
    await evaluate("document.querySelector('.pads-tab [data-shelf-group][data-state=closed] [data-part=branch-control]')?.click(); true");
    await until("!!document.querySelector('.pad-name')");
    await browser("click", ".pad-name");
    await until("document.activeElement?.matches('.pad-name')");
    await browser("press", "Enter");
    await until("!!document.querySelector('.drawer[data-open=true][data-settling=false] [contenteditable=true]')");
    await capture("U3791c", "review-recovered");
  } finally {
    try { if (video) await browser("record", "stop"); }
    finally { await page.close(); }
  }
}, 60_000);
