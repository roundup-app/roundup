// Read App-owned declarations: compiled CSS prepends Radix roots and media blocks.
// U478’s Chromium observer checks the processed palette and scheme inheritance.
import tokenStyles from "../tokens.css?raw";
import appStyles from "../styles.css?inline";
import railStyles from "../rail/styles.css?inline";

const uiStyles = Object.values(import.meta.glob<string>("../ui/*.css", { query: "?inline", import: "default", eager: true })).join("\n");

import buttonStyles from "../buttons.css?inline";

type Rgb = { r: number; g: number; b: number };

const HEX = /^#([0-9a-f]{6})$/i;

const parseHex = (hex: string): Rgb => {
  const match = HEX.exec(hex.trim());

  if (!match) throw new Error(`not a 6-digit hex colour: ${hex}`);

  const digits = match[1]!;

  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
};

const toHex2 = (value: number): string => Math.round(value).toString(16).padStart(2, "0");

const channelLuminance = (channel: number): number => {
  const normalized = channel / 255;

  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};

const relativeLuminance = ({ r, g, b }: Rgb): number =>
  0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);

/** WCAG contrast ratio between two resolved hex colours, order-independent. */
export const contrastRatio = (a: string, b: string): number => contrastRgb(parseHex(a), parseHex(b));

/** WCAG contrast on composited channels, preserving fractional channels until luminance. */
export const contrastRgb = (a: Rgb, b: Rgb): number => {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);

  return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
};

/** The selected row's band: a black wash at `alpha` over an opaque background, as `rgba(0, 0, 0, alpha)` paints it. */
export const blendBlackOver = (hex: string, alpha: number): string => {
  const { r, g, b } = parseHex(hex);
  const mix = (channel: number) => toHex2(channel * (1 - alpha));

  return `#${mix(r)}${mix(g)}${mix(b)}`;
};

/** `filter: grayscale(1)` desaturates by luma, replacing every channel with the same weighted sum (CSS Filter Effects, `grayscale`). */
export const grayscale = (hex: string): string => {
  const { r, g, b } = parseHex(hex);
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const channel = toHex2(luma);

  return `#${channel}${channel}${channel}`;
};

const FILTER_FUNCTION = /([\w-]+)\(([^)]+)\)/g;

const clampChannel = (channel: number): number => Math.min(255, Math.max(0, channel));

/** Applies a `filter` declaration's functions, in the order written, to a resolved colour: the same per-channel math a browser runs on pixels (CSS Filter Effects). Reading the real declaration, instead of reimplementing one function by hand, catches a filter a test never named. */
export const applyFilter = (hex: string, filter: string): string => {
  let { r, g, b } = parseHex(hex);

  for (const [, name, arg] of filter.matchAll(FILTER_FUNCTION)) {
    const amount = Number(arg);

    if (name === "grayscale") {
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      r += (luma - r) * amount;
      g += (luma - g) * amount;
      b += (luma - b) * amount;
    } else if (name === "contrast") {
      const adjust = (channel: number) => (channel - 127.5) * amount + 127.5;

      r = adjust(r);
      g = adjust(g);
      b = adjust(b);
    } else {
      throw new Error(`applyFilter does not know the filter function ${name}`);
    }
  }

  return `#${toHex2(clampChannel(r))}${toHex2(clampChannel(g))}${toHex2(clampChannel(b))}`;
};

/** The greyed Rail's own rule body, straight from `rail/styles.css`'s text, never a hard-coded copy. */
const greyedRailRule = (railCss: string): string => {
  const rule = /\[aria-disabled="true"\]\s*\{([^}]*)\}/.exec(railCss)?.[1];

  if (!rule) throw new Error("no [aria-disabled] rule in rail/styles.css");

  return rule;
};

/** The `filter` declaration on the greyed Rail's own rule. */
export const greyedRailFilter = (railCss: string): string => {
  const filter = /filter:\s*([^;]+);/.exec(greyedRailRule(railCss))?.[1];

  if (!filter) throw new Error("no filter declaration in the greyed-Rail rule");

  return filter.trim();
};

/** The `:root` custom properties straight out of a stylesheet's own text, so a test resolves tokens from the real file instead of a hard-coded copy. */
export const tokensOf = (css: string): ReadonlyMap<string, string> => {
  const root = /:root\s*\{([^}]*)\}/.exec(css);

  if (!root) throw new Error("no :root block in stylesheet");

  const tokens = new Map<string, string>();

  for (const declaration of root[1]!.matchAll(/--([\w-]+):\s*([^;\s][^;]*);/g))
    tokens.set(declaration[1]!, declaration[2]!.trim());

  return tokens;
};

/** Every `:root` token across several stylesheets, later sheets winning a name both define. */
export const tokensFrom = (...sheets: string[]): ReadonlyMap<string, string> =>
  new Map(sheets.flatMap((css) => [...tokensOf(css)]));

/** The defaults of the `--button-*` hooks (buttons.css, `button { … }`): a button reads its surface and pad through them, and a component may set them. */
const BUTTON_HOOKS: ReadonlyMap<string, string> = new Map(
  [...(/\bbutton\s*\{([^}]*)\}/.exec(buttonStyles)?.[1] ?? "").matchAll(/--(button-[\w-]+):\s*([^;]+);/g)].map((hook) => [hook[1]!, hook[2]!.trim()]),
);

/** Resolves a computed-style value that may still read as `var(--name)`: jsdom does not substitute custom properties, so tests must. */
export const resolveToken = (value: string, tokens: ReadonlyMap<string, string>): string => {
  const reference = /^var\(--([\w-]+)\)$/.exec(value.trim());

  if (!reference) return value.trim();

  const name = reference[1]!;
  const resolved = tokens.get(name) ?? BUTTON_HOOKS.get(name);

  if (resolved === undefined) throw new Error(`unknown token --${name}`);

  return resolveToken(resolved, tokens);
};

/** Injects the real stylesheets into jsdom, as the Drawer tests already do, so `getComputedStyle` reflects the shipped rules. */
export const withStylesheets = async <T,>(run: () => T | Promise<T>): Promise<T> => {
  const tokens = document.head.appendChild(document.createElement("style"));
  tokens.dataset.viteDevId = "/src/tokens.css";
  tokens.textContent = tokenStyles;
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = `${appStyles}\n${uiStyles}\n${railStyles}\n${buttonStyles}`;

  try {
    return await run();
  } finally {
    sheet.remove();
    tokens.remove();
  }
};
