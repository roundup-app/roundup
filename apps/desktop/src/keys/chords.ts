import { copy } from "../copy";

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inRail` marks a chord only a focused Rail row binds (U358); `onAgent` one that also binds from a watched or taken Agent's pane, and nowhere else outside a Rail row; `inTerminals` marks the scoped Agent/Bubble/tab switch; the rest bind from the pane too. */
export type Chord = { keys: string; what: string; presses: readonly string[]; inRail?: true; onAgent?: true; inSwitcher?: true; inTerminals?: true; hint?: Hint };

/** Where focus can sit for the hint line (U2230a): a Rail row, watched Agent, Bubble, Pad, Drawer, Switcher or Editor. */
export type HintPlace = "rail" | "agent" | "bubble" | "pad" | "drawer" | "switcher" | "editor";

/** A chord shown under focus: its short `label` and its position `at` in each place's line (U2230). */
export type Hint = { label: string; at: Partial<Record<HintPlace, number>>; watching?: true };

/** Every chord bound in the webview outside a Terminal screen, in Help's order (U54, U2241). Only `⌘N`, `⇧⌘N`, `⌘T`, `⌘K` and `⌘/` bind at App scope; `⌘⏎` binds on a Rail row and in an Agent's pane, taking control and giving it back (U531); every other `⌃`, `⌥` and `⌘` key reaches the Terminal, a plain Terminal's `⌘⏎` included. `⌘B` switches only between the selected Agent emulator and an eligible Bubble/tab (U2742c). `⇧⏎` binds only in the open switcher (`inSwitcher`). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
export const CHORDS: readonly Chord[] = [
  { keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  { keys: "⇧⌘N", what: copy.newAgentWithAPrompt, presses: ["meta+shift+KeyN"] },
  { keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  { keys: "⌘K", what: copy.leaderWaitsForAKey, presses: ["meta+KeyK"], hint: { label: copy.leaderWaitsForAKey, at: { rail: 3, agent: 2, bubble: 1, pad: 1, drawer: 1 } } },
  { keys: "⌘B", what: copy.switchAgentTerminal, presses: ["meta+KeyB"], inTerminals: true, hint: { label: copy.switchAgentTerminal, at: { agent: 0, bubble: 0 } } },
  { keys: "⇧⏎", what: copy.takeControlInTheSwitcher, presses: ["shift+Enter"], inSwitcher: true },
  { keys: "⌘⌫", what: copy.remove, presses: ["meta+Backspace"], inRail: true, hint: { label: copy.remove, at: { rail: 2 } } },
  { keys: "⌘⏎", what: copy.takeControlChord, presses: ["meta+Enter"], onAgent: true, hint: { label: copy.takeControlChord, at: { rail: 1, agent: 1 }, watching: true } },
  { keys: "⌘/", what: copy.askBarShortcut, presses: ["meta+Slash"], hint: { label: copy.askBarShortcut, at: { rail: 4, agent: 3, bubble: 2, pad: 2, drawer: 2 } } },
];

/** One key `⌘K` takes next (U2239), by key position, read by Help (U54) and the leader panel (U2240). */
/** `what` is Help's line; `short` is the panel's, which fits the six keys on one line of the header band (U2240). */
export type LeaderKey = { keys: string; what: string; short: string; press: string };

export const LEADER: readonly LeaderKey[] = [
  { keys: "J", what: copy.jumpToWhatNeedsYou, short: copy.leaderShortNeedsYou, press: "KeyJ" },
  { keys: "⇧J", what: copy.jumpToWhatNeedsYouInAnotherProject, short: copy.leaderShortAnotherProject, press: "Shift+KeyJ" },
  { keys: "K", what: copy.switchToARowByName, short: copy.leaderShortRow, press: "KeyK" },
  { keys: "M", what: copy.minimiseOrRestoreTheBubble, short: copy.leaderShortMinimise, press: "KeyM" },
  { keys: "W", what: copy.closeTheBubble, short: copy.leaderShortClose, press: "KeyW" },
  { keys: "S", what: copy.showOrHideTheShelf, short: copy.leaderShortShelf, press: "KeyS" },
  { keys: "T", what: copy.captureATodo, short: copy.leaderShortCapture, press: "KeyT" },
];

/** Help's rows: the chords, with the leader's keys after `⌘K` (U2241). */
export const HELP_ROWS: readonly { keys: string; what: string }[] = [
  ...CHORDS.slice(0, 4),
  ...LEADER.map((key) => ({ keys: `${copy.leaderChord} ${key.keys}`, what: key.what })),
  ...CHORDS.slice(4),
];

/** The leader key that shows as `keys`. */
export const leaderChord = (keys: string): readonly string[] => [LEADER.find((key) => key.keys === keys)!.press];

/** The hints of `place`, in the order the table gives them (U2230a). A `watching` hint shows only while the selected Agent is in Watch, the one state its key acts in. */
export const hintsFor = (place: HintPlace, watching = true): readonly { keys: string; label: string }[] => {
  const hints = CHORDS.flatMap((chord) => chord.hint?.at[place] === undefined || (chord.hint.watching && !watching) ? [] : [{ keys: chord.keys, label: chord.hint.label, at: chord.hint.at[place] }])
    .sort((a, b) => a.at - b.at)
    .map(({ keys, label }) => ({ keys, label }));

  return hints.length < 2 ? [] : hints.slice(0, 4);
};

/** The `<mods>+<code>` of a key press, as `Chord.presses` writes it. */
export const pressOf = (press: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "code">): string =>
  [press.ctrlKey && "ctrl", press.altKey && "alt", press.metaKey && "meta", press.shiftKey && "shift", press.code].filter(Boolean).join("+");

const MODIFIERS = Object.entries({ Control: "ctrl", Alt: "alt", Meta: "meta", Shift: "shift" });

/** tinykeys spellings derived from the same presses Help displays. `key` retains the Rail's logical letter matching, including events without a physical code. */
export const chordsFor = (keys: string, match: "code" | "key" = "code"): readonly string[] => {
  const chord = CHORDS.find((chord) => chord.keys === keys);

  return (chord?.presses ?? []).map((press) =>
    press.split("+").map((part) => MODIFIERS.find(([, name]) => name === part)?.[0] ?? (match === "key" && /^Key[A-Z]$/.test(part) ? part.slice(3).toLowerCase() : part)).join("+"),
  );
};

/** `⌘K` arms the leader (U2239). */
export const LEADER_ARM = chordsFor("⌘K");

/** Existing Rail navigation, kept local to Keys until its Rail lane adopts Ark. */
export const RAIL_KEYS = "ArrowLeft ArrowRight F2".split(" ");

export const HELP_KEYS = ["[Shift]+?"];

/** The one key that takes control and gives it back (U531); `Escape` closes and `Shift+Enter` takes control in the open switcher (U529, U530). */
export const TAKE_CONTROL_KEYS = "⌘⏎";

export const SWITCHER_CLOSE = "Escape".split(" ");

export const ASK_CLOSE = "Escape".split(" ");

export const SWITCHER_TAKE = "Shift+Enter".split(" ");

/** Fields that take typing (a modal layer's own text field, U529). */
export const TEXT_FIELDS = "input,textarea";
