import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromePath, openPage } from "./chromePage";
import type { ChromePage } from "./chromePage";

const found = chromePath();

const run = found || process.env.CI ? describe : describe.skip;

let page: ChromePage;

beforeAll(async () => {
  if (!found) throw new Error("U362 needs Chromium");
  page = await openPage(found);
}, 90_000);

afterAll(async () => { await page?.close(); });

type Point = {x: number; y: number};

type Checks = Record<string, {status: string; value: unknown}>;

const setup = async (worst = false, origin = "", width = 1280, height = 820) => {
  await page.load(`${origin}/harness.html?seed=tree-40${worst ? '&todos=worst' : ''}`, width, height);
  await page.until(`() => Boolean(document.querySelector('.shelf-tabs [role=tab]')) && Boolean(document.querySelector('[data-part="branch"][aria-expanded] > .rail-row')) && Boolean(window.__fake)`);
  await page.call(`() => {
    const tab = document.querySelector('#shelf-tab-todos');
    if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    document.querySelector('[data-todo-root]').click();
  }`);
  await page.until(`() => !document.querySelector('.rail-row[data-selected="true"]')`);
  await page.call(`() => document.querySelector('.shelf [data-shelf-group="unassigned"] [data-part="branch-control"]')?.click()`);
  await page.until(`() => Boolean(document.querySelector('.shelf .todo-row-button'))`);
};

const point = (selector: string) => page.call<Point>(`selector => {
  const el = document.querySelector(selector);
  el.scrollIntoView({block: 'nearest'});
  const b = el.getBoundingClientRect();
  return {x: b.left + b.width / 2, y: b.top + b.height / 2};
}`, selector);

run('u137 compound selected ground', () => {
  for (const [coverage, scheme, width] of [
    ['full', 'light', 1280], ['full', 'dark', 1280],
    ['partial', 'light', 1280], ['overlapping', 'light', 1280], ['single', 'light', 1280], ['padded', 'light', 1280], ['focus', 'light', 1280], ['focus-inset', 'light', 1280],
  ] as const) {
    it(`u137_compound_ground_never_silently_ignores_${coverage}_coverage ${scheme} ${width}`, async () => {
      await page.scheme(scheme);
      await setup(false, '', width, 800);
      await page.call(`(coverage, scheme) => {
        document.body.innerHTML = '<div class="compound"><button><span>Nested Rail label</span></button></div>';
        const sheet = document.head.appendChild(document.createElement('style'));
        sheet.textContent = 'body {background: white} .compound {width: 200px; height: 32px; padding-left: 24px; background-color: white; background-image: linear-gradient(rgb(0, 0, 0), rgb(0, 0, 0)), linear-gradient(rgba(0, 0, 0, .1), rgba(0, 0, 0, .1)); background-size: 2px 100%, auto; background-repeat: no-repeat; background-position: left top} .compound button {background: transparent; color: rgb(112, 112, 112)}';
        if (scheme === 'dark') {
          document.body.style.backgroundColor = 'black';
          document.querySelector('.compound').style.backgroundColor = 'black';
          document.querySelector('.compound').style.backgroundImage = 'linear-gradient(rgb(255, 255, 255), rgb(255, 255, 255)), linear-gradient(rgba(255, 255, 255, .4), rgba(255, 255, 255, .4))';
          document.querySelector('.compound button').style.color = 'rgb(170, 170, 170)';
        }
        if (coverage === 'single') {
          document.querySelector('.compound').style.backgroundImage = 'linear-gradient(rgba(0, 0, 0, .1), rgba(0, 0, 0, .1))';
          document.querySelector('.compound').style.backgroundSize = 'auto';
        }
        if (coverage === 'padded') {
          document.querySelector('.compound').textContent = 'Padded Rail label';
          document.querySelector('.compound').style.color = 'rgb(112, 112, 112)';
        }
        if (coverage === 'focus' || coverage === 'focus-inset') {
          document.querySelector('.compound button').style.color = 'black';
          const row = document.querySelector('.compound');
          row.tabIndex = 0;
          row.style.outline = '2px solid rgb(238, 238, 238)';
          if (coverage === 'focus-inset') row.style.outlineOffset = '-4px';
          row.focus();
        }
        if (coverage === 'partial') document.querySelector('.compound').style.backgroundSize = '2px 100%, 50% 100%';
        if (coverage === 'overlapping') document.querySelector('.compound').style.backgroundSize = '100% 100%, auto';
      }`, coverage, scheme);
      const checks = await page.call<Checks>(`() => window.__checks()`);
      expect(checks.D5?.status).toBe('fail');
      expect(checks.D10?.status).toBe('fail');
      expect(checks.D10?.value).toEqual(expect.objectContaining({failing: expect.arrayContaining(['D5'])}));

      // WCAG: #707070 on RGB(229.5,229.5,229.5); #aaa on #666. The leading mark is outside the label.
      if (coverage === 'full' || coverage === 'single' || coverage === 'padded') expect(checks.D5?.value).toEqual({text: expect.closeTo(scheme === 'dark' ? 2.471602 : 3.949511, 5)});
      else if (coverage === 'focus-inset') expect(checks.D5?.value).toEqual({focusRing: expect.closeTo(1.080701, 5)});
      else if (coverage === 'focus') expect(checks.D5?.value).toEqual({focusRing: expect.closeTo(1.16023, 5)});
      else expect(checks.D5?.value).toBe('not measurable');
    }, 30_000);
  }
});

run('u362 rendered Todo drag', () => {
  // The drop target and calls do not change with scheme; the wash reads its own Token.
  for (const scheme of ['light'] as const) {
    it(`u362_a_drop_moves_to_the_workstream_then_project_root ${scheme}`, async () => {
      await page.scheme(scheme);
      await setup();
      const id = await page.call<string>(`() => document.querySelector('.shelf .todo-row').dataset.todo`);
      const home = await page.call<string>(`() => document.querySelector('[data-part="branch"][aria-expanded] > .rail-row').dataset.id`);
      const from = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
      const to = await point('[data-part="branch"][aria-expanded] > .rail-row');
      await page.pointer('down', from.x, from.y);
      await page.pointer('move', to.x, to.y);
      expect(await page.call<string>(`() => document.querySelector('[data-todo-drop]')?.dataset.id`)).toBe(home);

      await page.pointer('up', to.x, to.y);
      await page.until(`() => window.__fake.app.calls.some(c => c.method === 'todo.move')`);
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').at(-1).params`)).toEqual({id: Number(id), home});
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.reorder').length`)).toBe(0);
      const movedHome = await page.call<string>(`async id => (await window.__fake.app.rpc('todo.list', {})).find(todo => todo.id === Number(id)).home`, id);
      expect(movedHome).toBe(home);
      // todo.updated can refetch before dnd-kit finishes its drop. Its Feedback
      // cleanup removes the placeholder only after returning the source to idle.
      await page.until(`() => !document.querySelector('[data-dnd-placeholder], [data-dnd-dragging]')`);
      // sortedList.settle slides rows after the refetch; measure the next drag
      // only once those animations have finished moving its handle.
      await page.call(`async () => {
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);
      const back = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
      const root = await point('[data-todo-root]');
      await page.pointer('down', back.x, back.y);
      await page.pointer('move', root.x, root.y);
      await page.until(`() => document.querySelector('[data-todo-root]')?.hasAttribute('data-todo-drop')`);
      await page.pointer('up', root.x, root.y);
      await page.until(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').length === 2`);
      expect(await page.call(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move').at(-1).params`)).toEqual({id: Number(id), home: null});
      expect(await page.call(`() => document.activeElement === document.body`)).toBe(false);
      expect(await page.call(`async id => (await window.__fake.app.rpc('todo.list', {})).find(todo => todo.id === Number(id)).home`, id)).toBeNull();
    }, 60_000);
  }
});

run('u362 rendered Todo drag that moves nothing', () => {
  it('u362_a_drop_elsewhere_escape_or_on_an_agent_calls_nothing', async () => {
    await page.scheme('light');
    await setup();
    const id = await page.call<string>(`() => document.querySelector('.shelf .todo-row').dataset.todo`);
    const from = await point(`.shelf [data-todo="${id}"] .todo-row-button`);
    const home = await point('[data-part="branch"][aria-expanded] > .rail-row');
    const elsewhere = await point('.shelf-head, .shelf');
    const calls = () => page.call<string[]>(`() => window.__fake.app.calls.filter(c => c.method === 'todo.move' || c.method === 'todo.reorder').map(c => c.method)`);

    // Escape over a Home.
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', home.x, home.y);
    expect(await page.call(`() => Boolean(document.querySelector('[data-todo-drop]'))`)).toBe(true);
    await page.press('Escape', 'Escape');
    await page.pointer('up', home.x, home.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    // Over a Home, then back out of the Rail and released there.
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', home.x, home.y);
    await page.pointer('move', elsewhere.x + 10, elsewhere.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    await page.pointer('up', elsewhere.x + 10, elsewhere.y);
    // An Agent row is no Home.
    const agent = await point('.rail-row[data-part="item"]');
    await page.pointer('down', from.x, from.y);
    await page.pointer('move', agent.x, agent.y);
    expect(await page.call(`() => document.querySelector('[data-todo-drop]')`)).toBeNull();
    await page.pointer('up', agent.x, agent.y);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await calls()).toEqual([]);
  }, 60_000);
});

run('u362 rendered move failure', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`u362_a_failed_move_stays_visible_on_the_densest_seed ${scheme}`, async () => {
      await page.scheme(scheme);
      await setup(true);
      await page.call(`() => {
        document.querySelector('.shelf').style.width = '163px';
        document.querySelector('[aria-label="Todo fixture"] button').click();
      }`);
      await page.until(`() => document.querySelector('[aria-label="Todo fixture"] button').getAttribute('aria-pressed') === 'true'`);
      await page.until(`() => document.querySelectorAll('.shelf .todo-row').length === 200`);
      await page.call(`async () => {
        await document.fonts.ready;
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);
      const from = await point('.shelf .todo-row-button');
      const to = await point('[data-part="branch"][aria-expanded] > .rail-row');
      await page.pointer('down', from.x, from.y);
      await page.pointer('move', to.x, to.y);
      expect(await page.call(`() => Boolean(document.querySelector('[data-todo-drop]'))`)).toBe(true);
      await page.call(`() => window.__fake.failNext(-32000, 'Cannot move this Todo')`);
      await page.pointer('up', to.x, to.y);
      await page.until(`() => document.querySelector('.shelf [role="alert"]')?.textContent.includes('Cannot move this Todo')`);
      await page.call(`async () => {
        await Promise.all([...document.querySelectorAll('.shelf .todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished));
      }`);
    }, 30_000);
  }
});

run('u2716a Project overview band', () => {
  const overview = '.centre [aria-label="Project overview"]';
  const band = '.rail [data-todo-root]';

  const open = async () => {
    await page.load('/harness.html?seed=tree-40');
    await page.until(`() => Boolean(document.querySelector('${band}')) && Boolean(window.__fake)`);
    await page.call(`() => document.querySelector('[role="treeitem"]').click()`);
    await page.until(`() => document.querySelector('${band}').getAttribute('aria-pressed') === 'false'`);
  };

  it('u2716a_click_opens_the_project_overview', async () => {
    await open();
    const target = await point(band);
    await page.click(target.x, target.y);
    await page.until(`() => Boolean(document.querySelector('${overview}'))`);
    expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-pressed')`)).toBe('true');
    expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-label')`)).toMatch(/Overview.*Project root/);
  }, 60_000);

  it('u2716a_keyboard_opens_the_project_overview', async () => {
    for (const [key, code] of [['Enter', 'Enter'], [' ', 'Space']]) {
      await open();
      // A real Tab from the preceding element must reach the native band button.
      await page.call(`() => {
        const before = document.createElement('button');
        document.querySelector('${band}').before(before);
        before.focus();
      }`);
      await page.press('Tab', 'Tab');
      expect(await page.call(`() => document.activeElement.matches('${band}')`)).toBe(true);
      await page.press(key!, code!);
      await page.until(`() => Boolean(document.querySelector('${overview}'))`);
      expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-pressed')`)).toBe('true');
    }
  }, 60_000);

  it('u2716a_attention_name_follows_tree_and_status', async () => {
    await open();
    await page.call(`async () => {
      const fake = window.__fake;
      const nodes = await fake.app.rpc('rail.tree', {});
      nodes.push({...nodes.find(n => n.kind === 'agent'), id: 'overview-terminal', name: 'Terminal', kind: 'terminal', status: null, status_revision: null, attempt: null, terminal_id: 'overview-terminal', parent: null});
      window.__overviewNodes = nodes;
      fake.app.handlers['rail.tree'] = () => nodes.map(n => n.status ? {...n, status: {...n.status, kind: 'working'}} : n);
      fake.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'rail.changed'});
      document.querySelector('${band}').click();
    }`);
    await page.until(`() => Boolean(document.querySelector('${overview} h2')) && !/\\d/.test(document.querySelector('${overview} h2').textContent)`);
    expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-label')`)).toBe('Overview, Project root');
    await page.call(`() => {
      const nodes = window.__overviewNodes;
      const door = nodes.find(n => n.kind === 'workstream' && n.status);
      const agent = nodes.find(n => n.kind === 'agent');
      window.__attentionAgent = agent.id;
      window.__fake.app.handlers['rail.tree'] = () => nodes.map(n => n.status ? {...n, status: {...n.status, kind: n.id === door.id ? 'error' : n.id === agent.id ? 'needs-you' : 'working'}} : n);
      window.__fake.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'rail.changed'});
    }`);
    await page.until(`() => parseInt(document.querySelector('${overview} h2')?.textContent) === 2`);
    expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-label')`)).toBe('Overview, Project root, 2 need you');
    await page.call(`() => window.__fake.setStatus(window.__attentionAgent, 'working', 'busy')`);
    await page.until(`() => parseInt(document.querySelector('${overview} h2')?.textContent) === 1`);
    expect(await page.call(`() => document.querySelector('${band}').getAttribute('aria-label')`)).toBe('Overview, Project root, 1 needs you');
  }, 60_000);
});
