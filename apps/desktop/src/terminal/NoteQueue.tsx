import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { RailNode } from "@contracts/agent/RailNode";
import type { Message } from "@contracts/message/Message";
import { copy } from "../copy";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { IconButton } from "../ui/IconButton";
import { Toggle } from "../ui/Toggle";
import "./noteQueue.css";

/** The first line of a note, with `…` when more follows. */
const firstLine = (body: string): string => {
  const [first = "", ...more] = body.split("\n");

  return more.length > 0 ? `${first}${copy.ellipsis}` : first;
};

/**
 * U3780 to U3784: the Daemon's waiting Messages under an Agent's Terminal; `Pause` is its Takeover (B6).
 */
export const NoteQueue = (props: { node: RailNode; focusTerminal: () => void }) => {
  const { notes, takeover, rail, daemonExit } = useConnectedProject();
  const agent = () => props.node.id;
  const rows = createMemo(() => notes.rows(agent()));
  const ids = createMemo(() => rows().map((row) => row.message.id));
  const live = () => props.node.status?.kind !== "done" && props.node.status?.kind !== "error";
  const paused = () => takeover.taken() === agent();
  let root: HTMLElement | undefined;
  let stepLine: HTMLElement | undefined;
  const [takeFailure, setTakeFailure] = createSignal<{ agent: string; cause: string } | null>(null);
  let afterRemoval: { agent: string; removed: number; next: number | null } | null = null;

  createEffect(() => notes.load(agent()));
  createEffect(() => onCleanup(notes.watch(agent())));

  const senderOf = (message: Message): string | null => {
    if (message.from.kind === "user") return null;

    return rail.nodes.find((node) => node.id === message.from.id)?.name ?? copy.decisionMaker;
  };

  const step = (): string | null => props.node.status?.kind === "working" && props.node.status.label !== "" ? props.node.status.label : null;

  // The queue sits below the Terminal, so a removal drops the header and the rows above it by the height that leaves. They glide down by
  // that height first, so the drop at removal lands where they already are; the leaving rows glide to the step line's final place.
  createEffect(() => {
    rows();
    queueMicrotask(() => {
      const items = [...(root?.querySelectorAll<HTMLElement>("[data-note]") ?? [])];
      const gap = Number.parseFloat(getComputedStyle(items[0]?.parentElement ?? document.body).rowGap) || 0;
      const taken = items.filter((element) => element.dataset["state"] === "taken");
      const total = taken.reduce((sum, element) => sum + element.offsetHeight + gap, 0) - (taken.length === items.length ? gap : 0);
      const target = (stepLine?.getBoundingClientRect().top ?? 0) + total;
      let below = 0;
      let anyBelow = false;

      const close = (element: HTMLElement, by: number, shifts: boolean): void => {
        if (shifts) {
          element.dataset["closing"] = "";
          element.style.setProperty("--close-up", `${by}px`);
        } else {
          delete element.dataset["closing"];
          element.style.removeProperty("--close-up");
        }
      };

      for (const element of items.reverse()) {
        if (element.dataset["state"] === "taken") {
          element.style.setProperty("--glide-y", `${target - element.getBoundingClientRect().top}px`);
          below += element.offsetHeight + gap;
          anyBelow = true;
        } else close(element, below, anyBelow);
      }

      const head = root?.querySelector<HTMLElement>(".note-queue-head");

      if (head) close(head, total, taken.length > 0);
    });
  });

  // A removed row hands focus to the next row's ×, or to the Terminal when none is left.
  createEffect(() => {
    const present = ids();
    const pending = afterRemoval;

    if (pending === null || pending.agent !== agent() || present.includes(pending.removed)) return;

    afterRemoval = null;

    if (pending.next === null) props.focusTerminal();
    else root?.querySelector<HTMLElement>(`[data-note="${pending.next}"] [data-remove]`)?.focus();
  });

  const pause = async (): Promise<void> => {
    const id = agent();

    setTakeFailure(null);

    const failure = await (paused() ? takeover.end(id) : takeover.begin(id));

    setTakeFailure(failure === null ? null : { agent: id, cause: failure });
  };

  const remove = (message: Message): void => {
    const at = ids().indexOf(message.id);

    afterRemoval = { agent: agent(), removed: message.id, next: ids()[at + 1] ?? null };
    void notes.remove(message);
  };

  const failure = () => notes.failure(agent()) ?? (takeFailure()?.agent === agent() ? takeFailure()!.cause : null);

  // P3557c: dismissing clears the shown line only; Messages, the Agent's draft and recipients stay as they are.
  const dismiss = (): void => {
    const shown = notes.selected(agent());

    if (shown !== null) notes.dismiss(shown.key);
    else setTakeFailure(null);
  };

  return (
    <Show when={rows().length > 0 || paused() || failure()}>
      <section ref={(element) => { root = element; }} class="note-queue" aria-label={copy.noteTo(props.node.name)}>
        <Show when={rows().length > 0 || paused()}>
          <header class="note-queue-head">
            <Show when={rows().length > 1}><span class="note-queue-count" data-state="">{copy.notesWaiting(rows().length)}</span></Show>
            <span class="note-queue-step" ref={(element) => { stepLine = element; }}>{step() === null ? "" : copy.nowStep(step()!)}</span>
            <Show when={live()}>
              <Toggle class="note-queue-pause" pressed={paused()} onPressedChange={() => void pause()}>{paused() ? copy.resume : copy.pauseAgent}</Toggle>
            </Show>
          </header>
        </Show>
        <ul class="note-queue-rows">
          <For each={ids()}>{(id) => {
            const row = createMemo(() => rows().find((each) => each.message.id === id));
            let element: HTMLLIElement | undefined;

            return (
              <Show when={row()}>{(each) => (
                <li
                  ref={(item) => { element = item; }}
                  class="note-queue-row"
                  data-note={id}
                  data-state={each().leaving ? "taken" : "waiting"}
                  aria-description={each().message.body}
                  onTransitionEnd={(event) => { if (event.target === element && each().leaving) notes.settle(id); }}
                >
                  <Show when={senderOf(each().message)}>{(name) => <span class="note-queue-from">{name()}</span>}</Show>
                  <span class="note-queue-text">{firstLine(each().message.body)}</span>
                  <Show when={each().message.status === "held" && each().message.from.kind !== "user"}>
                    <button data-button="quiet" type="button" class="word" disabled={daemonExit() !== null} onClick={() => void notes.allow(each().message)}>{copy.allow}</button>
                  </Show>
                  <IconButton data-remove aria-label={copy.removeQueuedNote(firstLine(each().message.body))} disabled={each().leaving || daemonExit() !== null} onClick={() => remove(each().message)}>{copy.removeGlyph}</IconButton>
                </li>
              )}</Show>
            );
          }}</For>
        </ul>
        <ReservedLine message={failure()} status={paused() ? copy.paused : null}>
          <Show when={failure()}><button data-button="quiet" type="button" class="word" onClick={dismiss}>{copy.dismissFailure}</button></Show>
        </ReservedLine>
      </section>
    </Show>
  );
};
