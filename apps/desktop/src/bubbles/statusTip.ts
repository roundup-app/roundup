import type { TerminalInfo } from "@contracts/terminal/TerminalInfo";
import { LABELS } from "../ink/KindGlyph";
import { age } from "../shelf/Age";

/** PS12.3: the name, then the program's label (the Kind's word when empty) and its age. */
export const statusTip = (name: string, status: TerminalInfo["status"], now: number): string =>
  status ? `${name} · ${status.label || LABELS[status.kind]} · ${age(status.since, now)}` : name;
