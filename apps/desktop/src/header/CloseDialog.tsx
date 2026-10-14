import { Show } from "solid-js";
import { AlertDialog } from "../ui";
import type { StripTab } from "./tab";

/** `<k> Agents run: <name>, <name>, <name>.` with at most three names, then `and <j> more` (U184). */
const runningText = (names: readonly string[]): string => {
  const shown = names.slice(0, 3).join(", ");
  const more = names.length > 3 ? ` and ${names.length - 3} more` : "";

  return `${names.length} ${names.length === 1 ? "Agent runs" : "Agents run"}: ${shown}${more}.`;
};

/** The one question before a tab with running Agents closes (U184): focus starts on `Cancel`, and `esc` or a click outside cancels. */
export const CloseDialog = (props: { tab: StripTab | undefined; opener: HTMLElement | undefined; onCancel: () => void; onStop: () => void }) => {
  let cancel: HTMLButtonElement | undefined;

  return (
    <AlertDialog.Root open={!!props.tab} initialFocusEl={() => cancel ?? null} finalFocusEl={() => props.opener?.isConnected ? props.opener : null}
      onOpenChange={(details) => { if (!details.open) props.onCancel(); }}>
      <AlertDialog.Positioner>
        <AlertDialog.Content class="close-dialog" onKeyDown={(press) => press.stopPropagation()}>
          <Show when={props.tab}>{(tab) => <>
            <AlertDialog.Title>{`Close ${tab().name}?`}</AlertDialog.Title>
            <AlertDialog.Description>
              {runningText(tab().running)}
              <br />
              Closing stops them.
            </AlertDialog.Description>
            <p class="close-words">
              <button data-button="quiet" type="button" class="word" ref={(element) => (cancel = element)} onClick={() => props.onCancel()}>
                Cancel
              </button>
              <button data-button="quiet" type="button" class="word" onClick={() => props.onStop()}>
                Stop and close
              </button>
            </p>
          </>}</Show>
        </AlertDialog.Content>
      </AlertDialog.Positioner>
    </AlertDialog.Root>
  );
};
