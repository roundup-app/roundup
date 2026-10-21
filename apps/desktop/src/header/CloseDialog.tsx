import { copy } from "../copy";
import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { registerKeys } from "../keys/registry";
import { AlertDialog } from "../ui/Dialog";
import type { StripTab } from "./tab";

/** `<k> Agents run: <name>, <name>, <name>.` with at most three names, then `and <j> more` (U184). */
const runningText = (names: readonly string[]): string => {
  const shown = names.slice(0, 3).join(copy.comma);
  const more = names.length > 3 ? copy.andMore(names.length - 3) : "";

  return copy.runningAgents(names.length, names.length === 1 ? copy.agentRuns : copy.agentsRun, shown, more);
};

/** The one question before a tab with running Agents closes (U184): focus starts on `Cancel`, and `esc` or a click outside cancels. */
export const CloseDialog = (props: { tab: StripTab | undefined; opener: HTMLElement | undefined; onCancel: () => void; onStop: () => void }) => {
  let cancel: HTMLButtonElement | undefined;
  let panel: HTMLElement | undefined;
  registerKeys({ kind: "layer", element: () => panel, active: () => !!props.tab, modal: true }, []);

  return (
    <AlertDialog.Root open={!!props.tab} initialFocusEl={() => cancel ?? null} finalFocusEl={() => props.opener?.isConnected ? props.opener : null}
      onOpenChange={(details) => { if (!details.open) props.onCancel(); }}>
      <Portal><AlertDialog.Positioner>
        <AlertDialog.Content class="close-dialog" ref={(element) => (panel = element)}>
          <Show when={props.tab}>{(tab) => <>
            <AlertDialog.Title>{copy.closeQuestion(tab().name)}</AlertDialog.Title>
            <AlertDialog.Description>
              {runningText(tab().running)}
              <br />
              {copy.closingStopsThem}
            </AlertDialog.Description>
            <p class="close-words">
              <button data-button="quiet" type="button" class="word" ref={(element) => (cancel = element)} onClick={() => props.onCancel()}>
                {copy.cancel}
              </button>
              <button data-button="quiet" type="button" class="word" onClick={() => props.onStop()}>
                {copy.stopAndClose}
              </button>
            </p>
          </>}</Show>
        </AlertDialog.Content>
      </AlertDialog.Positioner></Portal>
    </AlertDialog.Root>
  );
};
