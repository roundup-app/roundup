import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { browser, evaluate, settle, openShelf } = shelfBrowser();

it("u3721_overlay_mode_has_no_maximise_button_and_m_does_nothing", async () => {
  await openShelf("tree-40", 288, 360, 800, "dark");
  expect(await evaluate("document.querySelector('.shelf-controls button[aria-label=Maximise]') === null")).toBe(true);
  await evaluate(`document.querySelector('.shelf button').focus()`);
  await browser("press", "m");
  expect(await evaluate("document.querySelector('.window').dataset.shelfMaximised")).toBe("false");
}, 60_000);

it("u3721_restore_keeps_terminal_fitting_operable", async () => {
  await openShelf("agents-10", 288, 360, 1512, "dark");
  await evaluate(`document.querySelector('.rail [data-id="agent-4"] .name').click()`);
  await browser("wait", ".xterm-screen");
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Maximise"]');
  await settle();
  await browser("click", '.shelf-controls button[aria-label="Restore"]');
  await settle();
  const before = await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length");

  await evaluate(`document.querySelector('.rail-edge').focus()`);
  await browser("press", "ArrowRight");
  await settle();
  await browser("wait", "--fn", `window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length > ${before}`);
  expect(await evaluate<number>("window.__fake.app.calls.filter(call => call.method === 'terminal.resize').length")).toBeGreaterThan(before);
}, 90_000);
