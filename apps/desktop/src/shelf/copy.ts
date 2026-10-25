/** App-authored shelf copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

export const copy = {
  draftStatus: shared.draftStatus,
  todos: shared.todos,
  pads: shared.pads,
  cancel: shared.cancel,

  delete: shared.delete,
  keep: shared.keep,
  pad: shared.pad,
  ownedBy: shared.ownedBy,
  unassigned: shared.unassigned,
  addTodoTo: shared.addTodoTo,
  overview: shared.overview,
  doneCount: shared.doneCount,
  clear: shared.clear,
  questionMark: shared.questionMark,
  refresh: shared.importRefresh,
  shelfLabel: shared.leaderShortShelf,
  me: shared.me,
  todo: shared.todo,
  comma: shared.comma,
  couldNotDelete: "Could not delete",
  shelfDeletion: "Work items deletion",
  selected: " selected",
  deleteWord: "Delete ",
  /** @prose */
  agentsMayStillBeWritingDeletingDoesNot: ". Agents may still be writing; deleting does not stop them",
  colon: ": ",
} as const;
