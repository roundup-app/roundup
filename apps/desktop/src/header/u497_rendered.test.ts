import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { browser, read, wait, url } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";
import { CHECK_IDS, type Checks } from "../testing/checks";

const art = captureDir('U497');

const rendered = art ? it : it.skip;

const failure = 'Authored failure: could not save or close — 雪; retry after checking the Project connection. Complete details stay visible.';

const contrast = process.env.ROUNDUP_CONTRAST ?? 'normal';

for (const seed of ['tabs-8', 'tree-40']) for (const width of [1280, 1440]) for (const scheme of ['light', 'dark']) {
  rendered(`u497_rendered_checks_and_failures_${seed}_${width}_${scheme}_${contrast}`, async () => {
    const baseline = new Map<string, Checks>();

    // Each case starts a fresh browser and profile; increased contrast needs forced-colours-free high-contrast mode (as u481).
    await browser('close');
    await browser('--profile', mkdtempSync(join(tmpdir(), 'u497-')), ...(contrast === 'more' ? ['--args', '--force-high-contrast,--disable-blink-features=ForcedColors'] : []), 'open', url('/harness.html?seed=tabs-8'));

    for (const base of [true, false]) {
      const side = base ? 'base' : 'head';
      const directory = join(art!, side);
      mkdirSync(directory, { recursive: true });
      await browser('set', 'viewport', String(width), '800');
      await browser('set', 'media', scheme);
      await browser('open', url(`/harness.html?seed=${seed}`, base));
      await wait(`!!window.__fake && document.querySelectorAll('.rail-row').length > 0`);
      expect(await read<boolean>(`matchMedia('(prefers-contrast: more)').matches`)).toBe(contrast === 'more');
      await browser('eval', `(() => {
        for (const tab of document.querySelectorAll('.project-tab')) {
          const app = window.__fake.app.of(tab.dataset.path);
          app.handlers['project.get'] = () => ({worktrees:{on:false,check:null},mcp:{on:true},models:{roles:[{role:'door',model:null,effort:null}]}});
        }
        // tabs-8 has no Todos: its second Project gets one made by its running Agent, which is what the Shelf lists.
        const tab = document.querySelectorAll('.project-tab')[1];
        const second = tab && window.__fake.app.of(tab.dataset.path);
        if (second && !second.handlers['todo.list']().length) {
          second.handlers['todo.create']({ title: 'Authored 雪 Todo', body: 'Body', blockers: [] });
          const agent = (todo) => ({ ...todo, creator: { kind: 'agent', id: 'p2-agent', parent: null } });
          const list = second.handlers['todo.list'];
          const get = second.handlers['todo.get'];
          second.handlers['todo.list'] = () => list().map(agent);
          second.handlers['todo.get'] = (params) => agent(get(params));
        }
        window.__fake.app.closeProject = async () => { throw new Error(${JSON.stringify(failure)}); };
      })()`);

      const record = async (state: string) => {
        const name = `${seed}-${width}-${scheme}-${contrast}-${state}`;
        const checks = await read<Checks>('window.__checks()');
        writeFileSync(join(directory, `${name}.checks.json`), JSON.stringify(checks));
        await browser('screenshot', join(directory, `${name}.png`));

        if (base) baseline.set(state, checks);
        else {
          for (const id of CHECK_IDS) if (baseline.get(state)![id].status === 'pass') expect(checks[id].status, `${name}/${id}`).toBe('pass');

          for (const id of ['D2','D5','D6'] as const) expect(checks[id].status, `${name}/${id}`).toBe('pass');
        }
      };

      await record('rest');
      await browser('eval', `document.querySelectorAll('.project-tab [role=tab]')[${seed === 'tabs-8' ? 1 : 0}].click()`);
      await wait(`document.querySelectorAll('.project-tab')[${seed === 'tabs-8' ? 1 : 0}].dataset.selected === 'true'`);
      await browser('hover', '.project-tab[data-selected=true]');
      await browser('eval', `(() => { const button=document.querySelector('.project-tab[data-selected=true] .tab-close'); button.focus(); button.click(); })()`);
      await wait(`!!document.querySelector('[role=alertdialog]')`);
      await record('confirmation');
      await browser('find', 'role', 'button', 'click', '--name', 'Stop and close', '--exact');
      await wait(`!document.querySelector('[role=alertdialog]') && document.body.textContent.includes(${JSON.stringify(failure)})`);
      expect(await read<boolean>(`[...document.querySelectorAll('[role=alert]')].some(e => e.textContent.includes(${JSON.stringify(failure)}) && e.checkVisibility() && e.scrollHeight <= e.clientHeight + 1)`)).toBe(true);
      await record('rejected-close');
      // `tabs-8`'s first Project answers no Todo calls; its second is the one with a Shelf Store.
      const drawerAt = seed === 'tabs-8' ? 1 : 0;
      await browser('eval', `document.querySelectorAll('.project-tab [role=tab]')[${drawerAt}].click()`);
      await wait(`document.querySelectorAll('.project-tab')[${drawerAt}].dataset.selected === 'true'`);
      await wait(`!!document.querySelector('.shelf .todo-row-button')`);
      await browser('click', '.shelf .todo-row-button');
      await wait(`document.querySelector('.drawer').dataset.open === 'true' && !!document.querySelector('.drawer .todo-detail-title')`);
      await record('drawer');
      await browser('hover', '.drawer .close');

      if (base) await record('tooltip');
      else {
        await wait(`document.querySelector('.drawer .close').dataset.state === 'open'`);
        await record('tooltip');
      }

    }

    writeFileSync(join(art!, 'commits.json'), JSON.stringify({base: process.env.ROUNDUP_CAPTURE_BASE, head: process.env.ROUNDUP_CAPTURE_HEAD}));
  }, 180_000);
}
