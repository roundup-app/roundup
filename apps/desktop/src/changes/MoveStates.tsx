import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { Show } from "solid-js";
import { copy } from "./copy";
import type { Moves } from "./moveStore";

/** U7696c: what the move check says while it runs or fails; a finished check with none says nothing. */
export const MoveStates = (props: { moves: Moves }) => <Show when={props.moves.scanning() || props.moves.failed() !== null}>
  <section class="flow-states" aria-label={copy.movedCode}>
    <Show when={props.moves.scanning()}><p>{copy.checkingMoves}</p></Show>
    <Show when={props.moves.failed()}>{cause => <p>{copy.movesFailed} <IconButton aria-label={copy.retry} onClick={() => props.moves.again()}><Icon name="rotate-cw" /></IconButton> <span class="flow-cause">{cause()}</span></p>}</Show>
  </section>
</Show>;
