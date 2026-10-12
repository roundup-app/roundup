import { createEffect, Show } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import { Icon } from "../ink/Icon";
import { useConnectedProject } from "../state/connectedProject";
import { clearingOf } from "./clear";

/** U350: the Workstream's reason prompt, open once `Clear…` in the `⋯` menu is chosen. */
export const ClearPrompt = (props: { node: RailNode }) => {
  const { app, events, rail } = useConnectedProject();
  const clearing = () => clearingOf(app, events, props.node.id);
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
    if (clearing().phase() === "asking") queueMicrotask(() => field?.focus());
  });

  const empty = () => clearing().reason().trim() === "";
  const pending = () => clearing().phase() === "pending";

  return (
    <Show when={clearing().phase() !== "closed"}>
      <form
        class="thread-clear-prompt"
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
        <label class="thread-clear-title">
          why clear {props.node.name}?
          <textarea
            ref={(element) => (field = element)}
            class="thread-clear-reason"
            rows={1}
            wrap="off"
            value={clearing().reason()}
            disabled={pending()}
            onInput={(input) => clearing().setReason(input.currentTarget.value.replace(/\s*\n\s*/g, " "))}
            onKeyDown={(press) => {
              if (press.key === "Enter" && !press.isComposing) {
                press.preventDefault();
                press.currentTarget.form?.requestSubmit();
              }
            }}
          />
        </label>
        <p class="thread-clear-line light">
          {pending()
            ? "the Door is writing the handoff"
            : `the Door writes a handoff, keeps what you asked for, archives the rest, and stops ${subagents()} Subagents; their files stay`}
        </p>
        <Show when={clearing().failure()}>
          {(failed) => (
            <p class="ink thread-clear-failure" data-tone="red" role="alert">
              <Icon name="x" />
              {failed().message}
            </p>
          )}
        </Show>
        <p class="thread-clear-words">
          <button type="submit" class="word" data-button="quiet" disabled={empty() || pending()}>
            clear
          </button>{" "}
          <button type="button" class="word" data-button="quiet" disabled={pending()} onClick={() => clearing().keep()}>
            keep
          </button>
          <Show when={clearing().offersWithoutHandoff()}>
            {" "}
            <button type="button" class="word" data-button="quiet" disabled={empty() || pending()} onClick={() => void clearing().submit(true)}>
              clear without handoff
            </button>
          </Show>
        </p>
      </form>
    </Show>
  );
};
