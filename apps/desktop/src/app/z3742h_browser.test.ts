import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

it("z3742h_a_cover_prevents_a_drop_into_the_row_behind_it", async () => {
  await browser("set", "viewport", "1512", "950");
  await browser("open", url("/harness.html?seed=agents-10"));
  await wait(`document.querySelectorAll('.rail-row[data-id]').length > 0`);
  const outcome = await read<{ selected: string | null; writes: number }>(`(async () => {
    const row = document.querySelector('.rail-row[data-id]');
    const box = row.getBoundingClientRect();
    const cover = document.createElement('div');
    Object.assign(cover.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: 'var(--surface)' });
    document.body.append(cover);
    const before = document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id') ?? null;
    const calls = window.__fake.app.calls.length;
    window.__fake.app.dropFiles({ phase: 'drop', x: box.x + box.width / 2, y: box.y + box.height / 2, paths: ['/tmp/covered.txt'] });
    await Promise.resolve();
    await Promise.resolve();
    const selected = document.querySelector('.rail-row[data-selected=true]')?.getAttribute('data-id') ?? null;
    const writes = window.__fake.app.calls.slice(calls).filter(call => call.method === 'terminal.write').length;
    cover.remove();
    return { selected: selected === before ? null : selected, writes };
  })()`);

  expect(outcome).toEqual({ selected: null, writes: 0 });
}, 90_000);
