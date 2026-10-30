type Alignment = { row: string; inset: number; expected: number };

type Reading = string | { pressFeedback: string } | { controls: number; feedback: string } | { rows: number; cue?: string } | { cue: string; rule: string } | { expected: number; readings: Alignment[] };

const result = <Value extends Reading>(value: Value, selector = "", ok = true) => ({ status: ok ? "pass" as const : "fail" as const, value, selector });


const visible = (el: Element) => !el.closest('[hidden], [aria-hidden=true]') && el.getBoundingClientRect().width > 0;

const nameOf = (el: Element) => `${el.tagName.toLowerCase()}.${el.classList[0] ?? ""}`;

/** U133: inspect the instant Token recipe without dispatching input or changing the page. */
export function pressCheck(doc: Document, rules: CSSStyleRule[]) {
  const view = doc.defaultView!;

  const controls = [...doc.querySelectorAll('button, a[href], summary, input:is([type=checkbox], [type=radio], [type=range]), [role=button], [role=tab], [role=treeitem], [role=menuitem], [role=option]')]
    .filter(el => !el.closest(':disabled, [aria-disabled=true], [data-disabled], [hidden], [aria-hidden=true], [data-dnd-dragging], [data-dnd-placeholder], .xterm, [contenteditable=true]'));

  const feedback = rules.filter(rule => rule.selectorText.includes('[data-pressed="true"]') || rule.selectorText.includes("input:active"));

  for (const el of controls) {
    const owner = el.matches("input") ? el.closest(".app-checkbox, .app-radio, .app-switch, .app-segment") ?? el : el;

    const covered = feedback.some(rule => {
      if (rule.style.opacity !== "var(--press-opacity)") return false;

      if (owner !== el && !rule.selectorText.includes(":has(input")) return false;
      const selector = rule.selectorText.replaceAll('[data-pressed="true"]', ":where(*)").replaceAll(":active", ":where(*)");

      try { return owner.matches(selector) && (rule.style.transition === "none" || view.getComputedStyle(owner).transitionDuration.split(",").every(value => parseFloat(value) === 0)); } catch { return false; }
    });

    if (!covered) return result({ pressFeedback: "missing" }, nameOf(owner), false);
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

    const forbidden = ["outline", "outline-width", "outline-offset", "box-shadow", "font-weight", "font-size", "line-height", "transform", "translate", "border", "border-width", "border-radius", "margin", "padding", "opacity", "width", "height", "gap", "filter"]
      .find(property => {
        const value = rule.style.getPropertyValue(property);
        // Dnd's geometry follows the pointer; authored state decoration still has to pass.
        const gesture = ["transform", "translate", "width", "height"].includes(property) && value.includes("var(--dnd-");

        return value && !gesture && !["none", "0", "0px", "1", "unset", "inherit", "revert"].includes(value);
      });

    const reset = new Set(["", "none", "transparent", "unset", "inherit", "revert", "initial"]);
    const ground = rule.style.backgroundImage || rule.style.backgroundColor;
    const ink = rule.style.color;

    if (forbidden || (!reset.has(ground) && !reset.has(ink))) return result({ cue: forbidden ?? "ink and ground", rule: rule.selectorText }, nameOf(matching[0]!), false);
  }

  return result({ rows: rows.length, cue: "one selected wash; Kind ink retained" });
}

/** U131 horizontal inset; U86 delegates optical x-height centring to the critic. */
export function rowAlignmentCheck(doc: Document) {
  const view = doc.defaultView!;
  const names = [...doc.querySelectorAll('.rail-row .name, .rail-fold-name, .shelf-row .shelf-title, .terminal-tab-name')].filter(el => !el.closest('[hidden], [aria-hidden=true]'));
  const laidOut = names.filter(visible);

  if (names.length && !laidOut.length) return result("not measurable", "", false);

  if (!laidOut.length) return result({ rows: 0 });
  const expected = parseFloat(view.getComputedStyle(doc.documentElement).getPropertyValue("--row-text-inset"));
  const readings: Alignment[] = [];

  for (const name of laidOut) {
    const row = name.closest('.rail-row, .rail-fold, .shelf-row, .terminal-tab-pair')!;
    const rowStyle = view.getComputedStyle(row);
    const rail = row.matches(".rail-row, .rail-fold");

    const indent = rail ? parseFloat(rowStyle.gridTemplateColumns) - parseFloat(rowStyle.getPropertyValue("--rail-inset"))
      : row.matches('.todo-list [role=treeitem]') ? Math.max(0, Number(row.getAttribute("aria-level")) - 1) * parseFloat(rowStyle.getPropertyValue("--tree-step")) : 0;

    const panel = row.closest(".shelf") ?? row;
    const inset = name.getBoundingClientRect().left - panel.getBoundingClientRect().left - indent;
    const overviewLabel = rail ? row.closest(".rail")?.querySelector(".overview-tile + span") : null;
    const target = overviewLabel ? overviewLabel.getBoundingClientRect().left - row.getBoundingClientRect().left : expected;
    readings.push({ row: nameOf(row), inset, expected: target });

    if (!Number.isFinite(inset) || !Number.isFinite(target) || Math.abs(inset - target) > 1) return result({ expected: target, readings }, nameOf(row), false);
  }

  return result({ expected, readings });
}
