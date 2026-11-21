import { Show } from "solid-js";
import { copy } from "./copy";
import { causeOf, wordsOf, type RemoteChip as Chip } from "./remote";

// U7693: the header chip, with the one button each state offers.
export const RemoteChip = (props: { chip: Chip; fetch: () => void; retry: () => void }) => (
  <span class="changes-remote" role="status">
    <span class="changes-remote-words">{wordsOf(props.chip)}</span>
    <Show when={props.chip.kind === "moved"}><button type="button" data-button="quiet" onClick={() => props.fetch()}>{copy.fetch}</button></Show>
    <Show when={props.chip.kind === "fetching"}><button type="button" data-button="quiet" disabled aria-busy="true">{copy.fetching}</button></Show>
    <Show when={props.chip.kind === "failed"}><button type="button" data-button="quiet" onClick={() => props.retry()}>{copy.retry}</button></Show>
  </span>
);
