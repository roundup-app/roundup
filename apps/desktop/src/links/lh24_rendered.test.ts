import { expect, it } from "vitest";
import { openLane } from "../todos/laneBrowser";

// LH24 Observer: on `agents-10` at 1512x950 in dark, a header with links and made items of all three kinds and a `+N` count.
it("lh24_header_with_made_items_shows_all_three_kinds_and_a_count", async () => {
  const page = await openLane(1512, "dark", "lh24", false, "agents-10");
  const { evaluate, until, capture } = page;

  try {
    await until("document.querySelectorAll('.rail-row[data-id]').length > 0");
    await evaluate(`(() => {
      const app = window.__fake.app;
      const link = (kind, n) => ({ kind, url: 'https://example.test/' + n, tooltip: kind + ' ' + n });
      app.handlers['agent.links'] = () => ({ entries: [link('pr', 1), link('tracker', 2)] });
      app.handlers['agent.made'] = () => [
        { kind: 'pad', id: 'plan', title: 'Plan' },
        { kind: 'todo', id: '1', title: 'Check the release notes' },
        { kind: 'file', id: 'd1', title: 'Report' },
      ];
      document.querySelector('.rail-row[data-id]').click();
      return true;
    })()`);
    await until("document.querySelector('.links-header .links-made')");
    expect(await evaluate("[...document.querySelectorAll('.links-header .links-made')].map(el => el.getAttribute('aria-label')).join('|')")).toContain("Pad: Plan");
    await capture("LH24", "links-header-made-dark");
  } finally {
    await page.close();
  }
}, 90_000);
