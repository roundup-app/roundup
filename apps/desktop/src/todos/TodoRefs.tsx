import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Ref } from "@contracts/todo/Ref";
import { copy } from "../copy";
import { ErrorLine } from "../ink/ErrorLine";
import { activationSource } from "../keys/registry";
import { PadDrawer } from "../pads/PadDrawer";
import { usePadList } from "../rail/pads/padList";
import { useConnectedProject } from "../state/connectedProject";
import { failureOf } from "./failureOf";
import { refTarget } from "./refTarget";

const PadAt = (props: { name: string; heading: string | null }) => {
  const list = usePadList();

  return <PadDrawer name={props.name} heading={props.heading ?? undefined} pads={list.pads} onLateFailure={() => {}} />;
};

/** U3760: the Todo's Pad links in the order added. An `ok` one opens its Pad; a `missing` one is text. An Agent's change shows without reopening. */
export const TodoRefs = (props: { id: number }) => {
  const { app, drawer, events } = useConnectedProject();
  const [refs, setRefs] = createSignal<readonly Ref[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  let latest = 0;
  let alive = true;

  // Only the newest fetch may write, so overlapping answers never put an older list back.
  const refresh = async () => {
    const mine = ++latest;
    const id = props.id;

    const message = await failureOf(async () => {
      const answered = await app.rpc("todo.refs", { id });

      if (alive && mine === latest && id === props.id) setRefs(answered);
    });

    if (alive && mine === latest && id === props.id) setFailure(message);
  };

  createEffect(on(() => props.id, () => { setRefs([]); setFailure(null); void refresh(); }));

  // A Pad that changes or goes away moves a ref between `ok` and `missing`.
  onCleanup(events.subscribe((event) => {
    if (event.name === "pad.changed" || event.name === "pad.deleted") void refresh();
    else if ((event.name === "todo.refAdded" || event.name === "todo.refRemoved") && event.data.id === props.id) void refresh();
  }));
  onCleanup(() => { alive = false; latest++; });

  const remove = async (url: string, button: HTMLElement) => {
    const section = button.closest<HTMLElement>(".todo-refs");
    const rows = [...(section?.querySelectorAll<HTMLElement>(".todo-ref") ?? [])];
    const at = rows.indexOf(button.closest(".todo-ref") as HTMLElement);

    setFailure(await failureOf(async () => { await app.rpc("todo.removeRef", { id: props.id, url }); }));
    await refresh();
    // The row is gone; focus its next (else previous) row so the user keeps their place.
    const left = [...(section?.querySelectorAll<HTMLElement>(".todo-ref") ?? [])];
    const row = left[Math.min(at, left.length - 1)];

    if (document.activeElement === document.body || !document.activeElement?.isConnected) {
      (row?.querySelector<HTMLElement>(".todo-ref-link") ?? row?.querySelector<HTMLElement>("button"))?.focus();
    }
  };

  return <Show when={refs().length > 0 || failure() !== null}>
    <section class="todo-refs" aria-label={copy.padRefsHeading(refs().length)}>
      <h3>{copy.padRefsHeading(refs().length)}</h3>
      <Show when={failure()}>{(message) => <div><ErrorLine message={message()} /><button data-button="quiet" class="word" type="button" onClick={() => void refresh()}>{copy.padRefRetry}</button></div>}</Show>
        <For each={refs()}>{(ref) => {
          const target = refTarget(ref.url);
          const label = <>{target.name}{target.heading !== null && <span class="todo-ref-heading light">{copy.padRefHeading(target.heading)}</span>}</>;

          return <div class="todo-ref" data-state={ref.state}>
            <Show when={ref.state === "ok"} fallback={<span class="todo-ref-text">{label}<span class="todo-ref-state">{copy.padRefMissingState}</span></span>}>
              <button data-button="quiet" type="button" role="link" class="word todo-ref-link" title={target.name} onClick={(event) => drawer.open(() => <PadAt name={target.name} heading={target.heading} />, activationSource(event))}>{label}</button>
            </Show>
            <button data-button="quiet" type="button" class="word light" aria-label={copy.removePadRef(target.name)} onClick={(event) => void remove(ref.url, event.currentTarget)}>{copy.remove}</button>
          </div>;
        }}</For>
    </section>
  </Show>;
};
