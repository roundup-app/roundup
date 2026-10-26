// U4231: rendered readings only; the App-seam tests own behavioral assertions.
export default async function ({ list = 'shelf', quarter = false } = {}) {
  const frame = () => new Promise(requestAnimationFrame);
  const rows = () => [...document.querySelectorAll(list === 'agent' ? '[data-pads] .todo-row-button' : '.shelf [data-shelf-group="unassigned"] .todo-list .todo-row-button')];

  if (list === 'agent') document.querySelector('.rail-pads-control').click();
  else {
    const tab = document.querySelector('#shelf-tab-todos');

    if (tab.getAttribute('aria-expanded') !== 'true') tab.click();
    document.querySelector('[data-todo-root]').click();
    await frame();
    document.querySelector('[data-todo-root]').click();
    const group = document.querySelector('.shelf [data-shelf-group="unassigned"]');

    if (group?.getAttribute('aria-expanded') !== 'true') group?.querySelector('[data-part="branch-control"]')?.click();
  }

  for (let n = 0; n < 180 && (rows().length < 3 || !rows()[2].getBoundingClientRect().height); n++) await frame();

  if (rows().length < 3) throw Error('U4231 needs three visible Todos');
  const app = window.__fake.app;
  const originalRead = app.handlers['todo.list'];
  const originalReorder = app.handlers['todo.reorder'];
  const id = row => Number(/#(\d+)/.exec(row.getAttribute('aria-label'))[1]);
  const samples = [];
  const boundaries = [];
  let sampling = true;

  const read = label => {
    const value = { label, t: performance.now(), rows: rows().map(row => ({id: id(row), top: row.closest('.todo-row').getBoundingClientRect().top, opacity: getComputedStyle(row.closest('.todo-row')).opacity})), focus: document.activeElement?.getAttribute('aria-label'), scroll: document.querySelector('.shelf-area')?.scrollTop ?? 0 };
    samples.push(value);

    return value;
  };

  const animate = Element.prototype.animate;
  const effects = [];
  Element.prototype.animate = function (...args) {
    const animation = animate.apply(this, args);

    if (this.matches('.todo-row')) {
      effects.push({ t: performance.now(), frames: args[0], options: args[1] });

      if (quarter) animation.playbackRate = 0.25;
    }

    return animation;
  };

  const sample = () => {
    read('frame');

    if (sampling) requestAnimationFrame(sample);
  };

  sample();
  let completed;
  let heldRead = null;
  let releaseRead;
  const acknowledged = () => new Promise(resolve => { completed = resolve; });
  app.handlers['todo.list'] = async (...args) => {
    if (heldRead) await heldRead;
    const result = await originalRead(...args);
    boundaries.push({event: 'refetch-answer', t: performance.now(), ids: result.map(todo => todo.id)});
    // state.ts reconciles after this reply, then sortedList's settle runs in a microtask.
    requestAnimationFrame(() => requestAnimationFrame(() => { completed?.(); completed = null; }));

    return result;
  };

  const done = async () => {
    await Promise.all([...document.querySelectorAll('.todo-row')].flatMap(row => row.getAnimations()).map(animation => animation.finished.catch(() => {})));
    await frame();
    await frame();
  };

  const api = {
    rows, id, read, boundaries, effects,
    key: async mode => {
      const todoId = id(rows()[1]);
      app.handlers['todo.reorder'] = async params => {
        boundaries.push({event: 'key-request', t: performance.now(), params});
        let todo;

        if (mode === 'delayed') {
          heldRead = new Promise(resolve => { releaseRead = resolve; });
          todo = await originalReorder(params);
        }
        else {
          todo = (await originalRead(null)).find(todo => todo.id === params.id);

          if (mode === 'equal') window.__fake.emit({actor: {kind: 'user', id: 'you', parent: null}, name: 'todo.updated', data: {...todo}});
        }

        boundaries.push({event: 'key-ack', t: performance.now(), id: todoId});

        if (mode === 'delayed') requestAnimationFrame(() => requestAnimationFrame(() => { heldRead = null; releaseRead(); }));
        app.handlers['todo.reorder'] = originalReorder;

        return {...todo};
      };

      const ready = acknowledged();
      rows()[1].focus();
      // The eval entry point delivers the same App key handler as the real-key behavioral browser tests.
      rows()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }));
      await ready;
      boundaries.push({event: 'key-complete', ...read('key-complete')});
    },
    incoming: async () => {
      const ready = acknowledged();
      const params = {id: id(rows()[2]), before: id(rows()[0])};
      boundaries.push({event: 'incoming', ...read('before-incoming'), params});
      await originalReorder(params);
      await ready;
      await done();
    },
    point: n => {
      rows()[n].scrollIntoView({block: 'nearest'});
      const box = rows()[n].getBoundingClientRect();

      return {x: box.left + box.width / 2, y: box.top + box.height / 2};
    },
    finish: async () => {
      await done();
      sampling = false;
      Element.prototype.animate = animate;

      return { list, quarter, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, viewport: [innerWidth, innerHeight], dark: matchMedia('(prefers-color-scheme: dark)').matches,
        samples, boundaries, effects, final: read('final'), calls: app.calls.filter(call => call.method === 'todo.reorder'), checks: await window.__checks() };
    },
  };

  window.__unchangedKey = api;

  return {ready: true, initial: read('initial')};
}
