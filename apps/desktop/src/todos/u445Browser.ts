/** U445 observer shared by the isolated Chromium tests and agent-browser pass. */
export const U445_READ = String.raw`async (name, worst, keyboard) => {
  const title = worst ? 'w'.repeat(300) : 'todo 5';
  const body = worst ? Array.from({length:40}, (_, i) => 'body line ' + (i + 1)).join('\n') : 'one\ntwo';
  await window.__fake.app.rpc('todo.update', {id:5, title, body});
  const row = document.querySelector('[data-id="5"] button');
  row.click();
  while (!document.querySelector('[aria-label="Drawer"] p')) await new Promise(requestAnimationFrame);
  await document.fonts.ready;
  await Promise.all(document.querySelector('[aria-label="Drawer"]').getAnimations().map(a => a.finished));
  const drawer = document.querySelector('[aria-label="Drawer"]');
  const shown = [...drawer.querySelectorAll('p')].find(el => el.textContent === (name === 'title' ? title : body));
  const box = el => {const r = el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height};};
  const properties = ['font-family','font-size','font-weight','line-height','letter-spacing','color','text-align','white-space','overflow-wrap','padding','margin','border-top-width','border-right-width','border-bottom-width','border-left-width'];
  const type = el => Object.fromEntries(properties.map(p => [p, getComputedStyle(el).getPropertyValue(p)]));
  const lines = el => {
    const node = el.firstChild;
    const rows = new Map();
    for (let i=0; i<node.length; i++) {
      const range = document.createRange(); range.setStart(node,i); range.setEnd(node,i+1);
      const r = range.getBoundingClientRect();
      if (node.textContent[i] !== '\n') rows.set(r.y, (rows.get(r.y) ?? '') + node.textContent[i]);
    }
    return [...rows.values()];
  };
  const otherElements = [drawer, ...drawer.querySelectorAll('*')].filter(el => el !== shown && !shown.contains(el));
  const before = {box:box(shown), type:type(shown), lines:lines(shown), others:otherElements.map(box)};
  if (keyboard) { shown.focus({preventScroll:true}); shown.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); }
  else shown.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  // EditableText schedules its attached height fit and focus in queueMicrotask.
  await new Promise(queueMicrotask);
  const field = drawer.querySelector('textarea');
  const style = getComputedStyle(field);
  const mirror = document.createElement('p');
  for (const p of properties) mirror.style.setProperty(p, style.getPropertyValue(p));
  mirror.style.cssText += ';position:absolute;visibility:hidden;width:' + box(field).width + 'px';
  mirror.textContent = field.value; document.body.appendChild(mirror);
  const fieldLines = lines(mirror);
  mirror.textContent = "M\nM"; const two = mirror.getBoundingClientRect().height;
  mirror.textContent = "M"; const lineHeight = two - mirror.getBoundingClientRect().height; mirror.remove();
  const after = {box:box(field),type:type(field),lines:fieldLines,others:otherElements.map(box),
    lineCount:field.scrollHeight / lineHeight,scrollHeight:field.scrollHeight,clientHeight:field.clientHeight,
    scrollWidth:field.scrollWidth,clientWidth:field.clientWidth,overflow:style.overflow};
  return {name,worst,keyboard,before,after,checks:window.__checks()};
}`;
