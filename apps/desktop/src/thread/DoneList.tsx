import { createSignal, For, Show } from "solid-js";
import { Icon } from "../ink/Icon";

export type Done = { name: string; last: string; pads: readonly string[] };

/** U424: `✓ n done ›` opens to each finished Agent's name, the first line of its newest Digest's `last`, and its Pads. */
export const DoneList = (props: { done: readonly Done[] }) => {
  const [open, setOpen] = createSignal(false);

  return (
    <Show when={props.done.length > 0}>
      <div class="thread-done" data-done>
        <button data-button="quiet" type="button" class="word thread-done-head" aria-expanded={open()} onClick={() => setOpen((now) => !now)}>
          <Icon name="check" />
          {props.done.length} done
          <Icon name="right" />
        </button>
        <Show when={open()}>
          <ul class="thread-done-list">
            <For each={props.done}>
              {(each) => (
                <li class="thread-done-item" data-done-item={each.name}>
                  <span class="thread-done-name">{each.name}</span>
                  <Show when={each.last !== ""}>
                    <span class="thread-done-last" title={each.last}>{each.last}</span>
                  </Show>
                  <Show when={each.pads.length > 0}>
                    <span class="thread-done-pads">{each.pads.join(", ")}</span>
                  </Show>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </Show>
  );
};
