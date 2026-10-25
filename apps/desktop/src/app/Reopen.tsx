import { copy } from "./copy";

/** `reopen` after the Daemon's exit text (U37): asks the App for a new Daemon for the same Project; off while one is starting. */
export const Reopen = (props: { onReopen: () => void; busy: boolean }) => (
  <button data-button="quiet" class="word" aria-disabled={props.busy ? true : undefined} onClick={() => { if (!props.busy) props.onReopen(); }}>{copy.reopen}</button>
);
