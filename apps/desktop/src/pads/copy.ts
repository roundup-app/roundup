/** App-authored pads copy (U471). Supplied values remain unchanged. */
import { copy as shared } from "../sharedCopy";

import type { CopyValue } from "../sharedCopy";

export const copy = {

  dismiss: shared.dismissFailure,
  draftField: shared.draftField,
  draftIdentity: shared.draftIdentity,
  currentDraft: shared.currentDraft,
  draftStatus: shared.draftStatus,
  storageRetry: shared.storageRetry,
  discardRevision: shared.discardRevision,
  draftRetention: shared.draftRetention,
  copyField: shared.copyField,
  copyDraftFailure: shared.copyDraftFailure,
  pads: shared.pads,
  exportMd: shared.exportMd,
  delete: shared.delete,
  keep: shared.keep,
  pad: shared.pad,
  ownedBy: shared.ownedBy,
  assign: shared.assign,
  blocks: shared.blocks,
  resume: shared.resume,
  /** @prose */
  hasExitedAndCannotBeResumed: (value1: CopyValue) => `${value1} has exited and cannot resume.`,
  openOwner: "Open owner",
  ownerName: (value1: CopyValue) => `Open owner: ${value1}`,
  padDeleteQuestion: (name: string) => `Delete ${name}?`,
  /** @prose */
  padDeleteOwnership: (name: string) => `${name} owns it. You may delete any Pad.`,
  padSaved: "Saved",
  padChanged: "Pad changed",
  /** @prose */
  padSourceMappingFailed: "Edited blocks could not be matched to the original source. Copy your unfinished work, then reopen the Pad.",
  /** @prose */
  padDeleteUnsaved: "Unsaved changes will be lost.",
  changedBy: "Changed by ",
  keepMine: "Keep mine",
  useTheirs: "Use theirs",
  bold: "Bold",
  italic: "Italic",
  strikethrough: "Strikethrough",
  inlineCode: "Inline code",
  bulletList: "Bullet list",
  numberedList: "Numbered list",
  checklist: "Checklist",
  link: "Link",
  codeBlock: "Code block",
  quote: "Quote",
  horizontalRule: "Horizontal rule",
  /** @prose */
  padEditorHostIsMissing: "The Pad editor is missing. Reopen the Pad.",
  /** @prose */
  padEditorToolbarActionHasNoName: (value1: CopyValue) => `Editor action ${value1} has no name. Reopen the Pad.`,
  text: shared.text,
  headingOne: "Heading 1",
  headingTwo: "Heading 2",
  headingThree: "Heading 3",
  /** @prose */
  padEditorDidNotOpen: "The Pad editor did not open. Reopen the Pad.",
  /** @prose */
  padEditorToolbarChanged: "The Pad editor has changed. Reopen the Pad.",
  /** @prose */
  padEditorToolbarLabelIsMissing: "An editor label is missing. Reopen the Pad.",
  heading: "Heading",
  padBody: "Pad body",
  addPad: "Add Pad",
  noPadsYet: "No Pads yet",
  /** @prose */
  noPadsHint: "Agents write them as they work, or press + Pad.",
  padName: "Pad name",
  newPadPlaceholder: "New Pad",
  /** @prose */
  notAnExcalidrawScene: "This file is not an Excalidraw scene. Choose another file.",
  drawing: (value1: CopyValue) => `Drawing: ${value1}`,
  invalidDiagram: "Invalid diagram",
  mermaid: (value1: CopyValue) => `Mermaid: ${value1}`,
  noOtherOwners: "No other owners",
  assignPadNamed: (name: CopyValue) => `assign ${name}`,
  ownersForPad: (name: CopyValue) => `Owners for ${name}`,
  /** @prose */
  padOwnerRefused: (cause: CopyValue) => `The Pad stays yours: ${cause}. Choose another owner.`,
  makeYours: "Make yours",
  makePadYours: (value1: CopyValue) => `Make ${value1} yours`,
} as const;
