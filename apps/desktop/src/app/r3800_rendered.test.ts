import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("r3800_enter_loading_populated_and_failure", async () => {
  const page = await openLane(1512, "dark", "r3800");
  const { browser, evaluate, until, capture } = page;

  try {
    await until("document.querySelectorAll('.rail-row').length > 10");
    await capture("R3800", "populated-dense");
    await evaluate("window.__fake.app.exitDaemon({code:1,cause:'Cannot start Daemon. Reopen the Project.'}); true");
    await until("!!document.querySelector('[role=alert]')");
    expect(await evaluate("document.querySelector('[role=alert]').getAttribute('aria-label')")).toContain("Cannot start Daemon");
    await capture("R3800", "failure-dense");
    await evaluate("localStorage.clear(); true");
    await browser("open", await evaluate<string>("location.origin + '/harness.html?seed=first-run'"));
    await until("!!window.__fake && !!document.querySelector('.word')");
    await evaluate(`(() => {
      const app = window.__fake.app;
      app.chooser.path = '/Users/you/harness';
      const ping = app.handlers['daemon.ping'];
      app.handlers['daemon.ping'] = () => new Promise(resolve => { window.releaseStartup = () => resolve(ping()); });
      return true;
    })()`);
    await browser("find", "role", "button", "click", "--name", "Choose Project…", "--exact");
    await until("!!window.releaseStartup && document.querySelectorAll('[aria-busy=true][data-layout-panel]').length === 2");
    await capture("R3800", "loading");
    await evaluate("window.releaseStartup(); true");
    await until("!!document.querySelector('.ask-input') && !document.querySelector('[aria-busy=true][data-layout-panel]')");
    await capture("R3800", "populated-empty");
    await evaluate("window.__fake.app.exitDaemon({code:1,cause:'Cannot start Daemon. Reopen the Project.'}); true");
    await until("!!document.querySelector('[role=alert]')");
    await capture("R3800", "failure");
  } finally { await page.close(); }
}, 60_000);
