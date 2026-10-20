// U137: the one module that measures D1 to D14 (docs/design-system.md, "The checks"). `window.__checks()` on the harness page and the u130_ to u137_ tests call it, so a check has one implementation.
// It reads computed style, stylesheet text and the DOM and writes nothing: a hover, press or focus style is read from the stylesheet rules that would apply, never by driving the page into that state.
import { contrastRgb } from "./contrast";
import { inlineStyleCss, lookLiterals } from "./lookLiterals";

export const CHECK_IDS = ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D16"] as const;

export type CheckId = (typeof CHECK_IDS)[number];

/** One entry of a `checks.json` file, the shape `loop/rules.sh delta` reads (L42). */
export type Check = { status: "pass" | "fail"; value: unknown; selector: string };

export type Checks = Record<CheckId, Check>;

const NOT_MEASURABLE = "not measurable";

const TYPE_STEPS = new Set([11, 12, 13, 14, 15]);

const SPACE_STEPS = new Set([0, 4, 8, 12, 16, 24, 32]);

// docs/motion.md, in seconds. `0` is an instant change.
const MOTION_SECONDS = [0, 0.12, 0.15, 0.18, 0.25, 0.4];

const CLICK_TARGET = "button, a[href], input, select, textarea, summary, [role=button], [role=treeitem], [role=tab]";

type Rgba = { r: number; g: number; b: number; a: number };

const parseColour = (value: string): Rgba | null => {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];

  if (hex) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };

  const parts = /^rgba?\(([^)]+)\)$/.exec(value.trim())?.[1]?.split(/[\s,/]+/).filter(Boolean).map(Number);

  if (!parts || parts.length < 3 || parts.some(Number.isNaN)) return null;

  return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
};

const toHex = ({ r, g, b }: Rgba): string => `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;

const saturation = ({ r, g, b }: Rgba): number => {
  const [max, min] = [Math.max(r, g, b) / 255, Math.min(r, g, b) / 255];
  const lightness = (max + min) / 2;

  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
};

const over = (top: Rgba, ground: Rgba): Rgba => ({
  r: top.r * top.a + ground.r * (1 - top.a),
  g: top.g * top.a + ground.g * (1 - top.a),
  b: top.b * top.a + ground.b * (1 - top.a),
  a: 1,
});

const px = (value: string): number | null => (/^-?[\d.]+px$/.test(value.trim()) ? Number.parseFloat(value) : value.trim() === "0" ? 0 : null);

const seconds = (value: string): number[] =>
  value.split(",").map((part) => part.trim()).filter(Boolean).map((part) => (part.endsWith("ms") ? Number.parseFloat(part) / 1000 : Number.parseFloat(part)));

const selectorOf = (el: Element): string => {
  const id = el.getAttribute("data-id");

  return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${el.classList[0] ? `.${el.classList[0]}` : ""}${id ? `[data-id="${id}"]` : ""}`;
};

type Measure = { ok: boolean; value: unknown; selector: string };

type Page = {
  doc: Document;
  view: Window;
  elements: Element[];
  rules: CSSStyleRule[];
  states: Map<":hover" | ":active" | ":focus-visible", CSSStyleRule[]>;
  style: (el: Element) => CSSStyleDeclaration;
  token: (name: string) => string | undefined;
  resolve: (value: string) => string;
};

const styleRulesOf = (doc: Document): CSSStyleRule[] => {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    // SAFETY: a rule with `selectorText` is a CSSStyleRule, and one with `cssRules` is a grouping rule.
    [...rules].flatMap((rule) => ("selectorText" in rule ? [rule as CSSStyleRule] : "cssRules" in rule ? walk((rule as CSSGroupingRule).cssRules) : []));

  return [...doc.styleSheets].flatMap((sheet) => {
    try {
      return walk(sheet.cssRules);
    } catch {
      return [];
    }
  });
};

const rootTokens = (rules: CSSStyleRule[]): Map<string, string> => {
  const tokens = new Map<string, string>();

  for (const rule of rules)
    if (rule.selectorText.trim() === ":root") for (const [, name, value] of rule.cssText.matchAll(/--([\w-]+):\s*([^;}]+)/g)) tokens.set(name!, value!.trim());

  return tokens;
};

const pageOf = (doc: Document): Page => {
  const view = doc.defaultView!;
  // #2020 measured 186 stylesheet traversals per Check call, with D6/D7 taking 1,292 ms under contention.
  const rules = styleRulesOf(doc);
  const tokens = rootTokens(rules);
  const rootStyle = view.getComputedStyle(doc.documentElement);
  const token = (name: string) => rootStyle.getPropertyValue(`--${name}`).trim() || tokens.get(name);
  const resolve = (value: string): string => value.replace(/var\(--([\w-]+)\)/g, (whole, name: string) => token(name) ?? whole);
  // #1679 measured 3,300 style reads for 139 elements; keeping observations within this call avoids repeated declaration cloning.
  const styles = new Map<Element, CSSStyleDeclaration>([[doc.documentElement, rootStyle]]);

  const style = (el: Element) => {
    let computed = styles.get(el);

    if (!computed) {
      computed = view.getComputedStyle(el);
      styles.set(el, computed);
    }

    return computed;
  };

  // An element inside a `display: none` ancestor has no layout, so no check can read it.
  const visible = (el: Element): boolean => !el.closest("[hidden], [aria-hidden=true]") && style(el).display !== "none" && !(el.parentElement && el.parentElement !== doc.body && !visible(el.parentElement));

  return { doc, view, rules, states: new Map(), elements: [...doc.body.querySelectorAll("*")].filter((el) => !/^(SCRIPT|STYLE)$/.test(el.tagName) && visible(el)), style, token, resolve };
};

const inTerminal = (el: Element) => el.closest(".xterm, [data-terminal]") !== null;

// A rule whose every selector's subject is inside the terminal (xterm's own stylesheet) is exempt, as `inTerminal` exempts its elements.
// Functional pseudo-classes (`:has()`, `:not()`) and anything before a sibling combinator do not place the subject.
const terminalRule = (selectorText: string) => {
  // Quoted strings and attribute selectors (bar `[data-terminal]`) carry no subject, and may hold commas or `.xterm`.
  const plain = selectorText.replace(/"[^"]*"|'[^']*'/g, "").replace(/\[(?!data-terminal\])[^\]]*\]/g, "");
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === "(") depth++;
    else if (plain[i] === ")") depth--;
    else if (plain[i] === "," && depth === 0) {
      parts.push(plain.slice(start, i));
      start = i + 1;
    }
  }

  parts.push(plain.slice(start));

  return parts.every((part) => {
    let bare = part;

    for (let before = ""; before !== bare; ) {
      before = bare;
      bare = bare.replace(/:[\w-]+\([^()]*\)/g, "");
    }

    return /\.xterm|\[data-terminal\]/.test(bare.split(/[+~]/).pop()!);
  });
};

const colourProperties = ["color", "background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"] as const;

// D1: nothing but a Token read supplies a colour, font size, radius, shadow or duration.
const d1 = ({ doc, elements, rules }: Page): Measure => {
  const tokenSheets = new Set([...doc.querySelectorAll<HTMLStyleElement>('style[data-vite-dev-id$="/src/tokens.css"]')].map(el => el.sheet));

  // CSSOM serializes the permitted unitless zero radius as `0px`; keep nonzero radii in the literal scan.
  const found = rules
    .filter((rule) => !tokenSheets.has(rule.parentStyleSheet) && !terminalRule(rule.selectorText))
    .flatMap((rule) => lookLiterals(rule.cssText.slice(rule.cssText.indexOf("{")).replace(/(border(?:-[\w]+)?-radius:\s*)0px\b/g, "$10")).map((literal) => ({ selector: rule.selectorText, literal })));

  const inline = elements.flatMap((el) => lookLiterals(inlineStyleCss(`style={{${(el.getAttribute("style") ?? "").split(";").filter(Boolean).map((pair) => pair.replace(/^\s*([^:]+):\s*(.*)$/, '"$1": "$2"')).join(",")}}}`)).map((literal) => ({ selector: selectorOf(el), literal })));
  const all = [...found, ...inline];

  return { ok: all.length === 0, value: all.map((one) => one.literal), selector: all[0]?.selector ?? "" };
};

const offender = (page: Page, test: (el: Element, style: CSSStyleDeclaration) => object | typeof NOT_MEASURABLE | null): Measure => {
  const hit = page.elements.map((el) => ({ el, found: test(el, page.style(el)) })).find((one) => one.found);

  return { ok: !hit, value: hit ? hit.found : [], selector: hit ? selectorOf(hit.el) : "" };
};

// D2: type and space steps, with only U2541’s Token-backed KeyChip side padding excepted.
const d2 = (page: Page): Measure =>
  offender(page, (el, style) => {
    if (inTerminal(el)) return null;

    const size = px(page.resolve(style.fontSize));

    if (size !== null && !TYPE_STEPS.has(size)) return { fontSize: style.fontSize };

    const chip = el.matches("kbd.key-chip");
    const chipPadding = px(page.token("key-chip-padding") ?? "");

    for (const property of ["margin-top", "margin-right", "margin-bottom", "margin-left", "padding-top", "padding-right", "padding-bottom", "padding-left", "row-gap", "column-gap"]) {
      const value = px(page.resolve(style.getPropertyValue(property)));

      // D1 checks declaration provenance; D2 checks the rendered Token value and
      // the complete chip padding so an on-scale but nonconforming chip also fails.
      const chipSide = chip && (property === "padding-left" || property === "padding-right");
      const chipVertical = chip && (property === "padding-top" || property === "padding-bottom");
      const conforms = chipSide ? chipPadding === 5 && value === chipPadding : chipVertical ? value === 0 : value === null || SPACE_STEPS.has(value);

      if (!conforms) return { [property]: style.getPropertyValue(property) };
    }

    return null;
  });

// jsdom leaves variables unresolved and omits inherited custom properties. Resolve at
// the defining ancestor so a root alias cannot accidentally read a descendant override.
const resolveAt = (page: Page, el: Element, value: string, depth = 0): string => {
  if (depth > 20) throw new Error("cyclic colour Token");

  return value.replace(/var\(--([\w-]+)\)/g, (whole, name: string) => {
    for (let node: Element | null = name.startsWith("root-") ? page.doc.documentElement : el; node; node = node.parentElement) {
      const declared = page.style(node).getPropertyValue(`--${name}`).trim();

      if (declared) return resolveAt(page, node, declared, depth + 1);
    }

    return page.token(name) ? resolveAt(page, page.doc.documentElement, page.token(name)!, depth + 1) : whole;
  });
};

const colourTokens = (page: Page, el: Element): Rgba[] | null => {
  const read = ["red", "amber", "accent"].map((name) => parseColour(resolveAt(page, el, `var(--${name})`)));

  // SAFETY: `every(Boolean)` has just shown no entry is null.
  return read.every(Boolean) ? (read as Rgba[]) : null;
};

const sameColour = (a: Rgba, b: Rgba) => toHex(a) === toHex(b);

// D3: a saturated colour is red, amber or accent; with no error or needs-you row on screen, no red or amber.
const d3 = (page: Page): Measure => {
  const calm = page.elements.every((el) => !/^(error|needs-you)$/i.test(el.getAttribute("aria-label") ?? "") && !/error|needs-you/.test(el.getAttribute("data-kind") ?? ""));

  return offender(page, (el, style) => {
    const allowed = colourTokens(page, el);

    if (!allowed) return { colour: NOT_MEASURABLE };
    const red = allowed[0]!;
    const amber = allowed[1]!;

    for (const property of colourProperties) {
      const colour = parseColour(resolveAt(page, el, style.getPropertyValue(property)));

      if (!colour || colour.a === 0) continue;

      if (saturation(colour) > 0.15 && !allowed.some((token) => sameColour(token, colour))) return { [property]: style.getPropertyValue(property) };

      if (calm && (sameColour(red, colour) || sameColour(amber, colour))) return { [property]: style.getPropertyValue(property), calm: true };
    }

    return null;
  });
};

// D4: every Rail, Shelf and Drawer row draws a Glyph, so no Kind is carried by colour alone.
const d4 = ({ doc }: Page): Measure => {
  const rows = [...doc.querySelectorAll("[role=treeitem][data-id], aside li, aside [role=listitem]")].filter((row) => !row.closest(".milkdown-slash-menu") || row.matches("[data-id], [role=listitem], [role=treeitem]"));
  const bare = rows.find((row) => !row.querySelector(".glyph svg, .glyph"));

  return { ok: !bare, value: { rows: rows.length }, selector: bare ? selectorOf(bare) : "" };
};

const uniformLayer = (page: Page, el: Element): Rgba | null => {
  const image = resolveAt(page, el, page.style(el).backgroundImage);
  const wash = /^linear-gradient\((rgba?\([^)]+\)),\s*\1\)$/.exec(image)?.[1];

  return wash ? parseColour(wash) : null;
};

// U353: one non-repeating uniform layer smaller than the box is a focus mark,
// whether the focused control or its containing box draws it.
const focusMark = (page: Page, el: Element): Rgba | null => {
  if (!el.matches(":focus-visible, :has(:focus-visible)")) return null;
  const style = page.style(el);

  if (style.backgroundRepeat !== "no-repeat") return null;
  const size = resolveAt(page, el, style.backgroundSize).trim().split(/\s+/);

  if (size.length !== 2) return null;
  const box = el.getBoundingClientRect();
  const extent = (value: string, length: number) => value.endsWith("%") ? Number(value.slice(0, -1)) * length / 100 : px(value);
  const width = extent(size[0]!, box.width);
  const height = extent(size[1]!, box.height);

  if (width === null || height === null || !(width > 0 && width <= box.width && height > 0 && height <= box.height)) return null;

  if (width === box.width && height === box.height) return null;

  return uniformLayer(page, el);
};

const groundOf = (page: Page, el: Element, outline = false): Rgba | null => {
  let ground: Rgba = parseColour(page.token("ground") ?? "") ?? { r: 255, g: 255, b: 255, a: 1 };
  const chain: Element[] = [];
  const offset = outline ? px(page.style(el).outlineOffset) ?? 0 : 0;
  const width = outline ? px(page.style(el).outlineWidth) ?? 0 : 0;
  const outside = outline && width > 0 && offset >= 0;
  const inset = outline && width > 0 ? Math.max(0, -offset - width) : 0;

  for (let node: Element | null = el; node; node = node.parentElement) chain.unshift(node);

  for (const node of chain) {
    // An outer outline paints on the surrounding ground, not its own box's wash or mark.
    if (outside && node === el) continue;

    const background = parseColour(resolveAt(page, node, page.style(node).backgroundColor));

    if (background && background.a > 0) ground = over(background, ground);

    // A uniform Token wash paints above the opaque box (U441).
    const image = resolveAt(page, node, page.style(node).backgroundImage);
    const layer = uniformLayer(page, node);

    if (layer) {
      const style = page.style(node);
      const size = resolveAt(page, node, style.backgroundSize);
      const full = !size || size === "auto" || size === "auto auto" || size === "100% 100%";

      if (full) ground = over(layer, ground);
      else if (!focusMark(page, node)) return null;
    } else if (image && image !== "none") {
      // U137: only a full wash behind a leading mark has one ground at the text.
      // CSSOM supplies the parsed values; unsupported paint geometry must not pass D5.
      const compound = /^linear-gradient\((rgba?\([^)]+\)),\s*\1\),\s*linear-gradient\((rgba?\([^)]+\)),\s*\2\)$/.exec(image);
      const style = page.style(node);
      const sizes = style.backgroundSize.split(",").map(value => value.trim());
      const positions = style.backgroundPosition.split(",").map(value => value.trim());
      const repeats = style.backgroundRepeat.split(",").map(value => value.trim());
      const origins = style.backgroundOrigin.split(",").map(value => value.trim());
      const clips = style.backgroundClip.split(",").map(value => value.trim());
      const mark = sizes[0]?.match(/^(\d+(?:\.\d+)?)px 100%$/)?.[1];
      const box = node.getBoundingClientRect();
      const range = page.doc.createRange();
      range.selectNodeContents(el);
      const directText = !outline && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent?.trim());
      const bounds = el.getBoundingClientRect();
      const content = directText ? range.getBoundingClientRect?.() ?? bounds : bounds;
      const clipX = /^(hidden|clip|auto|scroll)$/.test(page.style(el).overflowX);
      const clipY = /^(hidden|clip|auto|scroll)$/.test(page.style(el).overflowY);

      const text = {
        left: clipX ? Math.max(content.left, bounds.left) : content.left,
        right: clipX ? Math.min(content.right, bounds.right) : content.right,
        top: clipY ? Math.max(content.top, bounds.top) : content.top,
        bottom: clipY ? Math.min(content.bottom, bounds.bottom) : content.bottom,
      };

      const left = box.left + (px(style.borderLeftWidth) ?? 0);
      const wash = compound?.[2] ? parseColour(compound[2]) : null;

      if (!wash || !mark || sizes.length !== 2 || sizes[1] !== "auto" ||
          positions.some(value => value !== "0% 0%") || repeats.some(value => value !== "no-repeat") ||
          origins.some(value => value !== "padding-box") || clips.some(value => value !== "border-box") ||
          style.backgroundBlendMode.split(",").some(value => value.trim() !== "normal") ||
          style.backgroundAttachment.split(",").some(value => value.trim() !== "scroll") ||
          text.left + inset < left + Number(mark) || text.right - inset > box.right || text.top + inset < box.top || text.bottom - inset > box.bottom) return null;

      ground = over(wash, ground);
    }
  }

  return ground;
};

// D5: text 4.5:1, a Glyph tone and a focus ring 3:1 against their own ground; `done` is exempt (U4).
const d5 = (page: Page): Measure => {
  let measurable = true;

  const ratio = (el: Element, property: string) => {
    const colour = parseColour(resolveAt(page, el, page.style(el).getPropertyValue(property)));

    if (!colour) return null;

    const ground = groundOf(page, el, property === "outline-color");

    return ground ? contrastRgb(over(colour, ground), ground) : NOT_MEASURABLE;
  };

  const ink = (el: Element) => [...el.childNodes].some((node) => node.nodeType === 3 && (node.textContent ?? "").trim() !== "");
  const focused = page.doc.activeElement && page.doc.activeElement !== page.doc.body && page.style(page.doc.activeElement).outlineStyle !== "none" && (px(page.style(page.doc.activeElement).outlineWidth) ?? 0) > 0 ? page.doc.activeElement : null;

  const result = offender(page, (el) => {
    if (el.matches(".glyph") && el.closest('[aria-label="Done"]') === null && !el.querySelector('[aria-label="Done"]')) {
      const found = ratio(el, "color");

      if (found === NOT_MEASURABLE) return NOT_MEASURABLE;

      if (found !== null && found < 3) return { glyph: found };
    } else if (ink(el)) {
      const found = ratio(el, "color");

      if (found === NOT_MEASURABLE) return NOT_MEASURABLE;

      if (found !== null && found < 4.5) return { text: found };
    }

    const mark = focusMark(page, el);

    if (mark) {
      const ground = groundOf(page, el);

      if (!ground) measurable = false;
      else {
        const found = contrastRgb(over(mark, ground), ground);

        if (found < 3) return { focusRing: found };
      }
    }

    if (el === focused) {
      const found = ratio(el, "outline-color");

      if (found === NOT_MEASURABLE) return NOT_MEASURABLE;

      if (found !== null && found < 3) return { focusRing: found };
    }

    return null;
  });

  return !measurable && result.ok ? { ok: false, value: NOT_MEASURABLE, selector: "" } : result;
};

// A rule that applies to `el` once its state pseudo-class is true: the selector without the pseudo-class matches it.
const stateRules = (page: Page, el: Element, pseudo: ":hover" | ":active" | ":focus-visible") => {
  let rules = page.states.get(pseudo);

  if (!rules) {
    rules = page.rules.filter((rule) => rule.selectorText.includes(pseudo));
    page.states.set(pseudo, rules);
  }

  return rules.filter((rule) =>
    rule.selectorText.split(",").some((selector) => {
      if (!selector.includes(pseudo)) return false;

      const bare = selector.split(pseudo).join("").trim() || "*";

      try {
        return el.matches(bare);
      } catch {
        return false;
      }
    }),
  );
};

const declares = (rules: CSSStyleRule[], ...properties: string[]) => rules.some((rule) => properties.some((property) => rule.style.getPropertyValue(property) !== ""));

const clickTargets = (page: Page) => page.elements.filter((el) => el.matches(CLICK_TARGET) && !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true");

// U353: a text field answers with a caret and a focus mark, so D6's hover and cursor and D7's pressed style do not apply to it.
const pressable = (page: Page) => clickTargets(page).filter((el) => el.tagName !== "TEXTAREA" && !el.matches("input[type=text]"));

// D6: each click target has a hover and a focus style, a pointer cursor (`grab` on a reorderable row) and a hit area of at least 24 px.
const d6 = (page: Page): Measure => {
  const targets = pressable(page);
  let measured = 0;

  for (const el of targets) {
    const style = page.style(el);
    const height = Math.max(el.getBoundingClientRect().height, px(page.resolve(style.height)) ?? 0, px(page.resolve(style.minHeight)) ?? 0);

    if (height > 0) measured += 1;

    if (height > 0 && height < 24) return { ok: false, value: { height }, selector: selectorOf(el) };

    if (!declares(stateRules(page, el, ":hover"), "background", "background-color", "background-image", "color")) return { ok: false, value: { missing: "hover" }, selector: selectorOf(el) };

    if (!declares(stateRules(page, el, ":focus-visible"), "outline", "outline-color", "box-shadow")) return { ok: false, value: { missing: "focus" }, selector: selectorOf(el) };

    // U155: a Todo row can be dragged, so its cursor is `grab`.
    if (style.cursor !== (el.hasAttribute("data-reorderable") ? "grab" : "pointer")) return { ok: false, value: { cursor: style.cursor }, selector: selectorOf(el) };
  }

  return targets.length > 0 && measured === 0 ? { ok: false, value: NOT_MEASURABLE, selector: "" } : { ok: true, value: { targets: targets.length }, selector: "" };
};

// D7: each click target's pressed style differs from hover and has a transition of 0s.
const d7 = (page: Page): Measure => {
  for (const el of pressable(page)) {
    const pressed = stateRules(page, el, ":active");
    const hover = stateRules(page, el, ":hover");
    const paint = (rules: CSSStyleRule[]) => rules.map((rule) => `${rule.style.getPropertyValue("background")}|${rule.style.getPropertyValue("background-image")}|${rule.style.getPropertyValue("background-color")}|${rule.style.getPropertyValue("color")}`).join(";");
    const instant = pressed.some((rule) => /^0m?s$/.test(rule.style.getPropertyValue("transition-duration").trim() || rule.style.getPropertyValue("transition").trim().split(/\s+/).find((part) => /^[\d.]+m?s$/.test(part)) || ""));

    if (pressed.length === 0 || paint(pressed) === paint(hover) || !instant) return { ok: false, value: { pressed: pressed.length, instant }, selector: selectorOf(el) };
  }

  return { ok: true, value: { targets: pressable(page).length }, selector: "" };
};

// D8: floating menus and the Terminal's control overlay use the Drawer shadow; their descendants retain all surface checks.
const d8 = (page: Page): Measure => {
  return offender(page, (el, style) => {
    const hairline = parseColour(resolveAt(page, el, "var(--hairline)"));

    if (!hairline) return { border: NOT_MEASURABLE };

    for (const side of ["top", "right", "bottom", "left"]) {
      const width = px(style.getPropertyValue(`border-${side}-width`));
      const drawn = style.getPropertyValue(`border-${side}-style`) !== "none" && (width ?? 0) > 0;
      const colour = parseColour(resolveAt(page, el, style.getPropertyValue(`border-${side}-color`)));

      if (drawn && ((width ?? 0) > 1 || !colour || !sameColour(colour, hairline) || Math.abs(colour.a - hairline.a) > 0.01)) return { [`border-${side}`]: `${style.getPropertyValue(`border-${side}-width`)} ${style.getPropertyValue(`border-${side}-color`)}` };
    }

    const shadow = style.boxShadow;

    // Computed shadows put colour first and expand zero lengths; Tokens put colour last.
    const shadowParts = (value: string) => {
      const resolved = resolveAt(page, el, value);
      const colour = resolved.match(/rgba?\([^)]+\)/)?.[0];

      if (!colour) return "";

      const lengths = resolved.replace(colour, "").trim().split(/\s+/).map((part) => /^-?[\d.]+(?:px)?$/.test(part) ? Number.parseFloat(part) : part);

      // Omitted blur and spread lengths compute to zero.
      while (lengths.length < 4) lengths.push(0);

      return JSON.stringify([parseColour(colour), lengths]);
    };

    // U375 requires the Watch overlay to cast the Drawer shadow on its surface.
    const surfaceShadow = el.matches(".milkdown-slash-menu, .pane-control, .worktree-panel, .app-mentions-panel, .owner-picker, .import-panel") && shadowParts(shadow) !== "" && shadowParts(shadow) === shadowParts("var(--shadow-drawer)");

    if (shadow && shadow !== "none" && !surfaceShadow && !el.matches("aside, aside *, .bubble") && el.tagName !== "ASIDE") return { boxShadow: shadow };

    const backdrop = (node: Element) => (page.style(node).getPropertyValue("backdrop-filter") || "none") !== "none";

    if (backdrop(el) && [...el.querySelectorAll("*")].some(backdrop)) return { backdropFilter: "nested" };

    return null;
  });
};

// D9: each duration is within 25% of docs/motion.md; under reduced motion all are 0.
const d9 = (page: Page): Measure => {
  const reduced = page.view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

  return offender(page, (el, style) => {
    const durations = [...seconds(style.transitionDuration), ...seconds(style.animationDuration)].map((duration) => (Number.isNaN(duration) ? 0 : duration));
    const bad = durations.find((duration) => (reduced ? duration !== 0 : !MOTION_SECONDS.some((step) => Math.abs(duration - step) <= step * 0.25)));

    return bad === undefined ? null : { duration: bad, reduced };
  });
};

// D11: the Thread's column is at most `--measure` wide, no line holds more than 120 characters, and every row's text starts at one x within 1 px. A screen with no Thread has nothing to measure and passes.

const THREAD_ROWS = ".thread-header .thread-goal, .thread-row, .thread-sender, .thread-body, .thread-card-body, .thread-card-answer, .thread-card-meta, .thread-composer textarea, .thread-answering";

const MAX_LINE = 120;

const d11 = (page: Page): Measure => {
  const columns = [...page.doc.querySelectorAll<HTMLElement>(".thread-column")].filter((el) => page.elements.includes(el));

  if (columns.length === 0) return { ok: true, value: "no Thread", selector: "" };

  const token = (page.token("measure") ?? "").trim();
  const rem = Number.parseFloat(page.style(page.doc.documentElement).fontSize) || 16;
  const limit = Number.parseFloat(token) * (token.endsWith("rem") ? rem : 1);

  if (Number.isNaN(limit)) return { ok: false, value: NOT_MEASURABLE, selector: "" };

  const wide = columns.find((el) => el.getBoundingClientRect().width > limit + 1);

  if (wide) return { ok: false, value: { column: wide.getBoundingClientRect().width, limit }, selector: selectorOf(wide) };

  const starts = [...page.doc.querySelectorAll<HTMLElement>(THREAD_ROWS)].flatMap((el) =>
    page.elements.includes(el) && el.getBoundingClientRect().width > 0 ? [{ el, x: el.getBoundingClientRect().left + (Number.parseFloat(page.style(el).paddingLeft) || 0) }] : [],
  );

  // A Thread whose rows have no layout (jsdom) cannot be measured: D11 fails, never passes by default.
  if (starts.length === 0) return { ok: false, value: NOT_MEASURABLE, selector: "" };

  const base = starts[0];
  const off = base && starts.find((row) => Math.abs(row.x - base.x) > 1);

  if (off) return { ok: false, value: { x: off.x, expected: base.x }, selector: selectorOf(off.el) };

  let measured = 0;

  for (const el of page.doc.querySelectorAll<HTMLElement>(".thread-goal, .thread-body, .thread-card-body")) {
    const height = el.getBoundingClientRect().height;

    if (height === 0) continue;

    measured += 1;

    const style = page.style(el);

    // U422: a line cut at its box with an ellipsis shows only what the column holds, and the column is already at most `--measure` wide.
    if (style.whiteSpace === "nowrap" && style.overflow === "hidden") continue;

    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    const lines = lineHeight > 0 ? Math.max(1, Math.round(height / lineHeight)) : 1;
    const longest = Math.max(...(el.textContent ?? "").split("\n").map((line) => Math.ceil(line.length / lines)));

    if (longest > MAX_LINE) return { ok: false, value: { characters: longest }, selector: selectorOf(el) };
  }

  const texts = page.doc.querySelectorAll(".thread-goal, .thread-body, .thread-card-body").length;

  return texts > 0 && measured === 0 ? { ok: false, value: NOT_MEASURABLE, selector: "" } : { ok: true, value: { columns: columns.length, limit }, selector: "" };
};

// D12 to D14 (U360): the Shelf's rows. A screen with no Shelf row passes; a row with no layout fails with "not measurable".

const SHELF_LISTS = ["todos", "pads"] as const;

type ShelfRowBox = { row: Element; list: (typeof SHELF_LISTS)[number]; box: DOMRect };

const shelfRows = (page: Page): ShelfRowBox[] =>
  SHELF_LISTS.flatMap((list) =>
    [...page.doc.querySelectorAll(`.shelf section[aria-label="${list}" i] .shelf-row`)].flatMap((row) => (page.elements.includes(row) ? [{ row, list, box: row.getBoundingClientRect() }] : [])),
  );

const measurable = (rows: ShelfRowBox[]) => rows.some(({ box }) => box.width > 0 && box.height > 0);

const widest = (found: { diff: number; row: Element }[]): Measure => {
  const worst = found.reduce<{ diff: number; row: Element } | null>((top, one) => (top === null || one.diff > top.diff ? one : top), null);

  return { ok: !worst || worst.diff <= 1, value: worst?.diff ?? 0, selector: worst ? selectorOf(worst.row) : "" };
};

// D12: Glyphs and titles align after U3708's declared tree indent; later lines start at their own title.
const d12 = (page: Page): Measure => {
  const rows = shelfRows(page);

  if (rows.length === 0) return { ok: true, value: "no Shelf row", selector: "" };

  if (!measurable(rows)) return { ok: false, value: NOT_MEASURABLE, selector: "" };

  const left = (el: Element | null) => el?.getBoundingClientRect().left ?? 0;
  const found: { diff: number; row: Element }[] = [];

  for (const list of SHELF_LISTS) {
    const own = rows.filter((one) => one.list === list);

    const indent = (row: Element) => list === "todos" && row.matches('[role="treeitem"]')
      ? (Number(row.getAttribute("aria-level")) - 1) * parseFloat(page.token("space-4") ?? "0") : 0;

    const glyphs = own.map(({ row }) => left(row.querySelector(".shelf-glyph")?.firstElementChild ?? null) - indent(row));
    const titles = own.map(({ row }) => left(row.querySelector(".shelf-title")) - indent(row));

    own.forEach(({ row }, index) => {
      found.push({ diff: Math.max(...glyphs) - Math.min(...glyphs), row: own[index]!.row });
      found.push({ diff: Math.max(...titles) - Math.min(...titles), row });

      for (const line of [...(row.querySelector(".shelf-text")?.children ?? [])].slice(1)) found.push({ diff: Math.abs(left(line) - left(row.querySelector(".shelf-title"))), row });
    });
  }

  return widest(found);
};

// D13 and D16: in the Shelf and in the Thread a mono word is an id, a path or code; every other text node is `--font-ui`.
const monoOffenders = (page: Page, regions: Element[]): Element[] => {
  const mono = page.resolve("var(--font-mono)");
  const offenders: Element[] = [];

  for (const region of regions) {
    const walker = page.doc.createTreeWalker(region, 4);

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;

      if (!el || (node.textContent ?? "").trim() === "" || !page.elements.includes(el) || el.closest("[data-mono], code, kbd, samp")) continue;

      if (page.resolve(page.style(el).fontFamily) === mono) offenders.push(el);
    }
  }

  return offenders;
};

const d13 = (page: Page): Measure => {
  const shelves = [...page.doc.querySelectorAll(".shelf")];

  if (!shelves.some((shelf) => shelf.querySelector(".shelf-row"))) return { ok: true, value: 0, selector: "" };

  const offenders = monoOffenders(page, shelves);

  return { ok: offenders.length === 0, value: offenders.length, selector: offenders[0] ? selectorOf(offenders[0]) : "" };
};

// D16 (U425): as D13 for the Thread, and no Agent name wraps: a name is one line, cut with an ellipsis.
const d16 = (page: Page): Measure => {
  const threads = [...page.doc.querySelectorAll(".thread")].filter((el) => page.elements.includes(el));

  if (threads.length === 0) return { ok: true, value: "no Thread", selector: "" };

  const offenders = monoOffenders(page, threads);
  const wrapping = threads.flatMap((thread) => [...thread.querySelectorAll(".thread-row-name, .thread-done-name")]).filter((el) => page.style(el).whiteSpace !== "nowrap");
  const bad = [...offenders, ...wrapping];

  return { ok: bad.length === 0, value: { mono: offenders.length, wrapping: wrapping.length }, selector: bad[0] ? selectorOf(bad[0]) : "" };
};

// D14: no row is a card, gaps within each list are equal space steps, and no title shows more than two lines or overflows its row.
const d14 = (page: Page): Measure => {
  const rows = shelfRows(page);

  if (rows.length === 0) return { ok: true, value: "no Shelf row", selector: "" };

  if (!measurable(rows)) return { ok: false, value: NOT_MEASURABLE, selector: "" };

  for (const { row } of rows) {
    const style = page.style(row);
    const ground = parseColour(page.resolve(style.backgroundColor));
    const drawn = ["top", "right", "bottom", "left"].some((side) => style.getPropertyValue(`border-${side}-style`) !== "none" && style.getPropertyValue(`border-${side}-style`) !== "" && (px(style.getPropertyValue(`border-${side}-width`)) ?? 0) > 0);

    if (ground && ground.a > 0) return { ok: false, value: { backgroundColor: style.backgroundColor }, selector: selectorOf(row) };

    if (drawn) return { ok: false, value: { border: style.borderTopWidth }, selector: selectorOf(row) };

    if (style.boxShadow && style.boxShadow !== "none") return { ok: false, value: { boxShadow: style.boxShadow }, selector: selectorOf(row) };
  }

  const between: number[] = [];
  const heads: number[] = [];
  const listOf = (row: Element) => row.closest(".shelf-list") ?? row.closest("section");

  for (const list of SHELF_LISTS) {
    const own = rows.filter((one) => one.list === list);
    const head = own[0]?.row.closest("section")?.querySelector(".group-head");

    own.slice(1).forEach((one, index) => {
      const previous = own[index]!;

      // The done fold begins another list; its separation is not a gap between neighbours.
      if (listOf(one.row) === listOf(previous.row)) between.push(one.box.top - previous.box.bottom);
    });

    if (head && own[0]) heads.push(own[0].box.top - head.getBoundingClientRect().bottom);
  }

  const sections = SHELF_LISTS.flatMap((list) => page.doc.querySelector(`.shelf section[aria-label="${list}" i]`) ?? []);
  const lists = sections.length === 2 ? [sections[1]!.getBoundingClientRect().top - sections[0]!.getBoundingClientRect().bottom] : [];

  for (const gap of [...between, ...heads, ...lists]) if (!SPACE_STEPS.has(Math.round(gap))) return { ok: false, value: { gap }, selector: "" };

  const equal = (gaps: number[]) => gaps.every((gap) => Math.abs(gap - gaps[0]!) <= 1);

  if (!equal(between) || !equal(heads)) return { ok: false, value: { between, heads }, selector: "" };

  for (const { row, box } of rows) {
    const title = row.querySelector(".shelf-title");

    if (!title) continue;

    const style = page.style(title);
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
    const lines = lineHeight > 0 ? Math.round(title.getBoundingClientRect().height / lineHeight) : 1;

    if (lines > 2) return { ok: false, value: { lines }, selector: selectorOf(row) };

    if (title.getBoundingClientRect().right > box.right + 1) return { ok: false, value: { overflow: title.getBoundingClientRect().right - box.right }, selector: selectorOf(row) };
  }

  return { ok: true, value: { rows: rows.length }, selector: "" };
};

const MEASURES: Record<Exclude<CheckId, "D10" | "D11" | "D12" | "D13" | "D14" | "D16">, (page: Page) => Measure> = { D1: d1, D2: d2, D3: d3, D4: d4, D5: d5, D6: d6, D7: d7, D8: d8, D9: d9 };

const BY_ID: Record<Exclude<CheckId, "D10">, (page: Page) => Measure> = { ...MEASURES, D11: d11, D12: d12, D13: d13, D14: d14, D16: d16 };

/** D1 to D14 and D16 for what is on screen now, in the colour scheme and media the page is in. A check that cannot measure fails with `"not measurable"`. */
export function runChecks(doc: Document = document): Checks {
  const page = pageOf(doc);

  const measure = (id: Exclude<CheckId, "D10">): Check => {
    if (page.elements.length === 0) return { status: "fail", value: NOT_MEASURABLE, selector: "" };

    try {
      const { ok, value, selector } = BY_ID[id](page);

      return { status: ok ? "pass" : "fail", value, selector };
    } catch {
      return { status: "fail", value: NOT_MEASURABLE, selector: "" };
    }
  };

  // SAFETY: `MEASURES` has one entry for every id but D10, and `measure` returns a Check for each.
  const nine = Object.fromEntries((Object.keys(MEASURES) as Exclude<CheckId, "D10" | "D11" | "D12" | "D13" | "D14" | "D16">[]).map((id) => [id, measure(id)])) as Record<Exclude<CheckId, "D10" | "D11" | "D12" | "D13" | "D14" | "D16">, Check>;
  const failing = Object.entries(nine).filter(([, check]) => check.status === "fail").map(([id]) => id);
  const view = page.view;

  return {
    ...nine,
    D10: {
      status: failing.length === 0 ? "pass" : "fail",
      value: { failing, scheme: view.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light", contrast: view.matchMedia?.("(prefers-contrast: more)").matches ? "more" : "no-preference", viewport: `${view.innerWidth}x${view.innerHeight}` },
      selector: "",
    },
    D11: measure("D11"),
    D12: measure("D12"),
    D13: measure("D13"),
    D14: measure("D14"),
    D16: measure("D16"),
  };
}
