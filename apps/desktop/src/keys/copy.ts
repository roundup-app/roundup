/** App-authored keys copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  settings: shared.settings,

  close: shared.close,

  maximise: shared.maximise,
  restore: shared.restore,
  newAgent: shared.newAgent,
  newTerminal: shared.newTerminal,
  remove: shared.remove,
  leaderShortNeedsYou: shared.needsYou,
  leaderShortMinimise: shared.minimise,
  leaderShortClose: shared.close,
  leaderShortShelf: shared.leaderShortShelf,
  leaderShortCapture: shared.leaderShortCapture,
  captureATodo: shared.captureATodo,
  leaderShortInbox: shared.leaderShortInbox,
  exportMd: shared.exportMd,
  assign: shared.assign,
  askBarShortcut: shared.askBarShortcut,

  triageMove: shared.move,
  triageAssign: shared.assign,
  triageDone: shared.done,
  triageComment: shared.comment,
  shortcutKeys: new Map([
    ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map(letter => [`Key${letter}`, letter]),
    ...[..."0123456789"].map(digit => [`Digit${digit}`, digit]),
    ...Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, `F${index + 1}`]),
    ["Space", "Space"], ["Tab", "Tab"], ["Enter", "⏎"], ["Backspace", "⌫"], ["Delete", "⌦"],
    ["Comma", ","], ["Period", "."], ["Slash", "/"], ["Semicolon", ";"], ["Quote", "'"],
    ["Minus", "-"], ["Equal", "="], ["Backquote", "`"], ["BracketLeft", "["], ["BracketRight", "]"], ["Backslash", "\\"],
    ["ArrowUp", "↑"], ["ArrowDown", "↓"], ["ArrowLeft", "←"], ["ArrowRight", "→"],
  ].map(([code, label]) => [code!, label!])),
  help: "Help",
  helpScope: { app: "App", leader: "Leader", terminals: "Agent or Bubble", rail: "Rail row", shelf: shared.leaderShortShelf, todos: "Todos view", triage: shared.triage },
  helpBubbleScope: { M: "Minimise or restore", W: "Close focused Bubble" },
  helpRowScope: { O: "Assign item", D: "Delete item", E: "Export focused Pad" },
  deleteFocusedRow: "Delete row",
  shelfKeys: "Work items keys",
  previousNextKeys: "↑ / ↓",
  /** @prose */
  focusThePreviousNextShelfRow: "Focus the previous or next work item.",
  enter: "⌘⏎",
  /** @prose */
  toggleTheFocusedShelfRowSelection: "Select or deselect the focused work item.",
  rangeKeys: "⇧↑ / ⇧↓",
  /** @prose */
  selectARangeOfShelfRows: "Select a range of work items.",
  esc: "⌫ / Esc",
  /** @prose */
  deleteSelectedShelfRowsCancelSelection: "Delete selected work items, or leave selection.",
  /** @prose */
  jumpToWhatNeedsYou: "Reach what needs you.",
  /** @prose */
  newAgentWithAPrompt: "Start an Agent with a prompt.",
  switchAgentTerminal: "Switch Agent / Terminal",
  /** @prose */
  minimiseOrRestoreTheBubble: "Minimise or restore the Bubble.",
  closeTheBubble: "Close the Bubble",
  leaderChord: "⌘K",
  leaderPanel: "Press a key",
  leaderShortAnotherProject: "Other Project",
  leaderShortRow: "Row",
  openTheInbox: "Open the Inbox",
  /** @prose */
  leaderWaitsForAKey: "Press one more key.",
  /** @prose */
  switchToARowByName: "Switch to a row by name.",
  /** @prose */
  jumpToWhatNeedsYouInAnotherProject: "Reach what needs you in another Project.",
  /** @prose */
  showOrHideTheShelf: "Show or hide work items.",
  /** @prose */
  assignTodo: "Assign a Todo or Pad to an owner.",
  /** @prose */
  todoAssignDigit: "Hand the Todo to an Agent by number.",
  /** @prose */
  todoLift: "Lift or hand over the Todo.",
  todoLiftTarget: "Choose Todo owner",
  triageEnter: "Triage Todos",
  triageWorkstream: shared.triageWorkstream,
  triageNest: "Nest",
  triageUnnest: "Un-nest",
  triageLeave: "Leave",
} as const;
