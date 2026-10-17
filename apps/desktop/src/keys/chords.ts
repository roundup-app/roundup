import { copy } from "../copy";

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inRail` marks a chord only a focused Rail row binds (U358); the rest bind from the pane too. */
export type Chord = { keys: string; what: string; presses: readonly string[]; inRail?: true; inSwitcher?: true };

/** Every chord bound in the webview outside a Terminal screen, in Help's order (U54, U2241). Only `⌘N`, `⇧⌘N`, `⌘T`, `⌘K` and `⌘/` bind at App scope; every other `⌃`, `⌥` and `⌘` key reaches the Terminal. `⇧⏎` binds only in the open switcher (`inSwitcher`). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
export const CHORDS: readonly Chord[] = [
  { keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  { keys: "⇧⌘N", what: copy.newAgentWithAPrompt, presses: ["meta+shift+KeyN"] },
  { keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  { keys: "⌘K", what: copy.leaderWaitsForAKey, presses: ["meta+KeyK"] },
  { keys: "⇧⏎", what: copy.takeControlInTheSwitcher, presses: ["shift+Enter"], inSwitcher: true },
  { keys: "⌘⌫", what: copy.remove, presses: ["meta+Backspace"], inRail: true },
  { keys: "⌘⏎", what: copy.takeControlChord, presses: ["meta+Enter"], inRail: true },
  { keys: "⌘/", what: copy.askBarShortcut, presses: ["meta+Slash"] },
];

/** One key `⌘K` takes next (U2239), by key position, read by Help (U54) and the leader panel (U2240). */
export type LeaderKey = { keys: string; what: string; press: string };

export const LEADER: readonly LeaderKey[] = [
  { keys: "J", what: copy.jumpToWhatNeedsYou, press: "KeyJ" },
  { keys: "⇧J", what: copy.jumpToWhatNeedsYouInAnotherProject, press: "Shift+KeyJ" },
  { keys: "K", what: copy.switchToARowByName, press: "KeyK" },
  { keys: "M", what: copy.minimiseOrRestoreTheBubble, press: "KeyM" },
  { keys: "W", what: copy.closeTheBubble, press: "KeyW" },
  { keys: "S", what: copy.showOrHideTheShelf, press: "KeyS" },
];

/** Help's rows: the chords, with the leader's keys after `⌘K` (U2241). */
export const HELP_ROWS: readonly { keys: string; what: string }[] = [
  ...CHORDS.slice(0, 4),
  ...LEADER.map((key) => ({ keys: `${copy.leaderChord} ${key.keys}`, what: key.what })),
  ...CHORDS.slice(4),
];

/** The leader key that shows as `keys`. */
export const leaderChord = (keys: string): readonly string[] => [LEADER.find((key) => key.keys === keys)!.press];

/** The `<mods>+<code>` of a key press, as `Chord.presses` writes it. */
export const pressOf = (press: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "code">): string =>
  [press.ctrlKey && "ctrl", press.altKey && "alt", press.metaKey && "meta", press.shiftKey && "shift", press.code].filter(Boolean).join("+");

const MODIFIERS = Object.entries({ Control: "ctrl", Alt: "alt", Meta: "meta", Shift: "shift" });

/** tinykeys spellings derived from the same presses Help displays. */
const chordsFor = (keys: string): readonly string[] => {
  const chord = CHORDS.find((chord) => chord.keys === keys);

  return (chord?.presses ?? []).map((press) =>
    press.split("+").map((part) => MODIFIERS.find(([, name]) => name === part)?.[0] ?? part).join("+"),
  );
};

/** `⌘K` arms the leader (U2239). */
export const LEADER_ARM = chordsFor("⌘K");

/** Existing Rail navigation, kept local to Keys until its Rail lane adopts Ark. */
export const RAIL_KEYS = "ArrowLeft ArrowRight F2".split(" ");

export const HELP_KEYS = ["[Shift]+?"];

/** `⌘⏎` takes control (U531); `Escape` closes and `Shift+Enter` takes control in the open switcher (U529, U530). */
export const TAKE_CONTROL = chordsFor("⌘⏎");

export const SWITCHER_CLOSE = "Escape".split(" ");

export const ASK_CLOSE = "Escape".split(" ");

export const SWITCHER_TAKE = "Shift+Enter".split(" ");

/** The keys that would have written a line into a Terminal (U532). */
export const WRITING_KEYS = "Enter Backspace ArrowUp ArrowDown ArrowLeft ArrowRight".split(" ");

/** Fields that take typing (a modal layer's own text field, U529). */
export const TEXT_FIELDS = "input,textarea";
