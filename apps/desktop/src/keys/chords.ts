import { copy } from "../copy";

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inRail` marks a chord only a focused Rail row binds (U358); the rest bind from the pane too. `match` preserves key-based matching where the existing action uses `key` rather than `code`. */
export type Chord = { keys: string; what: string; presses: readonly string[]; inRail?: true; inSwitcher?: true; match?: readonly string[]; hint?: Hint };

/** Where focus can sit for the hint line (U2230a): a Rail row, a watched Agent's pane, a Terminal Bubble. */
export type HintPlace = "rail" | "agent" | "bubble";

/** A chord shown under focus: its short `label` and its position `at` in each place's line (U2230). */
export type Hint = { label: string; at: Partial<Record<HintPlace, number>>; watching?: true };

const digits = (from: number, to: number): string[] =>
  Array.from({ length: to - from + 1 }, (_, offset) => `alt+Digit${from + offset}`);

/** Every chord bound in the webview outside a Terminal screen, in Help's order (U54; U106 and U107 follow the scenario's list). `⇧⏎` binds only in the open switcher (`inSwitcher`). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
export const CHORDS: readonly Chord[] = [
  { keys: "⌘J", what: copy.jumpToWhatNeedsYou, presses: ["meta+KeyJ"] },
  { keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  { keys: "⇧⌘N", what: copy.newAgentWithAPrompt, presses: ["meta+shift+KeyN"] },
  { keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  { keys: "⌘B", what: copy.nextBubble, presses: ["meta+KeyB", "meta+shift+KeyB"], hint: { label: copy.hintNext, at: { bubble: 3 } } },
  { keys: "⌘.", what: copy.minimiseOrRestoreTheBubble, presses: ["meta+Period"], hint: { label: copy.minimise, at: { bubble: 1 } } },
  { keys: "⇧⌘⌫", what: copy.closeTheBubble, presses: ["meta+shift+Backspace"], hint: { label: copy.close, at: { bubble: 2 } } },
  { keys: "⌘K", what: copy.switchToARowByName, presses: ["meta+KeyK"] },
  { keys: "⇧⏎", what: copy.takeControlInTheSwitcher, presses: ["shift+Enter"], inSwitcher: true },
  { keys: "⌘1", what: copy.focusTheRail, presses: ["meta+Digit1"], match: ["meta+1"], hint: { label: copy.rail, at: { agent: 2 } } },
  { keys: "⌘2", what: copy.focusThePane, presses: ["meta+Digit2"], match: ["meta+2"] },
  { keys: "⌘↑", what: copy.previousAgent, presses: ["meta+ArrowUp"], hint: { label: copy.hintPrevious, at: { agent: 3 } } },
  { keys: "⌘↓", what: copy.nextAgent, presses: ["meta+ArrowDown"], hint: { label: copy.hintNext, at: { agent: 4 } } },
  { keys: "⌘⌫", what: copy.remove, presses: ["meta+Backspace"], inRail: true, hint: { label: copy.remove, at: { rail: 2 } } },
  { keys: "⌘⏎", what: copy.takeControlChord, presses: ["meta+Enter"], inRail: true, hint: { label: copy.takeControlChord, at: { rail: 1 }, watching: true } },
  { keys: "⌥1–⌥9", what: copy.takeOverTheNThAgent, presses: digits(1, 9) },
  { keys: "⌥0", what: copy.endTheTakeover, presses: digits(0, 0) },
  { keys: "⇧⌘J", what: copy.jumpToWhatNeedsYouInAnotherProject, presses: ["meta+shift+KeyJ"] },
  { keys: "⌘\\", what: copy.showOrHideTheShelf, presses: ["meta+Backslash"] },
  { keys: "⌘,", what: copy.models, presses: ["meta+Comma"] },
  { keys: "⇧⌘]", what: copy.nextProject, presses: ["meta+shift+BracketRight"] },
  { keys: "⇧⌘[", what: copy.previousProject, presses: ["meta+shift+BracketLeft"] },
];

/** The hints of `place`, in the order the table gives them (U2230a). A `watching` hint shows only while the selected Agent is in Watch, the one state its key acts in. */
export const hintsFor = (place: HintPlace, watching = true): readonly { keys: string; label: string }[] =>
  CHORDS.flatMap((chord) => chord.hint?.at[place] === undefined || (chord.hint.watching && !watching) ? [] : [{ keys: chord.keys, label: chord.hint.label, at: chord.hint.at[place] }])
    .sort((a, b) => a.at - b.at)
    .map(({ keys, label }) => ({ keys, label }));

/** The `<mods>+<code>` of a key press, as `Chord.presses` writes it. */
export const pressOf = (press: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "code">): string =>
  [press.ctrlKey && "ctrl", press.altKey && "alt", press.metaKey && "meta", press.shiftKey && "shift", press.code].filter(Boolean).join("+");

const MODIFIERS = Object.entries({ Control: "ctrl", Alt: "alt", Meta: "meta", Shift: "shift" });

/** tinykeys spellings derived from the same presses Help displays. */
export const chordsFor = (keys: string): readonly string[] => {
  const chord = CHORDS.find((chord) => chord.keys === keys);

  return (chord?.match ?? chord?.presses ?? []).map((press) =>
    press.split("+").map((part) => MODIFIERS.find(([, name]) => name === part)?.[0] ?? part).join("+"),
  );
};

/** Existing Rail navigation, kept local to Keys until its Rail lane adopts Ark. */
export const RAIL_KEYS = "ArrowLeft ArrowRight F2".split(" ");

export const HELP_KEYS = ["[Shift]+?"];

/** `⌘⏎` takes control (U531); `Escape` closes and `Shift+Enter` takes control in the open switcher (U529, U530). */
export const TAKE_CONTROL = chordsFor("⌘⏎");

export const SWITCHER_CLOSE = "Escape".split(" ");

export const SWITCHER_TAKE = "Shift+Enter".split(" ");

/** The keys that would have written a line into a Terminal (U532). */
export const WRITING_KEYS = "Enter Backspace ArrowUp ArrowDown ArrowLeft ArrowRight".split(" ");

/** Fields that take typing (a modal layer's own text field, U529). */
export const TEXT_FIELDS = "input,textarea";
