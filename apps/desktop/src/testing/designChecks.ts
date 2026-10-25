type Alignment = { row: string; inset: number; baseline: number | null };

type Reading = string | { press: string } | { controls: number; feedback: string } | { rows: number; cue?: string } | { cue: string; rule: string } | { expected: number; readings: Alignment[] };

const result = <Value extends Reading>(value: Value, selector = "", ok = true) => ({ status: ok ? "pass" as const : "fail" as const, value, selector });


const visible = (el: Element) => !el.closest('[hidden], [aria-hidden=true]') && el.getBoundingClientRect().width > 0;

const nameOf = (el: Element) => `${el.tagName.toLowerCase()}.${el.classList[0] ?? ""}`;

/** U133: inspect the instant Token recipe without dispatching input or changing the page. */
export function pressCheck(doc: Document, rules: CSSStyleRule[]) {
  const view = doc.defaultView!;

  const controls = [...doc.querySelectorAll('button, a[href], summary, input:is([type=checkbox], [type=radio], [type=range]), [role=button], [role=tab], [role=treeitem], [role=menuitem], [role=option]')]
    .filter(el => !el.closest(':disabled, [aria-disabled=true], [data-disabled], .xterm, [contenteditable=true]'));

  const feedback = rules.filter(rule => rule.selectorText.includes('[data-pressed="true"]') || rule.selectorText.includes("input:active"));

  for (const el of controls) {
    const owner = el.matches("input") ? el.closest(".app-checkbox, .app-radio, .app-segment") ?? el : el;

    const covered = feedback.some(rule => {
      if (rule.style.opacity !== "var(--press-opacity)") return false;

      if (owner !== el && !rule.selectorText.includes(":has(input")) return false;
      const selector = rule.selectorText.replaceAll('[data-pressed="true"]', ":where(*)").replaceAll(":active", ":where(*)");

      try { return owner.matches(selector) && (rule.style.transition === "none" || view.getComputedStyle(owner).transitionDuration.split(",").every(value => parseFloat(value) === 0)); } catch { return false; }
    });

    if (!covered) return result({ press: "missing instant visible Token feedback" }, nameOf(owner), false);
  }

  return result({ controls: controls.length, feedback: "instant Token recipe; frame readings in paired observer" });
}

/** U133: state selectors may add one wash or ink cue, never shape or a second cue. */
export function rowCueCheck(doc: Document, rules: CSSStyleRule[]) {
  const rows = [...doc.querySelectorAll('.rail-row, .shelf-row')];
  const state = /\[data-(?:selected|lifted|dnd-dragging)(?:="true")?\]|:focus-visible|:has\(:focus-visible\)/g;

  for (const rule of rules) {
    if (!/data-(?:selected|lifted|dnd-dragging)|focus-visible/.test(rule.selectorText)) continue;
    const selector = rule.selectorText.replace(/:has\(:focus-visible\)/g, ":where(*)").replace(state, ":where(*)");
    let matching: Element[];

    try { matching = rows.filter(row => row.matches(selector)); } catch { continue; }

    if (!matching.length) continue;

    const forbidden = ["outline", "outline-width", "box-shadow", "font-weight", "transform", "translate", "border-width", "border-radius", "margin", "padding", "opacity"]
      .find(property => { const value = rule.style.getPropertyValue(property);

 return value && !["none", "0", "0px", "1"].includes(value); });

    const ground = rule.style.backgroundImage || rule.style.backgroundColor;
    const ink = rule.style.color;

    if (forbidden || (ground && ground !== "none" && ground !== "transparent" && ink)) return result({ cue: forbidden ?? "ink and ground", rule: rule.selectorText }, nameOf(matching[0]!), false);
  }

  return result({ rows: rows.length, cue: "one selected wash; Kind ink retained" });
}

/** U131: local title offsets and visible Glyph edge against the first-line font baseline. */
export function rowAlignmentCheck(doc: Document) {
  const view = doc.defaultView!;
  const names = [...doc.querySelectorAll('.rail-row .name, .shelf-row .shelf-title, .terminal-tab-name')].filter(el => !el.closest('[hidden], [aria-hidden=true]'));
  const laidOut = names.filter(visible);

  if (names.length && !laidOut.length) return result("not measurable", "", false);

  if (!laidOut.length) return result({ rows: 0 });
  const context = doc.createElement("canvas").getContext("2d");

  if (!context) return result("not measurable", "", false);
  const expected = parseFloat(view.getComputedStyle(doc.documentElement).getPropertyValue("--row-text-inset"));
  const readings: Alignment[] = [];

  for (const name of laidOut) {
    const row = name.closest('.rail-row, .shelf-row, .terminal-tab-pair')!;
    const style = view.getComputedStyle(name);
    const rowStyle = view.getComputedStyle(row);
    const rail = row.matches(".rail-row");

    const indent = rail ? parseFloat(rowStyle.gridTemplateColumns) - parseFloat(rowStyle.getPropertyValue("--rail-inset"))
      : row.matches('.todo-list [role=treeitem]') ? Math.max(0, Number(row.getAttribute("aria-level")) - 1) * parseFloat(rowStyle.getPropertyValue("--space-4")) : 0;

    const inset = name.getBoundingClientRect().left - row.getBoundingClientRect().left - indent;
    const range = doc.createRange();
    range.selectNodeContents(name);
    const first = range.getClientRects()[0];
    const glyph = row.querySelector<SVGGraphicsElement>(".glyph[data-drawing] svg");
    let delta: number | null = null;

    if (glyph && first) {
      context.font = style.font;
      const metrics = context.measureText(name.textContent ?? "");
      const baseline = first.top + (first.height - metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2 + metrics.fontBoundingBoxAscent;
      const mark = glyph.querySelector("circle") ?? glyph;
      const box = mark.getBBox();
      const matrix = mark.getScreenCTM();

      if (!matrix) return result("not measurable", nameOf(row), false);
      const stroke = parseFloat(view.getComputedStyle(mark).strokeWidth) / 2;
      const edge = new DOMPoint(box.x, box.y + box.height + stroke).matrixTransform(matrix).y;
      delta = edge - baseline;
    }

    readings.push({ row: nameOf(row), inset, baseline: delta });

    if (!Number.isFinite(inset) || !Number.isFinite(expected) || Math.abs(inset - expected) > 1 || (delta !== null && (!Number.isFinite(delta) || Math.abs(delta) > 1))) return result({ expected, readings }, nameOf(row), false);
  }

  return result({ expected, readings });
}
