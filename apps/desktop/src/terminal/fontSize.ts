import "../tokens.css";

const tokens = getComputedStyle(document.documentElement);

export const DEFAULT_FONT_SIZE = Number.parseFloat(tokens.getPropertyValue("--text-terminal"));

export const MIN_FONT_SIZE = Number.parseFloat(tokens.getPropertyValue("--text-terminal-min"));

export const MAX_FONT_SIZE = Number.parseFloat(tokens.getPropertyValue("--text-terminal-max"));
