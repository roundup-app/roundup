import { For, Show } from "solid-js";
import type { Spot } from "@contracts/agent/Spot";
import { copy } from "./copy";
import { sourceLabel } from "./spots";

/** U7704a: the mark under the last line of a tool's spot: the tool's name and what it said, and Outdated once the file changed since. */
export const SpotLine = (props: { spot: Spot }) => <div class="spot-mark" data-surface="diff" data-stale={props.spot.stale ? "true" : undefined} role="note">
  <p><strong>{sourceLabel(props.spot)}</strong> {props.spot.message}</p>
  <Show when={props.spot.stale}><p>{copy.outdated}</p></Show>
</div>;

/** U7704e: spots no line of the diff shows, each with its source, its lines and what it said; the group ends the file, and the Overview holds those of files the listing lacks. */
export const SpotList = (props: { spots: readonly Spot[] }) => <Show when={props.spots.length > 0}>
  <ul class="note-group" aria-label={copy.otherSpots}>
    <For each={props.spots}>{spot => <li>
      <strong>{sourceLabel(spot)}</strong> {copy.repeatPlace(spot.path, spot.start, spot.end)} {spot.message ?? (spot.other && copy.repeatPlace(spot.other.path, spot.other.start, spot.other.end))}
      <Show when={spot.stale}> {copy.outdated}</Show>
    </li>}</For>
  </ul>
</Show>;
