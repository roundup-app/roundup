import { copy } from "../../copy";
import { For, Show } from "solid-js";
import type { RailMenuModel } from "./model";
import { goesLine, goingNames, staysLine } from "./removal";
import { AlertDialog } from "../../ui/Dialog";

/** U56, U367: the question before a stop or a remove, an in-app `alertdialog` since the system menu cannot hold it. Focus starts on `keep`; Esc or a click outside is `keep`. */
export const RailConfirm = (props: { menu: RailMenuModel }) => {
  let keep: HTMLButtonElement | undefined;

  return (
    <AlertDialog.Root open={props.menu.state()?.confirming === true} initialFocusEl={() => keep ?? null}
      onOpenChange={(details) => { if (!details.open) props.menu.close(); }}>
      <AlertDialog.Positioner>
        <AlertDialog.Content class="close-dialog">
          <Show when={props.menu.state()}>
            {(current) => (
              <>
                <AlertDialog.Title>
                  {current().action === "stop"
                    ? copy.stopQuestion(current().node.name)
                    : current().node.kind === "workstream" ? copy.removeQuestion(current().node.name) : copy.stopAndRemoveQuestion(current().node.name)}
                </AlertDialog.Title>
                <Show when={current().node.kind === "workstream" && current().action === "remove" ? current().removal : undefined}>
                  {(removal) => (
                    <AlertDialog.Description>
                      <span class="rail-menu-line">{goesLine(removal())}</span>
                      <For each={goingNames(removal())}>{(name) => <span class="rail-menu-line rail-menu-name">{name}</span>}</For>
                      <Show when={staysLine(removal())}>{(line) => <span class="rail-menu-line rail-menu-stay">{line()}</span>}</Show>
                      <For each={removal().stays.agents}>
                        {(stay) => <span class="rail-menu-line rail-menu-name rail-menu-stay">{copy.toastLine(stay.name, stay.reason)}</span>}
                      </For>
                    </AlertDialog.Description>
                  )}
                </Show>
                <p class="close-words">
                  <button data-button="quiet" type="button" class="word" ref={(element) => (keep = element)} onClick={props.menu.close}>{copy.keep}</button>
                  <button data-button="quiet" type="button" class="word"
                    onClick={current().action === "stop" ? props.menu.chooseStop : props.menu.chooseRemove}>
                    {current().action === "stop" ? copy.stop : copy.remove}
                  </button>
                </p>
              </>
            )}
          </Show>
        </AlertDialog.Content>
      </AlertDialog.Positioner>
    </AlertDialog.Root>
  );
};
