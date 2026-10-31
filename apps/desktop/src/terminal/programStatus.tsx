import type { Status } from "@contracts/Status";
import { KindGlyph } from "../ink/KindGlyph";
import { copy } from "./copy";

const DIRECTION = /[‪-‮⁦-⁩]/g;

const WORDS = { error: copy.error, "needs-you": copy.needsYou, blocked: copy.blocked, working: copy.working, idle: copy.idle, done: copy.done } as const;

/** PS10.3: the label as text with Unicode direction overrides and isolates removed; an empty one reads as the Kind's word (PS10.2). Markup stays characters because every surface renders it as a text node. */
export const statusText = (status: Status): string => status.label.replace(DIRECTION, "").trim() || WORDS[status.kind];

/** The tab's accessible name: its name, then the program status. */
export const tabLabel = (name: string, status: Status | undefined): string => status ? copy.tabWithStatus(name, statusText(status)) : name;

/** The glyph a Terminal tab shows in its trailing slot while its program reports a status; the label is the tab's tooltip and accessible name. */
export const ProgramStatusMark = (props: { status: Status }) => <span class="terminal-tab-program" data-program-status={props.status.kind}><KindGlyph kind={props.status.kind} /></span>;
