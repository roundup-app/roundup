import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { captureDir } from "../testing/captures";
import { shelfBrowser } from "../shelf/u371Browser";

/**
 * U3010b's rendered observer: the Inbox Drawer pointer open, reversal at 50% displaced, reopen at 50% of the return, then Escape,
 * in dark 1512×950 on `tree-40`. Raw timestamped boxes go to `captureDir("U3010b")` for the design critic; docs/motion.md
 * names the protocol. Quarter speed is `Animation.playbackRate`, never a longer Token.
 */
const art = captureDir("U3010b");

const rendered = art ? it : it.skip;

const { browser, evaluate, settle, rig } = shelfBrowser();

const trace = (rate: number) => `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const drawer = document.querySelector('.drawer');
  const row = document.querySelector('.shelf [data-todo] .todo-row-button');
  const box = () => { const r = drawer.getBoundingClientRect(); return { left: r.left, width: r.width }; };
  const slow = () => document.getAnimations().forEach(a => { a.playbackRate = ${rate}; });
  const samples = [];
  const log = (event, source) => samples.push({ t: performance.now(), event, source, ...box(), focus: document.activeElement?.className ?? null, content: !!drawer.querySelector(':scope > :not(.close)') });
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  const advance = async (done) => { for (let i = 0; i < 600; i++) { slow(); await frame(); log('frame'); if (done()) return; } };

  const finished = async () => {
    await frame();
    await Promise.all(document.getAnimations().filter(a => a.effect?.target === drawer).map(a => a.finished.catch(() => {})));
    await frame(); await frame();
  };

  // Endpoints, read once from a settled open and a settled close: the closed edge is the viewport's right edge.
  row.focus();
  click(row);
  await finished();
  const targetLeft = box().left;
  const closedLeft = innerWidth;
  click(drawer.querySelector('.close'));
  await finished();
  const retargets = [];
  const reverse = async (destination, source) => {
    const before = document.getAnimations().filter(a => a.effect?.target === drawer);
    before.forEach(a => a.pause());
    const was = box();
    log('before-retarget', source);
    destination();
    await Promise.resolve();
    const after = document.getAnimations().filter(a => a.effect?.target === drawer);
    after.forEach(a => a.pause());
    const now = box();
    retargets.push({ source, was, now, dx: Math.abs(was.left - now.left) });
    log('after-retarget', source);
    after.forEach(a => a.play());
  };

  // 50% displaced on the way open, from the closed edge.
  click(row); slow();
  await advance(() => Math.abs(closedLeft - box().left) >= Math.abs(closedLeft - targetLeft) / 2);
  await reverse(() => click(drawer.querySelector('.close')), 'pointer');
  await advance(() => Math.abs(closedLeft - box().left) <= Math.abs(closedLeft - targetLeft) / 4);
  await reverse(() => { row.focus(); click(row); }, 'pointer');
  await frame(); slow();
  log('reopened', 'pointer');
  drawer.querySelector('.close').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
  log('escape', 'key');
  await frame();
  log('escape+1frame', 'key');
  return { closedLeft, targetLeft, retargets, samples };
})()`;

for (const variant of [{ name: "normal", rate: 1, reduced: false }, { name: "quarter", rate: 0.25, reduced: false }, { name: "reduced", rate: 1, reduced: true }]) {
  rendered(`u3010b_rendered_drawer_${variant.name}`, async () => {
    const directory = join(art!, "head");
    mkdirSync(directory, { recursive: true });

    for (const run of [1, 2, 3]) {
      await browser("set", "viewport", "1512", "950");
      await browser("set", "media", "dark", ...(variant.reduced ? ["reduced-motion"] : []));
      const url = `${rig.server.resolvedUrls.local[0]}harness.html?seed=tree-40`;
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await evaluate(`(() => { localStorage.clear(); return true; })()`);
      await browser("open", url);
      await browser("wait", "--fn", "!!document.querySelector('.shelf [data-todo] button')");
      await settle();

      const result = await evaluate<{ retargets: { dx: number }[]; samples: { event: string; left: number; content: boolean; focus: string | null }[] }>(trace(variant.rate));

      writeFileSync(join(directory, `drawer-${variant.name}-run${run}.json`), JSON.stringify(result));
      await browser("screenshot", join(directory, `drawer-${variant.name}-run${run}.png`));

      const last = result.samples.at(-1)!;

      // Escape settles by the next frame: closed, no exit content, focus returned.
      expect(last.content).toBe(false);
      expect(last.left).toBeGreaterThanOrEqual(1512 - 1);
      expect(last.focus).toContain("todo-row-button");

      // Retargets continue from the displayed position, within 1 CSS px at the same animation time.
      if (!variant.reduced) for (const retarget of result.retargets) expect(retarget.dx).toBeLessThanOrEqual(1);
    }
  }, 180_000);
}

// The Shelf's reserved mode: pointer close, reversal at 50% of its width, then the same close left to run; reduced motion settles it.
const shelfTrace = (rate: number) => `(async () => {
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const shelf = document.querySelector('.shelf');
  const samples = [];
  const log = (event) => samples.push({ t: performance.now(), event, left: shelf.getBoundingClientRect().left, width: shelf.getBoundingClientRect().width, hidden: shelf.hidden });
  const toggle = () => document.querySelector('.shelf-tab[data-selected]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  const slow = () => document.getAnimations().forEach(a => { a.playbackRate = ${rate}; });
  const settled = async () => { await frame(); await Promise.all(document.getAnimations().filter(a => a.effect?.target?.matches?.('.shelf, .shelf-scrim, .columns')).map(a => a.finished.catch(() => {}))); await frame(); await frame(); };
  const openWidth = shelf.getBoundingClientRect().width;
  const openLeft = shelf.getBoundingClientRect().left;
  const moved = () => Math.abs(shelf.getBoundingClientRect().left - openLeft);
  const advance = async (done) => { for (let i = 0; i < 600; i++) { slow(); await frame(); log('frame'); if (done()) return; } };

  toggle(); slow();
  await advance(() => moved() >= openWidth / 2);
  log('reverse'); toggle(); slow();
  await advance(() => moved() <= openWidth / 4);
  await settled();
  log('settled-open');
  return { openLeft, samples };
})()`;

for (const variant of [{ name: "normal", rate: 1, reduced: false }, { name: "quarter", rate: 0.25, reduced: false }, { name: "reduced", rate: 1, reduced: true }]) {
  rendered(`u3010b_rendered_shelf_${variant.name}`, async () => {
    const directory = join(art!, "head");
    mkdirSync(directory, { recursive: true });

    for (const run of [1, 2, 3]) {
      await browser("set", "viewport", "1512", "950");
      await browser("set", "media", "dark", ...(variant.reduced ? ["reduced-motion"] : []));
      const url = `${rig.server.resolvedUrls.local[0]}harness.html?seed=tree-40`;
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await evaluate(`(() => { localStorage.clear(); return true; })()`);
      await browser("open", url);
      await browser("wait", ".shelf-tabs");
      await settle();

      const result = await evaluate<{ openLeft: number; samples: { event: string; left: number }[] }>(shelfTrace(variant.rate));

      writeFileSync(join(directory, `shelf-${variant.name}-run${run}.json`), JSON.stringify(result));

      // The reversal ends at the open edge, never restarting from an endpoint.
      expect(result.samples.at(-1)!.left).toBe(result.openLeft);
    }
  }, 180_000);
}
