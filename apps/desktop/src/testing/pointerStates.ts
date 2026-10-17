// U133: jsdom never enters :hover, :active or :focus-visible, so a test drives a state by copying every stylesheet rule with the pseudo-class swapped for an attribute and setting that attribute: the cascade then answers as it would in a browser.
export type PointerState = "hover" | "pressed" | "focus";

const ATTRIBUTE: Record<PointerState, string> = { hover: "data-state-hover", pressed: "data-state-pressed", focus: "data-state-focus" };

const swapped = (css: string) => css.replaceAll(":hover", `[${ATTRIBUTE.hover}]`).replaceAll(":active", `[${ATTRIBUTE.pressed}]`).replaceAll(":focus-visible", `[${ATTRIBUTE.focus}]`);

/** Rewrites every `<style>` on the page in place, so jsdom's own `:hover`, `:active` and `:focus` never match beside the attribute; the returned function restores the text. Call it after the screen is mounted, so the component stylesheets are in. */
export const driveStates = (doc: Document = document): (() => void) => {
  const originals = [...doc.querySelectorAll("style")].map((sheet) => ({ sheet, text: sheet.textContent ?? "" }));

  for (const { sheet, text } of originals) sheet.textContent = swapped(text);

  return () => {
    for (const { sheet, text } of originals) sheet.textContent = text;
  };
};

const PROPERTIES = ["color", "background-color", "background-image", "outline-width", "outline-style", "outline-color", "outline-offset", "cursor", "transition-duration", "min-height"];

const snapshotOf = (el: Element): CSSStyleDeclaration => {
  // A snapshot: a live declaration would follow the attribute removed by the caller.
  const snapshot = document.createElement("div").style;
  const computed = getComputedStyle(el);

  for (const property of PROPERTIES) snapshot.setProperty(property, computed.getPropertyValue(property));

  return snapshot;
};

/** A snapshot of `el`'s computed style with `state` on and the state attribute removed after; `rest` is the style with none. */
export const styleIn = (el: Element, state: PointerState | "rest"): CSSStyleDeclaration => stylesIn([el], state)[0]!;

/** `styleIn` for many elements at once: jsdom drops its style cache on every attribute change, so one change per state, not per element, computes each ancestor once. Elements nested in one another share the state. */
const stylesIn = (els: readonly Element[], state: PointerState | "rest"): CSSStyleDeclaration[] => {
  if (state !== "rest") for (const el of els) el.setAttribute(ATTRIBUTE[state], "");

  const snapshots = els.map(snapshotOf);

  if (state !== "rest") for (const el of els) el.removeAttribute(ATTRIBUTE[state]);

  return snapshots;
};

/** The selectors of the rules that apply to `el` in `state` and set an outline. */
export const outlineRulesIn = (el: Element, state: "focus"): string[] => {
  el.setAttribute(ATTRIBUTE[state], "");

  const found = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .flatMap((rule) => {
      // SAFETY: a rule with `selectorText` is a CSSStyleRule.
      const styleRule = "selectorText" in rule ? (rule as CSSStyleRule) : null;

      return styleRule && rule.cssText.includes(ATTRIBUTE[state]) && /outline/.test(rule.cssText) && styleRule.selectorText.split(",").some((selector) => el.matches(selector.trim())) ? [styleRule.selectorText] : [];
    });

  el.removeAttribute(ATTRIBUTE[state]);

  return found;
};
