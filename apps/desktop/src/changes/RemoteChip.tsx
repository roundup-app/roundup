import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { Show } from "solid-js";
import { copy } from "./copy";
import { causeOf, wordsOf, type RemoteChip as Chip } from "./remote";

// U7693: the header chip, with the one button each state offers.
export const RemoteChip = (props: { chip: Chip; fetch: () => void; retry: () => void }) => (
  <span class="changes-remote" role="status">
    <span class="changes-remote-words">{wordsOf(props.chip)}</span>
    <Show when={props.chip.kind === "moved"}><IconButton aria-label={copy.fetch} onClick={() => props.fetch()}><Icon name="arrow-down" /></IconButton></Show>
    <Show when={props.chip.kind === "fetching"}><IconButton aria-label={copy.fetching} aria-busy="true" disabled><Icon name="arrow-down" /></IconButton></Show>
    <Show when={props.chip.kind === "failed"}><IconButton aria-label={copy.retry} onClick={() => props.retry()}><Icon name="rotate-cw" /></IconButton></Show>
  </span>
);
