import { appSettings } from "../settings/preferences";
import { copy } from "./copy";

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inFirstRun` keeps a chord in first-run Help only; `inRail` marks a chord only a focused Rail row binds (U358); `inTerminals` marks the scoped Agent/Bubble/tab switch; the rest bind from the pane too. */
export type Chord = { keys: string; what: string; presses: readonly string[]; inFirstRun?: true; inRail?: true; inTerminals?: true; inShelf?: true; inEditor?: true; /** U3751: a key of Todo triage mode, bound only while the mode is on. */ inTriage?: true; hint?: Hint };

/** Where focus can sit for the hint line (U2230a): a Rail row, watched Agent, Bubble, Pad, Drawer, Switcher or Editor. */
export type HintPlace = "rail" | "agent" | "bubble" | "pad" | "drawer" | "switcher" | "editor" | "shelf";

/** A chord shown under focus: its short `label` and its position `at` in each place's line (U2230). */
export type Hint = { label: string; at: Partial<Record<HintPlace, number>> };

/** Commands bound in the webview, including focused Terminal actions, in Help's order (U54, U2241). Only `⌘N`, `⇧⌘N`, `⌘T`, `⇧⌘T`, `⌘K`, `⌘/` and `⌃⌘J` bind at App scope; every other `⌃`, `⌥` and `⌘` key reaches the Terminal. `⌘B` switches only between the selected Agent emulator and an eligible Bubble/tab (U2742c). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
/** The label and the binding are derived from the same saved physical press. */
export const shortcutLabel = (press: string, keyName = ""): string => {
  const parts = press.split("+");
  const code = parts.at(-1) ?? "";
  const key = code.replace(/^Key|^Digit/, "");


  return `${parts.includes("ctrl") ? "⌃" : ""}${parts.includes("alt") ? "⌥" : ""}${parts.includes("shift") ? "⇧" : ""}${parts.includes("meta") ? "⌘" : ""}${copy.shortcutKeys.get(code) ?? (keyName || key)}`;
};

export const CHORDS: readonly Chord[] = [
  { keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  { keys: "⇧⌘N", what: copy.newAgentWithAPrompt, presses: ["meta+shift+KeyN"] },
  { keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  { keys: "⌘K", what: copy.leaderWaitsForAKey, presses: ["meta+KeyK"], hint: { label: copy.leaderWaitsForAKey, at: { rail: 3, agent: 2, bubble: 1, pad: 1, drawer: 1 } } },
  { keys: "⌃⌘J", what: copy.jumpToWhatNeedsYou, presses: ["ctrl+meta+KeyJ"], hint: { label: copy.jumpToWhatNeedsYou, at: { rail: -1, agent: -1, bubble: -1, shelf: -1, pad: -1, drawer: -1 } } },
  { get keys() { return shortcutLabel(appSettings().quickAdd, appSettings().quickAddKey); }, what: copy.captureATodo, get presses() { return [appSettings().quickAdd]; } },
  { keys: "⌘B", what: copy.switchAgentTerminal, presses: ["meta+KeyB"], inTerminals: true, hint: { label: copy.switchAgentTerminal, at: { agent: 0, bubble: 0 } } },
  { keys: "M", what: copy.moveTo, presses: ["KeyM"], inRail: true },
  { keys: copy.renameChord, what: copy.rename, presses: [copy.renameChord], inRail: true },
  // Help follows the logical ? through HELP_KEYS, rather than a physical US-layout chord.
  { keys: "?", what: copy.help, presses: [] },
  { keys: "R", what: copy.restartMode, presses: ["KeyR"], inRail: true },
  { keys: "⌘⌫", what: copy.remove, presses: ["meta+Backspace"], inRail: true, hint: { label: copy.remove, at: { rail: 2 } } },
  { keys: "⌘/", what: copy.askBarShortcut, presses: ["meta+Slash"], hint: { label: copy.askBarShortcut, at: { rail: 4, agent: 3, bubble: 2, pad: 2, drawer: 2, shelf: 6 } } },
  { keys: "1–9", what: copy.todoAssignDigit, presses: Array.from({ length: 9 }, (_, at) => `Digit${at + 1}`), inShelf: true, hint: { label: copy.assign, at: { shelf: 2 } } },
  { keys: "⏎", what: copy.openDraft, presses: ["Enter"], inShelf: true },

  { keys: "N", what: copy.addTodo, presses: ["KeyN"], inShelf: true },
  { keys: "O", what: copy.assignTodo, presses: ["KeyO"], inShelf: true, hint: { label: copy.assign, at: { shelf: 1 } } },
  { keys: "M", what: copy.maximise, presses: ["KeyM"], inShelf: true, hint: { label: copy.maximise, at: { shelf: 0 } } },
  { keys: "D", what: copy.deleteFocusedRow, presses: ["KeyD"], inShelf: true, hint: { label: copy.deleteFocusedRow, at: { shelf: 3 } } },
  { keys: "E", what: copy.exportMd, presses: ["KeyE"], inShelf: true, hint: { label: copy.exportMd, at: { shelf: 4 } } },
  { keys: "Esc", what: copy.close, presses: ["Escape"], inShelf: true, hint: { label: copy.close, at: { shelf: 5 } } },
  { keys: "⌘=", what: copy.terminalLargerText, presses: ["meta+Equal"], inTerminals: true },
  { keys: "⌘-", what: copy.terminalSmallerText, presses: ["meta+Minus"], inTerminals: true },
  { keys: "⌘0", what: copy.terminalResetText, presses: ["meta+Digit0"], inTerminals: true },
  { keys: "⇧⌘B", what: copy.quote, presses: ["meta+shift+KeyB"], inEditor: true },
  { keys: "⌥⌘8", what: copy.bulletList, presses: ["alt+meta+Digit8"], inEditor: true },
  { keys: "⌥⌘7", what: copy.numberedList, presses: ["alt+meta+Digit7"], inEditor: true },
  { keys: "⌥⌘C", what: copy.codeBlock, presses: ["alt+meta+KeyC"], inEditor: true },
  { keys: "⌘I", what: copy.italic, presses: ["meta+KeyI"], inEditor: true },
  { keys: "⌘E", what: copy.inlineCode, presses: ["meta+KeyE"], inEditor: true },
  { keys: "⌘F", what: copy.find, presses: ["meta+KeyF"], inTerminals: true },
  { keys: "⌘Z", what: copy.undoFocused, presses: ["meta+KeyZ"] },
  { keys: "⇧⌘Z", what: copy.redoFocused, presses: ["meta+shift+KeyZ"] },
  { keys: "⌘,", what: copy.settings, presses: ["meta+Comma"] },
  // U5242c: ⌘[ goes Back while Settings is open; ⌘] reopens what Back closed.
  { keys: "⌘]", what: copy.settingsForward, presses: ["meta+BracketRight"], inRail: true },
  // U3751 to U3753: past the four hints a Shelf row shows, so the mode's own line lists them.
  { keys: "T", what: copy.triageEnter, presses: ["KeyT"], inShelf: true, hint: { label: copy.triageEnter, at: { shelf: 7 } } },
  { keys: "J K", what: copy.triageMove, presses: ["KeyJ", "KeyK"], inShelf: true, inTriage: true },
  { keys: "A", what: copy.triageAssign, presses: ["KeyA"], inShelf: true, inTriage: true },
  { keys: "W", what: copy.triageWorkstream, presses: ["KeyW"], inShelf: true, inTriage: true },
  { keys: "Tab", what: copy.triageNest, presses: ["Tab"], inShelf: true, inTriage: true },
  { keys: "⇧Tab", what: copy.triageUnnest, presses: ["shift+Tab"], inShelf: true, inTriage: true },
  { keys: "X", what: copy.triageDone, presses: ["KeyX"], inShelf: true, inTriage: true },
  { keys: "C", what: copy.triageComment, presses: ["KeyC"], inShelf: true, inTriage: true },
  { keys: "Esc", what: copy.triageLeave, presses: ["Escape"], inShelf: true, inTriage: true },
  // U4464: first-run-only; preserve the existing Project chord order.
  { keys: "⌘O", what: copy.chooseFolder, presses: ["meta+KeyO"], inFirstRun: true },
];

/** One key `⌘K` takes next (U2239), by key position, read by Help (U54) and the leader panel (U2240). */
/** `what` is Help's line; `short` is the panel's, which fits the six keys on one line of the header band (U2240). */
export type LeaderKey = { keys: string; what: string; short: string; press: string };

export const LEADER: readonly LeaderKey[] = [
  { keys: "A", what: copy.leaderAssignOrAsk, short: copy.leaderShortAssignOrAsk, press: "KeyA" },
  { keys: "P", what: copy.switchProject, short: copy.projects, press: "KeyP" },
  { keys: "C", what: copy.reviewChanges, short: copy.reviewChanges, press: "KeyC" },
  { keys: "J", what: copy.jumpToWhatNeedsYou, short: copy.leaderShortNeedsYou, press: "KeyJ" },
  { keys: "⇧J", what: copy.jumpToWhatNeedsYouInAnotherProject, short: copy.leaderShortAnotherProject, press: "Shift+KeyJ" },
  { keys: "K", what: copy.switchToARowByName, short: copy.leaderShortRow, press: "KeyK" },
  { keys: "M", what: copy.minimiseOrRestoreTheBubble, short: copy.leaderShortMinimise, press: "KeyM" },
  { keys: "W", what: copy.closeTheBubble, short: copy.leaderShortClose, press: "KeyW" },
  { keys: "B", what: copy.openShelf, short: copy.leaderShortShelf, press: "KeyB" },
  { keys: "T", what: copy.captureATodo, short: copy.leaderShortCapture, press: "KeyT" },
  { keys: "I", what: copy.openTheInbox, short: copy.leaderShortInbox, press: "KeyI" },
];

/** Help's rows: the chords, with the leader's keys after `⌘K` (U2241). */
export const HELP_ROWS: readonly { keys: string; what: string }[] = [
  ...CHORDS.slice(0, 4),
  ...LEADER.map((key) => ({ keys: `${copy.leaderChord} ${key.keys}`, what: key.what })),
  ...CHORDS.slice(4),
];

/** The leader key that shows as `keys`. */
export const leaderChord = (keys: string): readonly string[] => [LEADER.find((key) => key.keys === keys)!.press];

/** The hints of `place`, in the order the table gives them (U2230a). */
export const hintsFor = (place: HintPlace): readonly { keys: string; label: string }[] => {
  const hints = CHORDS.flatMap((chord) => chord.hint?.at[place] === undefined ? [] : [{ keys: chord.keys, label: chord.hint.label, at: chord.hint.at[place] }])
    .sort((a, b) => a.at - b.at)
    .map(({ keys, label }) => ({ keys, label }));

  return hints.length < 2 ? [] : hints.slice(0, place === "shelf" ? 8 : 4);
};

/** The `<mods>+<code>` of a key press, as `Chord.presses` writes it. */
export const pressOf = (press: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | "code">): string =>
  [press.ctrlKey && "ctrl", press.altKey && "alt", press.metaKey && "meta", press.shiftKey && "shift", press.code].filter(Boolean).join("+");

const MODIFIERS = Object.entries({ Control: "ctrl", Alt: "alt", Meta: "meta", Shift: "shift" });

/** tinykeys spellings derived from the same presses Help displays. `key` retains the Rail's logical letter matching, including events without a physical code. */
export const chordsOf = (chord: Chord | undefined, match: "code" | "key" = "code"): readonly string[] =>
  (chord?.presses ?? []).map((press) =>
    press.split("+").map((part) => MODIFIERS.find(([, name]) => name === part)?.[0] ?? (match === "key" && /^Key[A-Z]$/.test(part) ? part.slice(3).toLowerCase() : part)).join("+"),
  );

export const chordsFor = (keys: string, match: "code" | "key" = "code"): readonly string[] => chordsOf(CHORDS.find((chord) => chord.keys === keys), match);

/** Existing Rail navigation, kept local to Keys until its Rail lane adopts Ark. */
export const RAIL_KEYS = "ArrowLeft ArrowRight F2".split(" ");

export const HELP_KEYS = ["[Shift]+?"];

export const SWITCHER_CLOSE = "Escape".split(" ");

export const ASK_CLOSE = "Escape".split(" ");

/** Fields that take typing (a modal layer's own text field, U529). */
export const TEXT_FIELDS = "input,textarea";
