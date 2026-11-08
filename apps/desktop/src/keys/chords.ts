import { appSettings } from "../settings/preferences";
import { copy } from "./copy";

declare const keyText: unique symbol;

/** Key text created only by the key registry or its recorded-press formatter. */
export type KeyText = string & { readonly [keyText]: true };

// SAFETY: this private constructor brands only this module's registry text.
const textOf = (text: string): KeyText => text as KeyText;

// SAFETY: a table's rows keep their live getters; only the private type brand is added.
const withKeyTexts = <T extends Record<string, { keys: string }>>(table: T): { readonly [Name in keyof T]: T[Name] & { keys: KeyText } } => table as { [Name in keyof T]: T[Name] & { keys: KeyText } };

// SAFETY: preserve each original row (including its live getters), adding only the private type brand.
const withKeyText = <T extends { keys: string }>(row: T): T & { keys: KeyText } => row as T & { keys: KeyText };

/** NA3: a value an action argument holds once parsed. */
export type ActionValue = string | number | boolean;

export type ActionValues = Readonly<Record<string, ActionValue>>;

/** NA1: one `key=value` argument of a named action; optional unless `required`. `press` names the key press that runs the action for a value, where its binding is per press. */
export type ActionArg = { key: string; required?: true; press?: (value: ActionValue) => string } & (
  { type: "string" } | { type: "integer"; min: number; max: number } | { type: "boolean" } | { type: "choice"; options: readonly string[] }
);

/** One line of Help (U54): the chord as shown, what it does, and every key press it stands for as `<mods>+<code>`, mods in the order `ctrl+alt+meta+shift`. `inFirstRun` keeps a chord in first-run Help only; `inRail` marks a chord only a focused Rail row binds (U358); `inTerminals` marks the scoped Agent/Bubble/tab switch; the rest bind from the pane too. */
export type Chord = { name: string; args?: readonly ActionArg[]; keys: KeyText; what: string; presses: readonly string[]; inFirstRun?: true; inRail?: true; inTerminals?: true; /** Listed in Help's Shelf section. */ inShelf?: true; /** A floating App layer that owns Escape over the Terminal while it shows, so no App-wide chord lists it. */ ownsEscape?: true; inEditor?: true; /** U3751: a key of Todo triage mode, bound only while the mode is on. */ inTriage?: true; hint?: Hint };

/** Where focus can sit for the hint line (U2230a): a Rail row, watched Agent, Bubble, Pad, Drawer, Switcher or Editor. */
export type HintPlace = "rail" | "agent" | "bubble" | "pad" | "drawer" | "switcher" | "editor" | "shelf";

/** A chord shown under focus: its short `label` and its position `at` in each place's line (U2230). */
export type Hint = { label: string; at: Partial<Record<HintPlace, number>> };

/** Commands bound in the webview, including focused Terminal actions, in Help's order (U54, U2241). Only `⌘N`, `⇧⌘N`, `⌥⌘N`, `⇧⌘M`, `⌘T`, `⇧⌘T`, `⌘K`, `⇧⌘P`, `⌘/` and `⌃⌘J` bind at App scope; every other `⌃`, `⌥` and `⌘` key reaches the Terminal. `⌘B` switches only between the selected Agent emulator and an eligible Bubble/tab (U2742c). The Terminal's own `⌘C`, `⌘V`, `⌘=`, `⌘-` and `⌘0` act only in a Terminal screen, where `?` never opens Help. */
/** The label and the binding are derived from the same saved physical press. */
export const shortcutLabel = (press: string, keyName = ""): KeyText => {
  const parts = press.split("+");
  const code = parts.at(-1) ?? "";
  const key = code.replace(/^Key|^Digit/, "");
  const known = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-2]))$/.test(code);
  const label = [...Object.entries(copy.shortcutKeys), ...Object.entries(copy.shortcutSymbols)].find(([name]) => name === code)?.[1];


  // SAFETY: physical presses and saved key names enter the display registry here.
  return `${parts.includes("ctrl") ? "⌃" : ""}${parts.includes("alt") ? "⌥" : ""}${parts.includes("shift") ? "⇧" : ""}${parts.includes("meta") ? "⌘" : ""}${label ?? (known ? key : keyName || key)}` as KeyText;
};

const CHORD_TABLE = {
  "agent.new": { name: "agent.new", keys: "⌘N", what: copy.newAgent, presses: ["meta+KeyN"] },
  "agent.new-with-prompt": { name: "agent.new-with-prompt", keys: "⇧⌘N", what: copy.newAgentWithAPrompt, args: [{ key: "prompt", type: "string" }], presses: ["meta+shift+KeyN"] },
  "workstream.new": { name: "workstream.new", keys: "⌥⌘N", what: copy.newWorkstreamTitle, presses: ["alt+meta+KeyN"] },
  "mode.new": { name: "mode.new", keys: "⇧⌘M", what: copy.newMode, presses: ["meta+shift+KeyM"] },
  "terminal.new": { name: "terminal.new", keys: "⌘T", what: copy.newTerminal, presses: ["meta+KeyT"] },
  "leader.open": { name: "leader.open", keys: "⌘K", what: copy.leaderWaitsForAKey, presses: ["meta+KeyK"], hint: { label: copy.leaderWaitsForAKey, at: { rail: 3, agent: 2, bubble: 1, pad: 1, drawer: 1 } } },
  "switcher.open": { name: "switcher.open", keys: "⇧⌘P", what: copy.openTheSwitcher, presses: ["meta+shift+KeyP"] },
  "feedback.open": { name: "feedback.open", keys: "⇧⌘F", what: copy.sendFeedback, presses: ["meta+shift+KeyF"] },
  "attention.jump": { name: "attention.jump", keys: "⌃⌘J", what: copy.jumpToWhatNeedsYou, presses: ["ctrl+meta+KeyJ"], hint: { label: copy.jumpToWhatNeedsYou, at: { rail: -1, agent: -1, bubble: -1, shelf: -1, pad: -1, drawer: -1 } } },
  "todo.capture": { name: "todo.capture", get keys() { return shortcutLabel(appSettings().quickAdd, appSettings().quickAddKey); }, what: copy.captureATodo, get presses() { return [appSettings().quickAdd]; } },
  "terminal.switch": { name: "terminal.switch", keys: "⌘B", what: copy.switchAgentTerminal, presses: ["meta+KeyB"], inTerminals: true, hint: { label: copy.switchAgentTerminal, at: { agent: 0, bubble: 0 } } },
  // U5171: the Rail binds the arrows itself (RAIL_KEYS), so Help names them with no press for the chord probe to compare.
  "rail.collapse-expand": { name: "rail.collapse-expand", keys: "← →", what: copy.collapseExpand, presses: [], inRail: true },
  "rail.move": { name: "rail.move", keys: "M", what: copy.moveTo, presses: ["KeyM"], inRail: true },
  "rail.rename": { name: "rail.rename", keys: copy.renameChord, what: copy.rename, presses: [copy.renameChord], inRail: true },
  // Help follows the logical ? through HELP_KEYS, rather than a physical US-layout chord.
  "help.open": { name: "help.open", keys: "?", what: copy.help, presses: [] },
  "agent.restart-mode": { name: "agent.restart-mode", keys: "R", what: copy.restartMode, presses: ["KeyR"], inRail: true },
  "rail.remove": { name: "rail.remove", keys: "⇧⌘⌫", what: copy.remove, presses: ["meta+shift+Backspace"], hint: { label: copy.remove, at: { rail: 2 } } },
  "ask.open": { name: "ask.open", keys: "⌘/", what: copy.askBarShortcut, presses: ["meta+Slash"], hint: { label: copy.askBarShortcut, at: { rail: 4, agent: 3, bubble: 2, pad: 2, drawer: 2, shelf: 6 } } },
  "todo.assign-slot": { name: "todo.assign-slot", keys: "1–9", what: copy.todoAssignDigit, presses: Array.from({ length: 9 }, (_, at) => `Digit${at + 1}`), args: [{ key: "slot", type: "integer", min: 1, max: 9, required: true, press: (slot: ActionValue) => `Digit${slot}` }], inShelf: true, hint: { label: copy.assign, at: { shelf: 2 } } },
  "todo.open-draft": { name: "todo.open-draft", keys: "⏎", what: copy.openDraft, presses: ["Enter"], inShelf: true },

  "todo.add": { name: "todo.add", keys: "N", what: copy.addTodo, presses: ["KeyN"], inShelf: true },
  "todo.assign": { name: "todo.assign", keys: "O", what: copy.assignTodo, presses: ["KeyO"], inShelf: true, hint: { label: copy.assign, at: { shelf: 1 } } },
  "shelf.maximise": { name: "shelf.maximise", keys: "M", what: copy.maximise, presses: ["KeyM"], inShelf: true, hint: { label: copy.maximise, at: { shelf: 0 } } },
  "todo.delete": { name: "todo.delete", keys: "D", what: copy.deleteFocusedRow, presses: ["KeyD"], inShelf: true, hint: { label: copy.deleteFocusedRow, at: { shelf: 3 } } },
  "todo.export": { name: "todo.export", keys: "E", what: copy.exportMd, presses: ["KeyE"], inShelf: true, hint: { label: copy.exportMd, at: { shelf: 4 } } },
  "rail.close-peek": { name: "rail.close-peek", keys: "Esc", what: copy.close, presses: ["Escape"], ownsEscape: true },
  "shelf.close": { name: "shelf.close", keys: "Esc", what: copy.close, presses: ["Escape"], inShelf: true, ownsEscape: true, hint: { label: copy.close, at: { shelf: 5 } } },
  "terminal.text-larger": { name: "terminal.text-larger", keys: "⌘=", what: copy.terminalLargerText, presses: ["meta+Equal"], inTerminals: true },
  "terminal.text-smaller": { name: "terminal.text-smaller", keys: "⌘-", what: copy.terminalSmallerText, presses: ["meta+Minus"], inTerminals: true },
  "terminal.text-reset": { name: "terminal.text-reset", keys: "⌘0", what: copy.terminalResetText, presses: ["meta+Digit0"], inTerminals: true },
  "editor.quote": { name: "editor.quote", keys: "⇧⌘B", what: copy.quote, presses: ["meta+shift+KeyB"], inEditor: true },
  "editor.bullet-list": { name: "editor.bullet-list", keys: "⌥⌘8", what: copy.bulletList, presses: ["alt+meta+Digit8"], inEditor: true },
  "editor.numbered-list": { name: "editor.numbered-list", keys: "⌥⌘7", what: copy.numberedList, presses: ["alt+meta+Digit7"], inEditor: true },
  "editor.code-block": { name: "editor.code-block", keys: "⌥⌘C", what: copy.codeBlock, presses: ["alt+meta+KeyC"], inEditor: true },
  "editor.italic": { name: "editor.italic", keys: "⌘I", what: copy.italic, presses: ["meta+KeyI"], inEditor: true },
  "editor.inline-code": { name: "editor.inline-code", keys: "⌘E", what: copy.inlineCode, presses: ["meta+KeyE"], inEditor: true },
  "terminal.find": { name: "terminal.find", keys: "⌘F", what: copy.find, presses: ["meta+KeyF"], inTerminals: true },
  "edit.undo": { name: "edit.undo", keys: "⌘Z", what: copy.undoFocused, presses: ["meta+KeyZ"] },
  "edit.redo": { name: "edit.redo", keys: "⇧⌘Z", what: copy.redoFocused, presses: ["meta+shift+KeyZ"] },
  "settings.open": { name: "settings.open", keys: "⌘,", what: copy.settings, presses: ["meta+Comma"] },
  // U5242c: ⌘[ goes Back while Settings is open; ⌘] reopens what Back closed.
  "settings.forward": { name: "settings.forward", keys: "⌘]", what: copy.settingsForward, presses: ["meta+BracketRight"], inRail: true },
  // U3751 to U3753: past the four hints a Shelf row shows, so the mode's own line lists them.
  "todo.triage-enter": { name: "todo.triage-enter", keys: "T", what: copy.triageEnter, presses: ["KeyT"], inShelf: true, hint: { label: copy.triageEnter, at: { shelf: 7 } } },
  "todo.triage-move": { name: "todo.triage-move", keys: "J K", what: copy.triageMove, presses: ["KeyJ", "KeyK"], args: [{ key: "direction", type: "choice", options: ["up", "down"], required: true, press: (direction: ActionValue) => direction === "down" ? "KeyJ" : "KeyK" }], inShelf: true, inTriage: true },
  "todo.triage-assign": { name: "todo.triage-assign", keys: "A", what: copy.triageAssign, presses: ["KeyA"], inShelf: true, inTriage: true },
  "todo.triage-workstream": { name: "todo.triage-workstream", keys: "W", what: copy.triageWorkstream, presses: ["KeyW"], inShelf: true, inTriage: true },
  "todo.triage-nest": { name: "todo.triage-nest", keys: "Tab", what: copy.triageNest, presses: ["Tab"], inShelf: true, inTriage: true },
  "todo.triage-unnest": { name: "todo.triage-unnest", keys: "⇧Tab", what: copy.triageUnnest, presses: ["shift+Tab"], inShelf: true, inTriage: true },
  "todo.triage-done": { name: "todo.triage-done", keys: "X", what: copy.triageDone, presses: ["KeyX"], inShelf: true, inTriage: true },
  "todo.triage-comment": { name: "todo.triage-comment", keys: "C", what: copy.triageComment, presses: ["KeyC"], inShelf: true, inTriage: true },
  "todo.triage-leave": { name: "todo.triage-leave", keys: "Esc", what: copy.triageLeave, presses: ["Escape"], inShelf: true, inTriage: true },
  // U4464: first-run-only; preserve the existing Project chord order.
  "project.choose-folder": { name: "project.choose-folder", keys: "⌘O", what: copy.chooseFolder, presses: ["meta+KeyO"], inFirstRun: true },
} satisfies Record<string, Omit<Chord, "keys"> & { keys: string }>;

/** Every chord by name; a renamed or missing name fails the type check. */
export const CHORDS = withKeyTexts(CHORD_TABLE);

export type ChordName = keyof typeof CHORDS;

/** The chords in table order, for code that reads every row. */
export const CHORD_ROWS: readonly Chord[] = Object.values(CHORDS);

/** U6544b: the keys that close a focused Project tab. A tab binds them itself, so no App chord, Help row or action lists them. */
export const TAB_CLOSE: Chord = withKeyText({ name: "tab.close", keys: "⌫ ⌦", what: copy.close, presses: "Backspace Delete".split(" ") });

/** U5239b: the default label of each action a saved override can move, so a caller naming an action by its default keys still finds it. */
const DEFAULT_KEYS = new Map<string, string>();

/** The label `chord` shows with no override: a stable id for code that names an action by its keys. */
export const defaultKeys = (chord: Chord | LeaderKey): string => DEFAULT_KEYS.get(chord.name) ?? chord.keys;

/** U5239b: an action a press can be recorded for: one press of its own, quick add excepted (U3804 keeps its field). */
export const recordable = (chord: Chord): boolean => chord.name !== "todo.capture" && DEFAULT_PRESSES.get(chord.name)?.length === 1;

const DEFAULT_PRESSES = new Map(CHORD_ROWS.map((chord) => [chord.name, chord.presses]));

/** The press `name` runs on with no override. */
export const defaultPress = (name: string): string | undefined => DEFAULT_PRESSES.get(name)?.[0];

// U5239b: resolution runs default, then the saved override; Help, hints, the key handler and `keys` all read these two properties.
for (const chord of CHORD_ROWS) {
  if (chord.name === "todo.capture") continue;

  const keys = chord.keys;
  const presses = chord.presses;

  DEFAULT_KEYS.set(chord.name, keys);

  if (!recordable(chord)) continue;

  Object.defineProperties(chord, {
    keys: { enumerable: true, get: () => {
      const press = appSettings().shortcuts[chord.name];

      return press ? shortcutLabel(press) : keys;
    } },
    presses: { enumerable: true, get: () => {
      const press = appSettings().shortcuts[chord.name];

      return press ? [press] : presses;
    } },
  });
}

/** One key `⌘K` takes next (U2239), by key position, read by Help (U54) and the leader panel (U2240). */
/** `what` is Help's line; `short` is the panel's, which fits the six keys on one line of the header band (U2240). */
export type LeaderKey = { name: string; args?: readonly ActionArg[]; keys: KeyText; what: string; short: string; press: string };

const LEADER_TABLE = {
  "leader.assign": { name: "leader.assign", keys: "A", what: copy.leaderAssignOrAsk, short: copy.leaderShortAssignOrAsk, press: "KeyA" },
  "leader.project": { name: "leader.project", keys: "P", what: copy.switchProject, short: copy.projects, press: "KeyP" },
  "leader.changes": { name: "leader.changes", keys: "C", what: copy.reviewChanges, short: copy.reviewChanges, press: "KeyC" },
  "leader.attention": { name: "leader.attention", keys: "J", what: copy.jumpToWhatNeedsYou, short: copy.leaderShortNeedsYou, press: "KeyJ" },
  "leader.attention-other-project": { name: "leader.attention-other-project", keys: "⇧J", what: copy.jumpToWhatNeedsYouInAnotherProject, short: copy.leaderShortAnotherProject, press: "Shift+KeyJ" },
  "leader.row": { name: "leader.row", keys: "K", what: copy.switchToARowByName, args: [{ key: "query", type: "string" }], short: copy.leaderShortRow, press: "KeyK" },
  "leader.bubble-minimise": { name: "leader.bubble-minimise", keys: "M", what: copy.minimiseOrRestoreTheBubble, short: copy.leaderShortMinimise, press: "KeyM" },
  "leader.bubble-close": { name: "leader.bubble-close", keys: "W", what: copy.closeTheBubble, short: copy.leaderShortClose, press: "KeyW" },
  "leader.shelf": { name: "leader.shelf", keys: "B", what: copy.rotateShelf, short: copy.leaderShortShelf, press: "KeyB" },
  "leader.rail": { name: "leader.rail", keys: "R", what: copy.toggleTheRail, short: copy.rail, press: "KeyR" },
  "leader.capture": { name: "leader.capture", keys: "T", what: copy.captureATodo, short: copy.leaderShortCapture, press: "KeyT" },
  "leader.inbox": { name: "leader.inbox", keys: "I", what: copy.openTheInbox, short: copy.leaderShortInbox, press: "KeyI" },
} satisfies Record<string, Omit<LeaderKey, "keys"> & { keys: string }>;

export const LEADER = withKeyTexts(LEADER_TABLE);

/** The leader keys in table order. */
export const LEADER_ROWS: readonly LeaderKey[] = Object.values(LEADER);

/** The four chords that open Help's list, ahead of the leader's keys (U2241). */
const HEAD_NAMES: readonly ChordName[] = ["agent.new", "agent.new-with-prompt", "workstream.new", "mode.new"];

const HELP_HEAD = HEAD_NAMES.map((name) => CHORDS[name]);

const HELP_TAIL = CHORD_ROWS.filter((row) => !HEAD_NAMES.some((name) => name === row.name));

/** Help's rows: the chords, with the leader's keys after `⌘K` (U2241). */
export const HELP_ROWS: readonly { keys: KeyText; what: string }[] = [
  ...HELP_HEAD,
  ...LEADER_ROWS.map((key) => ({ keys: leaderKeys(key), what: key.what })),
  ...HELP_TAIL,
];

/** NA5: every named action once, in Help's order. */
export const ACTION_ROWS: readonly (Chord | LeaderKey)[] = [...HELP_HEAD, ...LEADER_ROWS, ...HELP_TAIL];

/** The hints of `place`, in the order the table gives them (U2230a). */
export const hintsFor = (place: HintPlace): readonly { keys: KeyText; label: string }[] => {
  const hints = CHORD_ROWS.flatMap((chord) => chord.hint?.at[place] === undefined ? [] : [{ keys: chord.keys, label: chord.hint.label, at: chord.hint.at[place] }])
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


/** Existing Rail navigation, kept local to Keys until its Rail lane adopts Ark. */
export const RAIL_KEYS = "ArrowLeft ArrowRight F2".split(" ");

export const HELP_KEYS = ["[Shift]+?"];

export const SWITCHER_CLOSE = "Escape".split(" ");

/** U5240c, U5240d: `⌘⏎` on a highlighted command records a new key for it. */
export const SWITCHER_RECORD = [["Meta", "Enter"].join("+")];

/** U5240c: the keys the Switcher's footer lists, read by its bindings above (`⌘⏎` joins while its row can take a key). */
// SAFETY: navigation text is defined only in this registry.
export const SWITCHER_KEYS = { move: textOf("↑ ↓"), choose: textOf("⏎"), close: textOf("Esc"), record: textOf("⌘⏎") };

export const ASK_CLOSE = "Escape".split(" ");

/** Fields that take typing (a modal layer's own text field, U529). */
export const TEXT_FIELDS = "input,textarea";

/** `aria-keyshortcuts` of a row's first press; undefined when it has none (U5247). */
export const ariaChord = (chord: Chord | undefined): string | undefined => {
  const press = chord?.presses[0];

  if (!press) return undefined;

  const parts = press.split("+");
  const names = { ctrl: "Control", alt: "Alt", shift: "Shift", meta: "Meta" };

  return [...Object.entries(names).filter(([part]) => parts.includes(part)).map(([, name]) => name), (parts.at(-1) ?? "").replace(/^Key/, "")].join("+");
};

/** A leader sequence retains its two press boundaries. */
export function leaderKeys(row: LeaderKey): KeyText {
  // SAFETY: both parts already carry the private registry brand.
  return `${CHORDS["leader.open"].keys} ${row.keys}` as KeyText;
}

/** Navigation hints share the registry source without claiming an action binding. */
// SAFETY: navigation text is defined only in this registry.
export const SHELF_KEYS = { adjacent: textOf("↑ / ↓"), toggle: textOf("⌘⏎"), range: textOf("⇧↑ / ⇧↓"), cancel: textOf([copy.shortcutSymbols.Backspace, "/", "Esc"].join(" ")) };
