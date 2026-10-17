import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { KindGlyph } from "../ink/KindGlyph";
import { Menu } from "../ui/Menu";
import { Popover } from "../ui/Popover";
import { NOTE_MAX } from "./excerpt";
import type { createSendSelection } from "./sendSelection";

/**
 * U515: the control by the selection. One running Agent receives at once; several open a menu; none disable it.
 * It takes the keyboard only when the user activates it (the shortcut or the context-menu item).
 */
export const SendToAgent = (props: { send: ReturnType<typeof createSendSelection>; sendSelection?: undefined }) => {
  const control = props.send;
  const [choosing, setChoosing] = createSignal(false);
  let input: HTMLInputElement | undefined;

  createEffect(on(control.focusNote, (count) => {
    // A closing menu hands the keyboard back to where it came from a frame later; the note takes it after that.
    if (count > 0) requestAnimationFrame(() => requestAnimationFrame(() => input?.focus()));
  }, { defer: true }));

  const anchorRect = () => {
    const at = control.anchor();

    return at === null ? null : { x: at.x, y: at.y, width: 0, height: 0 };
  };

  const activate = () => {
    const [only, ...others] = control.receivers();

    if (only === undefined) return;

    if (others.length === 0) void control.send(only);
    else setChoosing(true);
  };

  const button = (attributes: JSX.HTMLAttributes<HTMLButtonElement>) => (
    <button
      data-button="quiet"
      type="button"
      class="word send-to-agent-action"
      aria-label={copy.sendToAgent}
      aria-disabled={control.receivers().length === 0 ? true : undefined}
      title={control.receivers().length === 0 ? copy.noRunningAgent : undefined}
      {...attributes}
    >{copy.sendToAgent}</button>
  );

  return (
    <Popover.Root open={control.open()} positioning={{ placement: "bottom-start", strategy: "fixed", getAnchorRect: anchorRect }}>
      <Show when={control.open()}><Portal>
        <Popover.Positioner>
          <Popover.Content class="send-to-agent" aria-label={copy.sendToAgent}>
            <input
              ref={input}
              class="send-to-agent-note"
              type="text"
              maxLength={NOTE_MAX}
              placeholder={copy.addANoteOptional}
              aria-label={copy.addANoteOptional}
              value={control.note()}
              onInput={(typed) => control.setNote(typed.currentTarget.value)}
              onKeyDown={(press) => {
                if (press.key !== "Enter" || press.shiftKey || press.isComposing) return;

                press.preventDefault();
                activate();
              }}
            />
            <Show when={control.receivers().length > 1} fallback={button({ onClick: activate })}>
              <Menu.Root open={choosing()} onOpenChange={(change) => setChoosing(change.open)} onSelect={(chosen) => {
                const to = control.receivers().find((receiver) => receiver.id === chosen.value);

                setChoosing(false);

                if (to) void control.send(to);
              }}>
                <Menu.Trigger asChild={(trigger) => button(trigger())} />
                <Show when={choosing()}><Portal>
                  <Menu.Positioner>
                    <Menu.Content aria-label={copy.sendToAgent}>
                      <For each={control.receivers()}>
                        {(receiver) => <Menu.Item value={receiver.id}><KindGlyph kind={receiver.kind} decorative />{receiver.name}</Menu.Item>}
                      </For>
                    </Menu.Content>
                  </Menu.Positioner>
                </Portal></Show>
              </Menu.Root>
            </Show>
            <Show when={control.error()}>{(message) => <ErrorLine message={message()} />}</Show>
          </Popover.Content>
        </Popover.Positioner>
      </Portal></Show>
    </Popover.Root>
  );
};
