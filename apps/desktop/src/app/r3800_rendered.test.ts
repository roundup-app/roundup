import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

it("r3800_enter_loading_populated_and_failure", async () => {
  const page = await openLane(1512, "dark", "r3800");
  const { browser, evaluate, until, capture } = page;
  try {
    await until("document.querySelectorAll('.rail-row').length > 10");
    await capture("R3800", "populated-dense");
    await browser("open", await evaluate<string>("location.origin + '/harness.html?seed=first-run'"));
    await until("!!window.__fake && !!document.querySelector('.word')");
    await evaluate(`(() => {
      const app = window.__fake.app;
      app.chooser.path = '/Users/you/harness';
      const ping = app.handlers['daemon.ping'];
      app.handlers['daemon.ping'] = () => new Promise(resolve => { window.releaseStartup = () => resolve(ping()); });
      return true;
    })()`);
    await browser("find", "role", "button", "click", "--name", "Choose folder…", "--exact");
    await until("!!window.releaseStartup && document.querySelectorAll('[role=status]').length >= 2");
    expect(await evaluate("document.querySelectorAll('.rail-row').length")).toBe(0);
    await capture("R3800", "loading");
    await evaluate("window.releaseStartup(); true");
    await until("!!document.querySelector('.ask-input')");
    await capture("R3800", "populated-empty");
    await evaluate("window.__fake.app.exitDaemon({code:1,cause:'Cannot start Daemon. Reopen the Project.'}); true");
    await until("!!document.querySelector('[role=alert]')");
    await capture("R3800", "failure");
  } finally { await page.close(); }
}, 60_000);
