import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

it("z3742h_a_cover_prevents_a_drop_into_the_row_behind_it", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("set", "media", "dark");
  await browser("open", url("/harness.html?seed=agents-10"));
  await wait(`document.querySelectorAll('.rail-row[data-id]').length > 0`);

  const selection = `({
    selected: document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id') ?? null,
    writes: window.__fake.app.calls.filter(call => call.method === 'terminal.write').length,
  })`;

  const before = await read(selection);

  await read(`(() => {
    const row = document.querySelector('.rail-row[data-id]');
    const box = row.getBoundingClientRect();
    const cover = document.createElement('div');
    Object.assign(cover.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'var(--surface)' });
    cover.id = 'drop-cover';
    document.body.append(cover);
    window.__fake.app.dropFiles({ phase: 'drop', x: box.x + box.width / 2, y: box.y + box.height / 2, paths: ['/tmp/covered.txt'] });
  })()`);

  expect(await read(selection)).toEqual(before);
  await read(`document.getElementById('drop-cover').remove()`);

  const dir = captureDir("Z3742h");

  if (dir) {
    mkdirSync(dir, { recursive: true });
    await browser("screenshot", join(dir, "cover-dismissed.png"));
    writeFileSync(join(dir, "cover-dismissed.checks.json"), JSON.stringify(await read("window.__checks()"), null, 2));
  }
}, 90_000);
