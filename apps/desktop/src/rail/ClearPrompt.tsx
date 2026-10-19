import { copy } from "../copy";
import { createEffect, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { clearingOf, railDraftsFor } from "./clear";

/** U350: the Workstream's reason prompt, open once `Clear…` in the `⋯` menu is chosen. */
export const ClearPrompt = (props: { node: RailNode }) => {
  const { app, events, rail, project } = useConnectedProject();
  const clearing = () => clearingOf(app, events, props.node.id);
  const drafts = railDraftsFor(events, project.path);
  const saved = () => drafts.list().filter((draft) => draft.destination.surface === "rail-clear" && draft.destination.object === props.node.id).at(-1);
  let field: HTMLTextAreaElement | undefined;

  const subagents = () => {
    const below = new Set([props.node.id]);

    for (let grown = true; grown; ) {
      grown = false;

      for (const node of rail.nodes) {
        if (node.parent !== null && below.has(node.parent) && !below.has(node.id)) {
          below.add(node.id);
          grown = true;
        }
      }
    }

    return rail.nodes.filter((node) => node.kind === "agent" && below.has(node.id)).length;
  };

  createEffect(() => {
    if (clearing().phase() === "asking") queueMicrotask(() => {
      field?.focus();
      const selection = saved()?.selection;

      if (selection) field?.setSelectionRange(selection.start, selection.end, selection.direction);
    });
  });

  const empty = () => clearing().reason().trim() === "";
  const pending = () => clearing().phase() === "pending";

  return (
    <Show when={clearing().phase() !== "closed"}>
      <form
        class="clear-prompt"
        data-clear-prompt
        onSubmit={(submit) => {
          submit.preventDefault();
          void clearing().submit(false);
        }}
        onKeyDown={(press) => {
          if (press.key === "Escape") {
            press.preventDefault();
            clearing().keep();
          }
        }}
      >
        <label class="clear-title">{copy.whyClear}<textarea
            ref={(element) => (field = element)}
            class="clear-reason"
            rows={1}
            wrap="off"
            value={clearing().reason()}
            disabled={pending()}
            onSelect={(event) => {
              const current = saved();

              if (current?.status === "draft") drafts.edit(current.destination, current.value, { start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd, direction: event.currentTarget.selectionDirection }, "ordinary");
            }}
            onInput={(input) => clearing().setReason(input.currentTarget.value)}
            onKeyDown={(press) => {
              if (press.key === "Enter" && !press.isComposing) {
                press.preventDefault();
                press.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <p class="clear-line light">
          {pending()
            ? copy.theDoorIsWritingTheHandoff
            : copy.theDoorWritesAHandoffKeepsWhatYou(subagents())}
        </p>
        <Show when={clearing().failure()}>
          {(failed) => (
            <p class="ink clear-failure" data-tone="red" role="alert">
              <Icon name="x" />
              {failed().message}
            </p>
          )}
        </Show>
        <p class="clear-words">
          <button type="submit" class="word" data-button="quiet" disabled={empty() || pending()}>{copy.clearWithHandoff}</button>{" "}
          <Show when={clearing().offersWithoutHandoff()}>
            <button type="button" class="word" data-button="quiet" disabled={empty() || pending()} onClick={() => void clearing().submit(true)}>{copy.clearWithoutHandoff}</button>{" "}
          </Show>
          <button type="button" class="word" data-button="quiet" disabled={pending()} onClick={() => clearing().keep()}>{copy.keep}</button>
        </p>
      </form>
    </Show>
  );
};
