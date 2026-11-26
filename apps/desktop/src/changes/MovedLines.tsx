import { copy } from "./copy";
import type { Moved } from "./moves";

/** U7696a: the mark under the last line of a move's first range: where the code stood, or the old and the new name. Read-only; a line of it takes a note as any line does (U7676). */
export const MovedLines = (props: { moved: Moved }) => <p class="moved-mark" data-surface="diff">{props.moved.kind === "moved" ? copy.movedFrom(copy.repeatPlace(props.moved.from.path, props.moved.from.start, props.moved.from.end)) : copy.renamedTo(props.moved.was, props.moved.now)}</p>;
