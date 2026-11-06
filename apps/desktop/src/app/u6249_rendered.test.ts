import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

// U6249 Observer: a rail.tree read that heals within its retries shows nothing; one that keeps failing shows one line with Retry.
for (const scheme of ["dark", "light"] as const) {
  it(`u6249_rail_read_failure_is_calm_${scheme}`, async () => {
    const page = await openLane(1512, scheme, `u6249-${scheme}`);
    const { browser, evaluate, until, capture } = page;

    try {
      await until("document.querySelectorAll('.rail-row').length > 10");
      await evaluate(`(() => {
        const app = window.__fake.app;
        window.readCount = 0;
        window.savedTree = app.handlers['rail.tree'];
        app.handlers['rail.tree'] = params => {
          if (++window.readCount <= 3) throw new TypeError('Transient read failure');
          return window.savedTree(params);
        };
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        return true;
      })()`);
      await until("window.readCount === 4");
      expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(0);

      await evaluate(`(() => {
        window.readCount = 0;
        window.__fake.app.handlers['rail.tree'] = () => { window.readCount++; throw new Error('Cannot read work. Retry to read again.'); };
        window.__fake.emit({actor:{kind:'user',id:'you',parent:null},name:'rail.changed'});
        return true;
      })()`);
      await until("window.readCount === 5 && document.querySelector('[role=alert]')");
      expect(await evaluate("document.querySelectorAll('[role=alert]').length")).toBe(1);
      await capture("U6249a", `rail-read-failed-${scheme}`);
      await evaluate("window.__fake.app.handlers['rail.tree'] = window.savedTree; true");
      await browser("click", ".pane-failure button");
      await until("!document.querySelector('[role=alert]')");
    } finally {
      await page.close();
    }
  }, 90_000);
}
