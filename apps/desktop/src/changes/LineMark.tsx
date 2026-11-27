import { Match, Show, Switch } from "solid-js";
import type { CompareTarget } from "@contracts/agent/CompareTarget";
import type { Found, Gapped, Movement, Spotted } from "./diffDraw";
import type { Explaining, FileExplaining } from "./explain";
import { ExplainedLines } from "./ExplainedLines";
import { FindingLines } from "./FindingLines";
import type { FileFindings } from "./findings";
import { GapLine } from "./GapLine";
import { MovedLines } from "./MovedLines";
import { RepeatedLines } from "./RepeatedLines";
import { SpotLine } from "./SpotLine";

/** What a diff draws under a line besides a note: a spot: a repeat's other place (U7685a) or what a tool said (U7704a), a gap the readback found (U7688e), moved or renamed code (U7696a), the explanation of lines the user asked about (U7698b), a finding of the defect pass (U7700c). */
export const LineMark = (props: { metadata: Spotted | Gapped | Movement | Explaining | Found; id: string; name: string; to: CompareTarget; openAt: ((path: string, at: { side: "new"; line: number }) => void) | undefined; explained: FileExplaining; found: FileFindings }) => <Switch>
  <Match when={"spotting" in props.metadata && props.metadata}>{spotted => <Show when={spotted().spot.source.kind === "repeats" && spotted().spot.other} fallback={<SpotLine spot={spotted().spot} />}>{other => <RepeatedLines id={props.id} other={other()} to={props.to} open={(path, at) => props.openAt?.(path, at)} />}</Show>}</Match>
  <Match when={"gapped" in props.metadata && props.metadata}>{gapped => <GapLine agent={props.name} gap={gapped().gap} />}</Match>
  <Match when={"moving" in props.metadata && props.metadata}>{moving => <MovedLines moved={moving().moved} />}</Match>
  <Match when={"explaining" in props.metadata && props.metadata}>{explaining => <ExplainedLines asked={explaining().asked} explained={props.explained} />}</Match>
  <Match when={"found" in props.metadata && props.metadata}>{found => <FindingLines finding={found().finding} found={props.found} />}</Match>
</Switch>;
