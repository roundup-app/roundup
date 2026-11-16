import { Show } from "solid-js";
import { queueFocus } from "../keys/focus";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import type { ToastQueue } from "../toasts/queue";
import { Checkbox } from "../ui/Checkbox";
import { CopyButton } from "../ui/CopyButton";
import { Dialog } from "../ui/Dialog";
import { Field } from "../ui/Field";
import { Tip } from "../ui/Tip";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { createFeedbackSession } from "./session";
import "./styles.css";

/** The Send feedback… dialog (U7210b); `session.ts` holds what it asks and sends. */
export const Feedback = (props: { notify: ToastQueue["notify"] }) => {
  const { app } = useConnectedProject();
  const session = createFeedbackSession(props);
  let form: HTMLFormElement | undefined;

  return (
    <Dialog.Root
      open={session.isOpen()}
      initialFocusEl={() => form?.querySelector("textarea") ?? null}
      onOpenChange={({ open }) => {
        if (!open) session.close();
      }}
    >
        <Dialog.Content class="app-dialog-form feedback-form">
          <form
            ref={(element) => {
              form = element;
              queueFocus(() => {
                if (element.isConnected)
                  element
                    .querySelector("textarea")
                    ?.focus({ preventScroll: true });
              });
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void session.send();
            }}
          >
            <Dialog.Title>{copy.title}</Dialog.Title>
            <Field.Root>
              <Field.Label>{copy.line}</Field.Label>
              <Field.Textarea
                rows={4}
                value={session.text()}
                onInput={(event) => session.setText(event.currentTarget.value)}
              />
            </Field.Root>
            <Show when={session.attached()}>
              <Checkbox
                checked={session.attach()}
                onCheckedChange={session.setAttach}
              >
                {copy.attach}
              </Checkbox>
            </Show>
            <p class="feedback-versions">{session.versions()}</p>
            <ReservedLine
              message={session.failure()}
              dismiss={() => session.setFailure(null)}
              status={session.blocked() ?? session.noShotLine()}
            />
            <div class="app-dialog-actions">
              <Dialog.CloseTrigger type="button" data-button="quiet">
                {copy.close}
              </Dialog.CloseTrigger>
              <Show
                when={session.blocked() === null}
                fallback={
                  <Show
                    when={
                      session.check() !== null ||
                      session.checkFailure() !== null
                    }
                  >
                    <CopyButton
                      data-button="primary"
                      app={app}
                      text={`${session.text().trimEnd()}\n\n${session.versions()}\n`}
                      onFailure={(error) => session.setFailure(error.message)}
                    >
                      {copy.copy}
                    </CopyButton>
                  </Show>
                }
              >
                <Tip
                  text={copy.needsText}
                  disabled={session.text().trim() !== ""}
                >
                  {(trigger) => (
                    <BusyButton
                      {...trigger()}
                      kind="primary"
                      type="submit"
                      busy={session.sending()}
                      disabled={!session.canSend()}
                      busyLabel={copy.sending}
                    >
                      {session.check() === null ? copy.checking : copy.send}
                    </BusyButton>
                  )}
                </Tip>
              </Show>
            </div>
          </form>
        </Dialog.Content>
    </Dialog.Root>
  );
};
