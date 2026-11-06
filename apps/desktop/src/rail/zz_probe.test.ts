import { afterAll, beforeAll, it } from "vitest";
import { chromePath, openPage, type ChromePage } from "../testing/chromePage";

let page: ChromePage;
beforeAll(async () => { page = await openPage(chromePath()!); }, 90_000);
afterAll(async () => { await page?.close(); });
const read = <T,>(e: string) => page.call<T>(`() => (${e})`);
const wait = (e: string) => page.until(`() => (${e})`);
const box = (id: string) => read<any>(`(() => { const row = document.querySelector('.rail-row[data-id="${id}"]'); const r = row.querySelector(".sortable-handle").getBoundingClientRect(); const b = row.getBoundingClientRect(); return { x: r.x + Math.min(8, r.width / 2), y: r.y + r.height / 2, bottom: b.bottom }; })()`);

it("probe", async () => {
  await page.load("/harness.html?view=workstreams&items=1&tabs=1&seed=tree-40", 1512, 950);
  await wait(`document.querySelector('[data-id="tokens"]') && window.__fake`);
  await page.call(`() => { window.__gaps = []; let last = performance.now(); const ch = new MessageChannel(); window.__rec = false; ch.port1.onmessage = () => { const n = performance.now(); if (window.__rec && n - last > 8) window.__gaps.push(n - last); last = n; setTimeout(() => ch.port2.postMessage(0), 0); }; ch.port2.postMessage(0); }`);
  const ids = await read<string[]>(`[...document.querySelectorAll('.rail-row[data-id]')].map(e => e.dataset.id)`);
  const out: number[] = [];
  for (let i = 0; i < 1; i++) {
    const from = await box(ids[1 + (i % 2)]);
    const to = await box(ids[6]);
    await page.pointer("move", from.x, from.y); await page.pointer("down", from.x, from.y);
    await page.pointer("move", from.x + 6, from.y + 6);
    await wait(`document.querySelector('[data-dnd-placeholder]') || document.querySelector('[data-lifted=true]')`);
    await page.pointer("move", from.x + 6, to.bottom + 2); await page.pointer("move", from.x, to.bottom + 2);
    await new Promise(r => setTimeout(r, 300));
    const n0 = await read<number>(`window.__fake.app.calls.filter(c => c.method === 'rail.move').length`);
    await page.call(`() => { window.__st = {}; for (const fn of ['appendChild','insertBefore','append']) { const orig = document.body[fn]; document.body[fn] = function(...a) { const k = (a[0].outerHTML ?? '').replace(/ id="[^"]*"/g, '').slice(0, 220); window.__st[k] = (window.__st[k] ?? 0) + 1; return orig.apply(this, a); }; } window.__nodes = new Map([...document.querySelectorAll('.rail-row[data-id]')].map(e => [e.dataset.id, e])); window.__mut = 0; window.__tally = {}; window.__mo = new MutationObserver(l => { window.__mut += l.length; for (const m of l) { if (m.type === 'childList' && m.target === document.body && (window.__bodyn = (window.__bodyn ?? 0) + 1) < 12) (window.__log ??= []).push(['BODY', [...m.addedNodes].map(n => n.nodeName + '.' + (n.className ?? '')).join(), [...m.removedNodes].map(n => n.nodeName + ':' + (n.outerHTML ?? '').slice(0, 160)).join()].join(' ')); if (m.type === 'childList' && m.target.tagName === 'svg' && (window.__svgn = (window.__svgn ?? 0) + 1) < 4) (window.__log ??= []).push(['SVG', m.target.closest('.rail-row') ? 'rail' : 'other', [...m.addedNodes].map(n => n.nodeName).join(), [...m.removedNodes].map(n => n.nodeName).join()].join(' ')); const k = m.type + ':' + (m.attributeName ?? '') + ':' + (m.target.nodeType === 1 ? m.target.tagName + '.' + String(m.target.getAttribute('class')).slice(0, 30) : 'text'); window.__tally[k] = (window.__tally[k] ?? 0) + 1; } }); window.__mo.observe(document.body, {subtree: true, childList: true, attributes: true, characterData: true}); window.__gaps.length = 0; window.__tl = []; window.__rec = true; }`);
    await page.pointer("up", from.x, to.bottom + 2);
    await new Promise(r => setTimeout(r, 1500));
    const g = await read<number[]>(`(window.__rec = false, window.__gaps)`);
    console.log(JSON.stringify(await read(`(window.__mo.takeRecords(), Object.entries(window.__tally).sort((a,b)=>b[1]-a[1]).slice(0,14))`)));console.log('TL', JSON.stringify(await read(`Object.entries(window.__tl.reduce((m, k) => (m[k] = (m[k] ?? 0) + 1, m), {}))`)));console.log('STACKS', JSON.stringify(await read(`window.__st`), null, 1));console.log("same nodes", await read(`[...document.querySelectorAll('.rail-row[data-id]')].filter(e => window.__nodes.get(e.dataset.id) === e).length + '/' + document.querySelectorAll('.rail-row[data-id]').length + ' mutations ' + (window.__mo.takeRecords().length + window.__mut)`));
    const n1 = await read<number>(`window.__fake.app.calls.filter(c => c.method === 'rail.move').length`);
    out.push(Math.round(Math.max(0,...g))); console.log("drop", i, "moves", n1 - n0, "max gap", Math.max(0,...g).toFixed(0), "gaps>16:", g.filter(x => x > 16).map(x => x.toFixed(0)).join(","));
  }
}, 120_000);
