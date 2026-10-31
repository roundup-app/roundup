import type { Status } from "@contracts/Status";
import { copy as shared } from "../sharedCopy";

const DIRECTION = /[‪-‮⁦-⁩]/g;

const WORDS = { error: shared.error, "needs-you": shared.needsYou, blocked: shared.blocked, working: shared.working, idle: shared.idle, done: shared.done } as const;

/** PS10.3: the label as text with Unicode direction overrides and isolates removed; an empty one reads as the Kind's word (PS10.2). Markup stays characters because every surface renders it as a text node. */
export const statusText = (status: Status): string => status.label.replace(DIRECTION, "").trim() || WORDS[status.kind];
