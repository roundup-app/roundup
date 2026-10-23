import { createEffect, createSignal, For, on, Show } from "solid-js";
import type { JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { KindGlyph } from "../ink/KindGlyph";
import { Menu } from "../ui/Menu";
import { Popover } from "../ui/Popover";
import { Tip } from "../ui/Tip";
import { NOTE_MAX } from "./excerpt";
import type { createSendSelection } from "./sendSelection";

/**
 * U515: the control by the selection. One running Agent receives at once; several open a menu; none disable it.
 * It takes the keyboard only when the user activates it (the shortcut or the context-menu item).
 */
export const SendToAgent = (props: { send: ReturnType<typeof createSendSelection>; focusTerminal: () => void }) => {
  const control = props.send;
  const copyNote = copy.copyField(copy.draftField("note").toLowerCase());
  const copyExcerpt = copy.copyField(copy.draftField("excerpt"));
  const [choosing, setChoosingNow] = createSignal(false);

  const [highlighted, setHighlighted] = createSignal<string | null>(null);

  const setChoosing = (open: boolean) => {
    setHighlighted(open ? control.receivers()[0]?.id ?? null : null);
    setChoosingNow(open);
  };

  let input: HTMLInputElement | undefined;
  let panel: HTMLDivElement | undefined;

  createEffect(on(control.focusNote, (count) => {
    // A closing menu hands the keyboard back to where it came from a frame later; the note takes it after that.
    if (count > 0) requestAnimationFrame(() => requestAnimationFrame(() => {
      input?.focus();
      const caret = control.caret();

      if (caret) input?.setSelectionRange(caret.start, caret.end, caret.direction);
    }));
  }, { defer: true }));

  createEffect(() => {
    const caret = control.caret();

    if (caret) input?.setSelectionRange(caret.start, caret.end, caret.direction);
  });

  const anchorRect = () => {
    const at = control.anchor();

    return at === null ? null : { x: at.x, y: at.y, width: 0, height: 0 };
  };

  const close = () => {
    control.dismiss();
    setChoosing(false);
    props.focusTerminal();
  };

  const activate = () => {
    const [only, ...others] = control.receivers();

    if (only === undefined) return;

    if (others.length === 0) void control.send(only).then((consumed) => { if (consumed) props.focusTerminal(); });
    else setChoosing(true);
  };

  const button = (attributes: JSX.HTMLAttributes<HTMLButtonElement>) => (
    <button
      data-button="quiet"
      type="button"
      class="word send-to-agent-action"
      aria-label={copy.sendToAgent}
      aria-disabled={control.receivers().length === 0 ? true : undefined}
      {...attributes}
    >{copy.sendToAgent}</button>
  );

  return (
    <Popover.Root open={control.open()} closeOnEscape onOpenChange={(change) => { if (!change.open && control.open()) close(); }} positioning={{ placement: "bottom-start", strategy: "fixed", getAnchorRect: anchorRect }}>
      <Show when={control.open()}><Portal>
        <Popover.Positioner>
          <Popover.Content ref={panel} class="send-to-agent" aria-label={copy.sendToAgent} onPointerDown={() => control.hold()}>
            <input
              ref={input}
              class="send-to-agent-note"
              type="text"
              maxLength={NOTE_MAX}
              placeholder={copy.addANoteOptional}
              aria-label={copy.addANoteOptional}
              value={control.note()}
              onInput={(typed) => control.setNote(typed.currentTarget.value)}
              onSelect={(event) => {
                const editor = event.currentTarget;
                control.selection(editor.selectionStart ?? 0, editor.selectionEnd ?? 0, editor.selectionDirection ?? "none");
              }}
              onKeyDown={(press) => {
                if (press.key !== "Enter" || press.shiftKey || press.isComposing) return;

                press.preventDefault();
                activate();
              }}
            />
            <Show when={control.receivers().length > 1} fallback={
              <Tip text={copy.noRunningAgent} disabled={control.receivers().length > 0}>
                {(trigger) => button(trigger({ onClick: activate }))}
              </Tip>
            }>
              <Menu.Root positioning={{ placement: "right-start", getAnchorRect: () => panel?.getBoundingClientRect() ?? null }} open={choosing()} highlightedValue={highlighted()} onHighlightChange={(change) => setHighlighted(change.highlightedValue)} onOpenChange={(change) => setChoosing(change.open)} onSelect={(chosen) => {
                const to = control.receivers().find((receiver) => receiver.id === chosen.value);

                setChoosing(false);

                if (to) void control.send(to).then((consumed) => { if (consumed) props.focusTerminal(); });
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
            <ReservedLine message={control.error() ?? control.problem()}>
              <Show when={control.problem()}>
              <div class="send-to-agent-recovery">
              <button data-button="quiet" type="button" onClick={() => void control.copy("note")}>{copyNote}</button>
              <button data-button="quiet" type="button" onClick={() => void control.copy("excerpt")}>{copyExcerpt}</button>
              <button data-button="quiet" type="button" onClick={() => control.retry()}>{copy.storageRetry}</button>
              </div>
              </Show>
            </ReservedLine>
            <Show when={control.hasDraft()}><button data-button="quiet" type="button" onClick={() => control.discard()}>{copy.discardNote}</button></Show>
          </Popover.Content>
        </Popover.Positioner>
      </Portal></Show>
    </Popover.Root>
  );
};
