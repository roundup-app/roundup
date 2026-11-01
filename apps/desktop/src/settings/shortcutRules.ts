import { CHORDS, LEADER, defaultPress, pressOf, shortcutLabel } from "../keys/chords";
import { copy } from "./copy";
import { appSettings } from "./preferences";

const fallbackQuickAdd = "meta+shift+KeyT";

/** U5239d: the only chords a focused Terminal leaves to the App (U2241); every other `⌃`, `⌥` or `⌘` chord is the Terminal's. */
const appScope = () => new Set(["meta+KeyN", "meta+shift+KeyN", "meta+KeyT", "meta+KeyK", "meta+shift+KeyP", "meta+Slash", "meta+Comma", "ctrl+meta+KeyJ", "meta+KeyB", fallbackQuickAdd, appSettings().quickAdd]);

const RESERVED = () => new Map([["meta+KeyQ", copy.quitApp], ["meta+KeyH", copy.hideApp], ["meta+Space", copy.spotlight], ["meta+Tab", copy.switchApps]]);

/** The action that holds `press` now, a macOS-reserved chord included. */
export const holderOf = (press: string, except = ""): string | undefined =>
  RESERVED().get(press)
  ?? CHORDS.find(row => row.name !== except && row.presses.includes(press))?.what
  ?? LEADER.find(row => row.press.toLowerCase() === press.toLowerCase())?.what;

/** The owner of `press` for a lookup: a reserved chord or a row. */
export const ownerOf = (press: string): string | undefined => RESERVED().get(press) ?? CHORDS.find(row => row.presses.includes(press))?.what;

export const isModifier = (event: KeyboardEvent) => ["Control", "Alt", "Meta", "Shift", "CapsLock"].includes(event.key) || event.isComposing;

/** U5239b: why `event` cannot become the key of action `name`, or the press to save. */
export const checkRecorded = (name: string, event: KeyboardEvent): { press: string } | { refusal: string } => {
  if (!event.metaKey && !event.ctrlKey) return { refusal: copy.shortcutModifier };

  const press = pressOf(event);
  const label = shortcutLabel(press, event.key);
  const holder = holderOf(press, name);

  if (holder) return { refusal: copy.shortcutRefusal(label, holder) };

  if (!appScope().has(press)) return { refusal: copy.shortcutTerminal(label) };

  return { press };
};

/** The saved overrides with `name` moved to `press`, or back to its default for `null`. */
export const shortcutsWith = (name: string, press: string | null): Record<string, string> => {
  const { [name]: _gone, ...rest } = appSettings().shortcuts;

  return press === null || press === defaultPress(name) ? rest : { ...rest, [name]: press };
};
