import { CHORDS } from "../keys/chords";
import { EmptyState } from "../ink/EmptyState";
import { copy } from "./copy";

/** Screen 11 of `docs/wireframes.md`: each region says what will live there; there is no tutorial. */
export const EmptyRail = (props: { onNew?: () => void; onWorkstream?: () => void; available?: boolean }) => (
  <EmptyState art="plant" {...{ title: copy.emptyRailTitle }} line={copy.emptyRailLine} actions={props.onWorkstream ? [
    { label: copy.newAgent, chord: CHORDS["agent.new"], run: () => props.onNew?.() },
    { label: copy.newWorkstreamTitle, chord: CHORDS["workstream.new"], run: () => props.onWorkstream?.() },
  ] : undefined} available={props.available} />
);
