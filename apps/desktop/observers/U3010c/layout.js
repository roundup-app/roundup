import { createSignal, For, createComponent, batch } from "solid-js";
import { render, insert } from "solid-js/web";
import { animateLayout } from "motion";
import { captureFocus } from "/src/keys/focus.ts";

export default async function () {
  const tokens = getComputedStyle(document.documentElement);
  const duration = tokens.getPropertyValue('--duration-toast-in').trim();
  const ease = tokens.getPropertyValue('--easing-out').match(/[\d.]+/g).map(Number);
  const options = { duration: parseFloat(duration) / (duration.endsWith('ms') ? 1000 : 1), ease };
  const host = document.createElement('section');
  host.style.cssText = 'position:fixed;left:400px;top:100px;width:400px;background:var(--surface);padding:var(--space-4)';
  document.body.append(host);
  let setRows;
  let setChildren;
  const initial = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const dispose = render(() => {
    const [rows, set] = createSignal(initial);
    const [children, child] = createSignal([]);
    setRows = set;
    setChildren = child;
    const draw = row => {
      const el = document.createElement('div');
      el.dataset.layout = '';
      el.dataset.layoutId = row.id;
      el.dataset.probe = row.id;
      const button = document.createElement('button');
      button.textContent = row.id;
      button.dataset.probeFocus = row.id;
      button.style.cssText = 'display:block;height:var(--space-7);width:100%;text-align:left';
      el.append(button);
      if (row.id === 'a') {
        const nested = document.createElement('div');
        nested.style.paddingLeft = 'var(--space-6)';
        insert(nested, createComponent(For, { get each() { return children(); }, children: draw }));
        el.append(nested);
      }
      return el;
    };
    const list = document.createElement('div');
    insert(list, createComponent(For, { get each() { return rows(); }, children: draw }));
    return list;
  }, host);
  const frame = () => new Promise(requestAnimationFrame);
  const samples = [];
  const read = event => {
    const reading = { event, t: performance.now(), rows: [...host.querySelectorAll('[data-probe]')].map(el => ({
      id: el.dataset.probe, top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left,
      opacity: getComputedStyle(el).opacity, transform: getComputedStyle(el).transform,
    })), focus: document.activeElement?.dataset.probeFocus ?? null };
    samples.push(reading);
    return reading;
  };
  await frame();
  host.querySelector('[data-probe-focus=b]').focus();
  for (const [name, update] of [
    ['insert', () => setRows([initial[0], { id: 'd' }, initial[1], initial[2]])],
    ['remove', () => setRows(initial)],
    ['nest', () => batch(() => { setRows([initial[0], initial[2]]); setChildren([initial[1]]); })],
    ['unnest', () => batch(() => { setChildren([]); setRows(initial); })],
    ['reorder', () => setRows([initial[2], initial[0], initial[1]])],
  ]) {
    const before = read(name + '-before');
    const focus = document.activeElement?.dataset.probeFocus;
    const permit = captureFocus();
    animateLayout(host, () => {
      update();
      if (focus && !host.contains(document.activeElement)) permit(() => host.querySelector(`[data-probe-focus="${focus}"]`)?.focus({ preventScroll: true }));
    }, options);
    const origin = before.rows.find(row => row.id === 'c').top;
    for (let index = 0; index < 60; index++) {
      await frame();
      const current = read(name + '-frame');
      if (name === 'reorder' && Math.abs(current.rows.find(row => row.id === 'c').top - origin) >= 24) {
        read('interrupt-before');
        animateLayout(host, () => setRows(initial), options);
        read('interrupt-after');
        break;
      }
      if (name !== 'reorder' && index >= 5) break;
    }
    for (let index = 0; index < 20; index++) { await frame(); read(name + '-settle'); }
  }
  const result = { engine: 'motion 14.6.0', renderer: 'Solid keyed For; actual nested reparenting', samples };
  dispose();
  host.remove();
  return result;
}
