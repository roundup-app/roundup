import { appSettings } from "../settings/preferences";
import { copy } from "./copy";

/** NA3: a value an action argument holds once parsed. */
export type ActionValue = string | number | boolean;

export type ActionValues = Readonly<Record<string, ActionValue>>;

/** NA1: one `key=value` argument of a named action; optional unless `required`. `press` names the key press that runs the action for a value, where its binding is per press. */
export type ActionArg = { key: string; required?: true; press?: (value: ActionValue) => string } & (
  { type: "string" } | { type: "integer"; min: number; max: number } | { type: "boolean" } | { type: "choice"; options: readonly string[] }
);

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inFirstRun` keeps a chord in first-run Help only; `inRail` marks a chord only a focused Rail row binds (U358); `inTerminals` marks the scoped Agent/Bubble/tab switch; the rest bind from the pane too. */
export type Chord = { name: string; args?: readonly ActionArg[]; keys: string; what: string; presses: readonly string[]; inFirstRun?: true; inRail?: true; inTerminals?: true; inShelf?: true; inEditor?: true; /** U3751: a key of Todo triage mode, bound only while the mode is on. */ inTriage?: true; hint?: Hint };

/** Where focus can sit for the hint line (U2230a): a Rail row, watched Agent, Bubble, Pad, Drawer, Switcher or Editor. */
export type HintPlace = "rail" | "agent" | "bubble" | "pad" | "drawer" | "switcher" | "editor" | "shelf";

/** A chord shown under focus: its short `label` and its position `at` in each place's line (U2230). */
export type Hint = { label: string; at: Partial<Record<HintPlace, number>> };

/** Commands bound in the webview, including focused Terminal actions, in Help's order (U54, U2241). Only `⌘N`, `⇧⌘N`, `⌥⌘N`, `⇧⌘M`, `⌘T`, `⇧⌘T`, `⌘K`, `⌘/` and `⌃⌘J` bind at App scope; every other `⌃`, `⌥` and `⌘` key reaches the Terminal. `⌘B` switches only between the selected Agent emulator and an eligible Bubble/tab (U2742c). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
/** The label and the binding are derived from the same saved physical press. */
export const shortcutLabel = (press: string, keyName = ""): string => {
  const parts = press.split("+");
  const code = parts.at(-1) ?? "";
  const key = code.replace(/^Key|^Digit/, "");
  const known = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2]))$/.test(code);
  const label = [...Object.entries(copy.shortcutKeys), ...Object.entries(copy.shortcutSymbols)].find(([name]) => name === code)?.[1];


  return `${parts.includes("ctrl") ? "⌃" : ""}${parts.includes("alt") ? "⌥" : ""}${parts.includes("shift") ? "⇧" : ""}${parts.includes("meta") ? "⌘" : ""}${label ?? (known ? key : keyName || key)}`;
};

export const CHORDS: readonly Chord[] = [
  { name: "agent.new", keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  { name: "agent.new-with-prompt", keys: "⇧⌘N", what: copy.newAgentWithAPrompt, args: [{ key: "prompt", type: "string" }], presses: ["meta+shift+KeyN"] },
  { name: "workstream.new", keys: "⌥⌘N", what: copy.newWorkstreamTitle, presses: ["alt+meta+KeyN"] },
  { name: "mode.new", keys: "⇧⌘M", what: copy.newMode, presses: ["meta+shift+KeyM"] },
  { name: "terminal.new", keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  { name: "leader.open", keys: "⌘K", what: copy.leaderWaitsForAKey, presses: ["meta+KeyK"], hint: { label: copy.leaderWaitsForAKey, at: { rail: 3, agent: 2, bubble: 1, pad: 1, drawer: 1 } } },
  { name: "attention.jump", keys: "⌃⌘J", what: copy.jumpToWhatNeedsYou, presses: ["ctrl+meta+KeyJ"], hint: { label: copy.jumpToWhatNeedsYou, at: { rail: -1, agent: -1, bubble: -1, shelf: -1, pad: -1, drawer: -1 } } },
  { name: "todo.capture", get keys() { return shortcutLabel(appSettings().quickAdd, appSettings().quickAddKey); }, what: copy.captureATodo, get presses() { return [appSettings().quickAdd]; } },
  { name: "terminal.switch", keys: "⌘B", what: copy.switchAgentTerminal, presses: ["meta+KeyB"], inTerminals: true, hint: { label: copy.switchAgentTerminal, at: { agent: 0, bubble: 0 } } },
  // U5171: the Rail binds the arrows itself (RAIL_KEYS), so Help names them with no press for the chord probe to compare.
  { name: "rail.collapse-expand", keys: "← →", what: copy.collapseExpand, presses: [], inRail: true },
  { name: "rail.move", keys: "M", what: copy.moveTo, presses: ["KeyM"], inRail: true },
  { name: "rail.rename", keys: copy.renameChord, what: copy.rename, presses: [copy.renameChord], inRail: true },
  // Help follows the logical ? through HELP_KEYS, rather than a physical US-layout chord.
  { name: "help.open", keys: "?", what: copy.help, presses: [] },
  { name: "agent.restart-mode", keys: "R", what: copy.restartMode, presses: ["KeyR"], inRail: true },
  { name: "rail.remove", keys: "⌘⌫", what: copy.remove, presses: ["meta+Backspace"], inRail: true, hint: { label: copy.remove, at: { rail: 2 } } },
  { name: "ask.open", keys: "⌘/", what: copy.askBarShortcut, presses: ["meta+Slash"], hint: { label: copy.askBarShortcut, at: { rail: 4, agent: 3, bubble: 2, pad: 2, drawer: 2, shelf: 6 } } },
  { name: "todo.assign-slot", keys: "1–9", what: copy.todoAssignDigit, presses: Array.from({ length: 9 }, (_, at) => `Digit${at + 1}`), args: [{ key: "slot", type: "integer", min: 1, max: 9, required: true, press: slot => `Digit${slot}` }], inShelf: true, hint: { label: copy.assign, at: { shelf: 2 } } },
  { name: "todo.open-draft", keys: "⏎", what: copy.openDraft, presses: ["Enter"], inShelf: true },

  { name: "todo.add", keys: "N", what: copy.addTodo, presses: ["KeyN"], inShelf: true },
  { name: "todo.assign", keys: "O", what: copy.assignTodo, presses: ["KeyO"], inShelf: true, hint: { label: copy.assign, at: { shelf: 1 } } },
  { name: "shelf.maximise", keys: "M", what: copy.maximise, presses: ["KeyM"], inShelf: true, hint: { label: copy.maximise, at: { shelf: 0 } } },
  { name: "todo.delete", keys: "D", what: copy.deleteFocusedRow, presses: ["KeyD"], inShelf: true, hint: { label: copy.deleteFocusedRow, at: { shelf: 3 } } },
  { name: "todo.export", keys: "E", what: copy.exportMd, presses: ["KeyE"], inShelf: true, hint: { label: copy.exportMd, at: { shelf: 4 } } },
  { name: "shelf.close", keys: "Esc", what: copy.close, presses: ["Escape"], inShelf: true, hint: { label: copy.close, at: { shelf: 5 } } },
  { name: "terminal.text-larger", keys: "⌘=", what: copy.terminalLargerText, presses: ["meta+Equal"], inTerminals: true },
  { name: "terminal.text-smaller", keys: "⌘-", what: copy.terminalSmallerText, presses: ["meta+Minus"], inTerminals: true },
  { name: "terminal.text-reset", keys: "⌘0", what: copy.terminalResetText, presses: ["meta+Digit0"], inTerminals: true },
  { name: "editor.quote", keys: "⇧⌘B", what: copy.quote, presses: ["meta+shift+KeyB"], inEditor: true },
  { name: "editor.bullet-list", keys: "⌥⌘8", what: copy.bulletList, presses: ["alt+meta+Digit8"], inEditor: true },
  { name: "editor.numbered-list", keys: "⌥⌘7", what: copy.numberedList, presses: ["alt+meta+Digit7"], inEditor: true },
  { name: "editor.code-block", keys: "⌥⌘C", what: copy.codeBlock, presses: ["alt+meta+KeyC"], inEditor: true },
  { name: "editor.italic", keys: "⌘I", what: copy.italic, presses: ["meta+KeyI"], inEditor: true },
  { name: "editor.inline-code", keys: "⌘E", what: copy.inlineCode, presses: ["meta+KeyE"], inEditor: true },
  { name: "terminal.find", keys: "⌘F", what: copy.find, presses: ["meta+KeyF"], inTerminals: true },
  { name: "edit.undo", keys: "⌘Z", what: copy.undoFocused, presses: ["meta+KeyZ"] },
  { name: "edit.redo", keys: "⇧⌘Z", what: copy.redoFocused, presses: ["meta+shift+KeyZ"] },
  { name: "settings.open", keys: "⌘,", what: copy.settings, presses: ["meta+Comma"] },
  // U3751 to U3753: past the four hints a Shelf row shows, so the mode's own line lists them.
  { name: "todo.triage-enter", keys: "T", what: copy.triageEnter, presses: ["KeyT"], inShelf: true, hint: { label: copy.triageEnter, at: { shelf: 7 } } },
  { name: "todo.triage-move", keys: "J K", what: copy.triageMove, presses: ["KeyJ", "KeyK"], args: [{ key: "direction", type: "choice", options: ["up", "down"], required: true, press: direction => direction === "down" ? "KeyJ" : "KeyK" }], inShelf: true, inTriage: true },
  { name: "todo.triage-assign", keys: "A", what: copy.triageAssign, presses: ["KeyA"], inShelf: true, inTriage: true },
  { name: "todo.triage-workstream", keys: "W", what: copy.triageWorkstream, presses: ["KeyW"], inShelf: true, inTriage: true },
  { name: "todo.triage-nest", keys: "Tab", what: copy.triageNest, presses: ["Tab"], inShelf: true, inTriage: true },
  { name: "todo.triage-unnest", keys: "⇧Tab", what: copy.triageUnnest, presses: ["shift+Tab"], inShelf: true, inTriage: true },
  { name: "todo.triage-done", keys: "X", what: copy.triageDone, presses: ["KeyX"], inShelf: true, inTriage: true },
  { name: "todo.triage-comment", keys: "C", what: copy.triageComment, presses: ["KeyC"], inShelf: true, inTriage: true },
  { name: "todo.triage-leave", keys: "Esc", what: copy.triageLeave, presses: ["Escape"], inShelf: true, inTriage: true },
  // U4464: first-run-only; preserve the existing Project chord order.
  { name: "project.choose-folder", keys: "⌘O", what: copy.chooseFolder, presses: ["meta+KeyO"], inFirstRun: true },
];

/** One key `⌘K` takes next (U2239), by key position, read by Help (U54) and the leader panel (U2240). */
/** `what` is Help's line; `short` is the panel's, which fits the six keys on one line of the header band (U2240). */
export type LeaderKey = { name: string; args?: readonly ActionArg[]; keys: string; what: string; short: string; press: string };

export const LEADER: readonly LeaderKey[] = [
  { name: "leader.assign", keys: "A", what: copy.leaderAssignOrAsk, short: copy.leaderShortAssignOrAsk, press: "KeyA" },
  { name: "leader.project", keys: "P", what: copy.switchProject, short: copy.projects, press: "KeyP" },
  { name: "leader.changes", keys: "C", what: copy.reviewChanges, short: copy.reviewChanges, press: "KeyC" },
  { name: "leader.attention", keys: "J", what: copy.jumpToWhatNeedsYou, short: copy.leaderShortNeedsYou, press: "KeyJ" },
  { name: "leader.attention-other-project", keys: "⇧J", what: copy.jumpToWhatNeedsYouInAnotherProject, short: copy.leaderShortAnotherProject, press: "Shift+KeyJ" },
  { name: "leader.row", keys: "K", what: copy.switchToARowByName, args: [{ key: "query", type: "string" }], short: copy.leaderShortRow, press: "KeyK" },
  { name: "leader.bubble-minimise", keys: "M", what: copy.minimiseOrRestoreTheBubble, short: copy.leaderShortMinimise, press: "KeyM" },
  { name: "leader.bubble-close", keys: "W", what: copy.closeTheBubble, short: copy.leaderShortClose, press: "KeyW" },
  { name: "leader.shelf", keys: "B", what: copy.openShelf, short: copy.leaderShortShelf, press: "KeyB" },
  { name: "leader.capture", keys: "T", what: copy.captureATodo, short: copy.leaderShortCapture, press: "KeyT" },
  { name: "leader.inbox", keys: "I", what: copy.openTheInbox, short: copy.leaderShortInbox, press: "KeyI" },
];

/** Help's rows: the chords, with the leader's keys after `⌘K` (U2241). */
export const HELP_ROWS: readonly { keys: string; what: string }[] = [
  ...CHORDS.slice(0, 4),
  ...LEADER.map((key) => ({ keys: `${copy.leaderChord} ${key.keys}`, what: key.what })),
  ...CHORDS.slice(4),
];

/** NA5: every named action once, in Help's order. */
export const ACTION_ROWS: readonly (Chord | LeaderKey)[] = [...CHORDS.slice(0, 4), ...LEADER, ...CHORDS.slice(4)];

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

/** U5217: a chord as `aria-keyshortcuts` writes it (`Alt+Meta+N`), read from the same press `CHORDS` binds. */
export const ariaShortcut = (keys: string): string => {
  const parts = (CHORDS.find((chord) => chord.keys === keys)?.presses[0] ?? "").split("+");
  const names = { ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" };

  return [...Object.entries(names).filter(([part]) => parts.includes(part)).map(([, name]) => name), parts.at(-1)!.replace(/^Key/, "")].join("+");
};
