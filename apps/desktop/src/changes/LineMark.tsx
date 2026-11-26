import { Match, Switch } from "solid-js";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import { copy } from "./copy";
import type { Gapped, Mark, Repeated } from "./diffDraw";
import { GapLine } from "./GapLine";
import { RepeatedLines } from "./RepeatedLines";

type Range = { side: "old" | "new"; start: number; end: number };

/** What a diff draws under a line besides a note: the mark of unfinished work (U7676c), a repeat's other place (U7685a), a gap the readback found (U7688e). */
export const LineMark = (props: { metadata: Mark | Repeated | Gapped; id: string; name: string; to: CompareTarget; openAt: ((path: string, at: { side: "new"; line: number }) => void) | undefined; note: (range: Range) => void }) => <Switch>
  <Match when={"unfinished" in props.metadata && props.metadata}>{mark => <button type="button" class="diff-note" onClick={() => props.note({ side: mark().side, start: mark().start, end: mark().end })}>{copy.unfinishedWork}</button>}</Match>
  <Match when={"repeating" in props.metadata && props.metadata}>{repeat => <RepeatedLines id={props.id} hit={repeat().hit} to={props.to} open={(path, at) => props.openAt?.(path, at)} />}</Match>
  <Match when={"gapped" in props.metadata && props.metadata}>{gapped => <GapLine agent={props.name} gap={gapped().gap} />}</Match>
</Switch>;
