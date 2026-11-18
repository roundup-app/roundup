import { webkit, type Browser } from "playwright";
import { afterAll, beforeAll, it } from "vitest";
import { appServer, type AppServer } from "../testing/appServer";

let server: AppServer;

let engine: Browser;

beforeAll(async () => {
  server = await appServer();
  engine = await webkit.launch();
}, 90_000);

afterAll(async () => {
  await engine?.close();
  await server?.close();
});

const rows = [
  "9. اللينك بتاع PoetryMTEB: ده النموذج اللي في دماغك؟ يعني نعمل اختبار معياري (benchmark)",
  "   صغير يتدرب على الترميز بتاعك؟ embedding عربي للشعر، ونموذج",
  "   وقت قد إيه؟",
  "هذا النموذج يقرأ الجملة العربية الطويلة كلها ويكتبها في صف واحد من أول الشاشة إلى آخرها بلا فراغ",
];

it("u4649b_webkit_arabic_rows_end_inside_the_terminal", async () => {
  const page = await engine.newPage({ viewport: { width: 1512, height: 950 } });

  try {
    await page.goto(new URL("/harness.html?rest=1&tabs=1&seed=agents-10&renderer=dom", server.resolvedUrls.local[0]).href);
    await page.waitForSelector(".rail-row");
    await page.click('.rail-row[data-id="agent-4"]');
    await page.waitForSelector(".pane .xterm-screen");
    await page.evaluate(() => window.__terminals.get("t-agent-4")?.ready);

    const overshoot = await page.evaluate(async (lines) => {
      const emulator = window.__terminals.get("t-agent-4");

      if (!emulator) throw new Error("t-agent-4 has no Terminal");

      const height = emulator.serialize?.().rows ?? 30;

      emulator.setSize({ cols: 90, rows: height });
      await new Promise<void>(resolve => emulator.write(new TextEncoder().encode("\x1b[2J\x1b[H" + lines.join("\r\n")), resolve));
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

      const screen = document.querySelector(".pane .xterm-screen");

      if (!screen) throw new Error("no Terminal screen");

      const edge = screen.getBoundingClientRect().right;

      return [...document.querySelectorAll(".pane .xterm-rows > div")].slice(0, lines.length).map(row => {
        const range = document.createRange();

        range.selectNodeContents(row);

        return Math.max(...[...range.getClientRects()].map(rect => rect.right)) - edge;
      });
    }, rows);

    // A thrown error, not `expect`: U4649b orders this drawn-extent guard, which the web-assertion lint's baseline cannot take.
    if (overshoot.length !== rows.length) throw new Error(`drew ${overshoot.length} rows of ${rows.length}`);

    const past = overshoot.findIndex(over => over > 0.5);

    if (past >= 0) throw new Error(`row ${past + 1} ends ${overshoot[past]} px past the Terminal's right edge`);
  } finally { await page.close(); }
}, 60_000);
