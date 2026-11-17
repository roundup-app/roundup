import { captureFocus } from "../keys/focus";
import { createMessageToast } from "../toasts/messageToast";
import { lazy, createEffect, createMemo, createSignal, For, onCleanup, Show, untrack } from "solid-js";
import type { Ref } from "@contracts/todo/Ref";
import { copy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { Icon } from "../ink/Icon";
import { contextMenu, linkEntries } from "../ui/contextMenu";
import { createRowMenu } from "../ui/rowMenu";
import { activationSource, type ActivationSource } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { createCutTitle } from "../ui/cutTitle";
import { changeFailureOf, doesClearTodoFailure, failureOf } from "../app/failureOf";
import { refTarget } from "./refTarget";

const PadHost = lazy(() => import("../pads/PadDrawer").then(module => ({ default: module.PadHost })));

/** U3760: the Todo's Pad links in the order added. An `ok` one opens its Pad; a `missing` one is text. An Agent's change shows without reopening. */
export const TodoRefs = (props: { id: number; saved?: () => number; onSaved?: () => void }) => {
  const { app, drawer, events, project, rail } = useConnectedProject();
  const [refs, setRefs] = createSignal<readonly Ref[]>([]);
  const [failure, setFailure] = createSignal<string | null>(null);
  const [actionFailure, setActionFailure] = createSignal<string | null>(null);
  createEffect(() => props.saved?.() ?? 0, () => { setActionFailure(null); }, { defer: true });
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

  createEffect(createMemo(() => props.id), () => { setRefs([]); setFailure(null); setActionFailure(null); void untrack(refresh); });

  // A Pad that changes or goes away moves a ref between `ok` and `missing`.
  onCleanup(events.subscribe((event) => {
    if (doesClearTodoFailure(event, props.id)) setActionFailure(null);

    if (event.name === "pad.changed" || event.name === "pad.deleted") void refresh();
    else if ((event.name === "todo.refAdded" || event.name === "todo.refRemoved") && event.data.id === props.id) void refresh();
  }));
  onCleanup(() => { alive = false; latest++; });

  const remove = async (url: string, button: HTMLElement) => {
    const focus = captureFocus();
    const section = button.closest<HTMLElement>(".todo-refs");
    // With no row left, the section unmounts: focus goes to the first control after it.
    const parent = section?.parentElement;
    const index = section ? [...(parent?.children ?? [])].indexOf(section) : -1;
    const rows = [...(section?.querySelectorAll<HTMLElement>(".todo-ref") ?? [])];
    // SAFETY: the button sits inside its .todo-ref row.
    const at = rows.indexOf(button.closest(".todo-ref") as HTMLElement);

    const id = props.id;
    const message = await changeFailureOf(async () => { await app.rpc("todo.removeRef", { id, url }); });

    if (!alive || id !== props.id) return;
    setActionFailure(message);

    if (message !== null) return;
    props.onSaved?.();
    await refresh();
    // The row is gone; focus its next (else previous) row so the user keeps their place.
    const left = [...(section?.isConnected ? section.querySelectorAll<HTMLElement>(".todo-ref") : [])];
    const row = left[Math.min(at, left.length - 1)];

    focus(() => {
      if (document.activeElement === document.body || !document.activeElement?.isConnected) {
        if (row) (row.querySelector<HTMLElement>(".todo-ref-link") ?? row.querySelector<HTMLElement>("button"))?.focus();
        else {
          // The section unmounted: the first control among what now sits where it was.
          const following = [...(parent?.children ?? [])].slice(index).filter((next) => next instanceof HTMLElement);
          const control = following.flatMap((next) => [next, ...next.querySelectorAll<HTMLElement>("button,a[href]")]).find((found) => found.matches("button,a[href]"));
          control?.focus();
        }
      }
    });
  };

  const openPad = (target: ReturnType<typeof refTarget>, source: ActivationSource) => drawer.open(() => <PadHost name={target.name} heading={target.heading ?? undefined} />, source, { kind: "pad", project: project.path });

  // U7310e: a Pad ref's row opens Open, the Pad's link entries and Unlink in the native menu; a missing Pad's only Unlink.
  let section: HTMLElement | undefined;

  const refMenu = createRowMenu(() => section, "[data-ref]", (row, x, y) => {
    const ref = refs().find(item => item.url === row.dataset.ref);

    if (!ref) return;
    const target = refTarget(ref.url);

    void contextMenu(app, [
      ...(ref.state === "ok" ? [{ id: "open", label: copy.openDraft, run: () => openPad(target, "pointer") },
        ...linkEntries(app, { kind: "pad", id: target.name }, rail.nodes, node => rail.exitOf(node) === null, setActionFailure, () => setActionFailure(null))] : []),
      { id: "remove", label: copy.removePadRef(target.name), run: () => remove(ref.url, row) },
    ], x, y);
  });

  // U7310d: a failed read or unlink shows as a toast.
  createMessageToast({ get message() { return actionFailure() ?? failure(); }, recover: { run: () => refresh(), label: copy.padRefRetry }, dismiss: () => { setActionFailure(null); setFailure(null); } });

  return <Show when={refs().length > 0}>
    <section class="todo-refs" aria-label={copy.padRefsHeading(refs().length)} ref={section} onContextMenu={refMenu}>
      <h3>{copy.padRefsHeading(refs().length)}</h3>

        <For each={refs()}>{(ref) => {
          const target = refTarget(ref.url);
          const linkCut = createCutTitle(() => target.name);
          const label = <>{target.name}{target.heading !== null && <span class="todo-ref-heading light">{copy.padRefHeading(target.heading)}</span>}</>;

          return <div class="todo-ref" data-state={ref.state} data-ref={ref.url}>
            <Show when={ref.state === "ok"} fallback={<span class="todo-ref-text">{label}<span class="todo-ref-state">{copy.padRefMissingState}</span></span>}>
              <button {...linkCut.attrs()} data-button="quiet" data-reads="text" type="button" role="link" class="word todo-ref-link" onClick={(event) => openPad(target, activationSource(event))}>{label}</button>
            </Show>
            <BusyButton kind="icon" class="word todo-ref-remove" busyLabel={copy.removing} aria-label={copy.removePadRef(target.name)} onClick={event => remove(ref.url, event.currentTarget)}><Icon name="unlink" /></BusyButton>
          </div>;
        }}</For>
    </section>
  </Show>;
};
