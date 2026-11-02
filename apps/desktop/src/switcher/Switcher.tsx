import { useDialog } from "@ark-ui/solid/dialog";
import { captureFocus, queueFocus } from "../keys/focus";
import { writeText } from "../app/clipboard";
import { ReservedLine } from "../ink/ReservedLine";
import { lazy, batch, createEffect, createMemo, createResource, createSignal, For, on, onCleanup, Show } from "solid-js";
import { createCopyFeedback } from "../ui/CopyButton";
import * as v from "valibot";
import type { RpcError } from "../app/seam";
import type { ActionRow } from "@contracts/action/ActionRow";
import { copy } from "./copy";
import { KindGlyph } from "../ink/KindGlyph";
import { StatusTip } from "../ink/StatusTip";
import { FailureLine, shownKind } from "../ink/FailureLine";
import { Combobox } from "../ui/Combobox";
import { trackSurface } from "../ui/openSurfaces";
import { useConnectedProject } from "../state/connectedProject";
import { captureActions, modalOutside, modalOpen, registerKeys } from "../keys/registry";
import { CHORDS, LEADER, SWITCHER_CLOSE, SWITCHER_KEYS, SWITCHER_RECORD, chordNamed, pressOf, recordable } from "../keys/chords";
import { KeyChip } from "../keys/KeyChip";
import { checkRecorded, isModifier, shortcutsWith } from "../settings/shortcutRules";
import { saveAppSettings } from "../settings/preferences";
import { useTodoList } from "../todos/todoList";
import { Icon } from "../ink/Icon";
import { PAD_ICON } from "../shelf/frame";
import { openThroughRow } from "../shelf/openItem";
import { usePadList } from "../rail/pads/padList";
import { KeyHint } from "../keys/KeyHint";
import { REVEAL_BUBBLE } from "../bubbles/places";
import { entriesOf, itemsMatching, matching, userActionsOf, USER_PREFIX } from "./entries";
import type { ToastQueue } from "../toasts/queue";
import type { Entry } from "./entries";
import "./styles.css";

const TodoHost = lazy(() => import("../todos/TodoDrawer").then(module => ({ default: module.TodoHost })));

const PadHost = lazy(() => import("../pads/PadDrawer").then(module => ({ default: module.PadHost })));

/** U529, U530: leader `K` opens a filter field over the centre pane listing every row by name; `⏎` selects the highlighted one as a click does. `onFailure` gets a failed selection's message; `onOpen` runs as it opens, so an overlaid Shelf can close and leave no scrim over it. */
export const Switcher = (props: { onFailure: (message: string | null) => void; onOpen: () => void; notify?: ToastQueue["notify"] | undefined }) => {
  const { app, events, rail, project, drafts, drawer } = useConnectedProject();
  const todos = useTodoList();
  const pads = usePadList();
  const [open, setOpen] = createSignal(false);
  const [dispatching, setDispatching] = createSignal(false);
  trackSurface(open);

  const destination = { surface: "switcher", object: project.path, recipient: null };

  const current = () => drafts.list().filter((draft) => draft.destination.surface === destination.surface
    && draft.destination.object === destination.object && draft.destination.recipient === null).at(-1);

  const retentionProblem = createMemo(() => {
    const problem = drafts.problem();

    return problem && (problem.destination === null || problem.destination.surface === destination.surface) ? problem : null;
  });

  const restored = v.safeParse(v.string(), current()?.value.query);
  const [text, setText] = createSignal(restored.success ? restored.output : "");
  const feedback = createCopyFeedback();
  const copied = feedback.copied;
  createEffect(on(() => [text(), current()?.revision], feedback.reset));
  const [copyFailure, setCopyFailure] = createSignal<{ revision: string | null } | null>(null);
  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let restoring = false;
  let savedSelection = current()?.selection ?? null;
  let input: HTMLInputElement | undefined;
  let panel: HTMLElement | undefined;

  let chosenPane = false;
  let chosenAction = false;
  let actionFocus: HTMLElement | null = null;
  let chosenTerminal: string | null = null;
  let chosenItem = false;

  const dialog = useDialog(() => ({
    open: open(), modal: false, trapFocus: true, preventScroll: false,
    restoreFocus: true, closeOnInteractOutside: true,
    "aria-label": copy.switcherLabel,
    initialFocusEl: () => openingFocus.target(() => input),
    finalFocusEl: () => chosenItem ? null : chosenAction && actionFocus?.isConnected
      ? actionFocus
      : chosenPane
      ? chosenTerminal
        ? document.querySelector<HTMLElement>(`[data-bubble="${chosenTerminal}"] textarea`)
        : document.querySelector<HTMLElement>('.thread[data-mode="thread"] .thread-composer textarea:not(:disabled)')
          ?? document.querySelector<HTMLElement>(".pane-screen textarea, .pane-screen [tabindex]")
      : null,
    // A background layer closing is not a parent dismissal of this independent dialog.
    onRequestDismiss: event => event.preventDefault(),
    onOpenChange: details => { if (!details.open) close(true); },
  }));

  const [opening, setOpening] = createSignal<{ selected: string | null; actions: ReturnType<typeof captureActions> }>({ selected: null, actions: [] });

  const openingSurvives = () => rail.selected() === opening().selected
    && (opening().selected === null || rail.nodes.some((node) => node.id === opening().selected));

  const actions = createMemo(() => openingSurvives() ? opening().actions.filter((action) => action.available()) : []);

  const entries = createMemo(() => entriesOf(rail.nodes, rail.terminals()));

  const items = createMemo(() => itemsMatching(rail.nodes, todos.all(), pads.pads(), text()));

  const byValue = createMemo(() => new Map([...entries(), ...items()].map(entry => [entry.value, entry])));

  // UA9: the Daemon's User actions, read when the Project connects and on each `action.userChanged`, so opening calls nothing; a failed read shows none and says nothing (UA12).
  const [userRows, { refetch: readUserRows }] = createResource(
    () => app.rpc("action.userList", null).catch((): ActionRow[] => []),
    { initialValue: [] },
  );

  // UA13: the resource ignores superseded replies; false also keeps same-turn events from being coalesced.
  onCleanup(events.subscribe(event => { if (event.name === "action.userChanged") void readUserRows(false); }));
  const userActions = createMemo(() => userActionsOf(userRows()));

  const shown = createMemo(() => [
    ...matching(entries(), text()),
    ...items(),
    ...matching([...actions(), ...userActions()], text()),
  ]);

  /** U5240c: the highlighted row when it is a command that can take a new key (U5240d). */
  const highlightedCommand = createMemo(() => {
    const action = actions().find(candidate => candidate.value === highlighted());
    const chord = action && !action.value.startsWith("action:leader") ? CHORDS.find(row => row.name === action.name) : undefined;

    return action && chord && recordable(chord) && shown().some(entry => entry.value === action.value) ? action : undefined;
  });

  const [nameFocused, setNameFocused] = createSignal(false);
  const [recording, setRecording] = createSignal<string | null>(null);
  const [refusal, setRefusal] = createSignal<{ value: string; cause: string } | null>(null);
  const canRecord = () => nameFocused() && recording() === null && highlightedCommand() !== undefined;

  const footer = () => recording() !== null ? [{ keys: SWITCHER_KEYS.close, label: copy.footerCancel }] : [
    { keys: SWITCHER_KEYS.move, label: copy.footerMove }, { keys: SWITCHER_KEYS.choose, label: copy.footerChoose }, { keys: SWITCHER_KEYS.close, label: copy.footerClose },
    ...(canRecord() ? [{ keys: SWITCHER_KEYS.record, label: copy.footerRecord }] : []),
  ];

  /** The key a command shows: its live row, so a key just saved shows at once. */
  const keysOf = (action: { value: string; name: string; keys: string }) => action.value.startsWith("action:leader") ? action.keys : chordNamed(action.name)?.keys ?? action.keys;

  createEffect(() => {
    const list = shown();

    if (!list.some((entry) => entry.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const retain = (): void => {
    if (!open() || restoring) return;

    const previous = current();

    const selection = input ? {
      start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0, direction: input.selectionDirection ?? "none",
    } : previous?.selection ?? null;

    if ((!previous && text() === "") || (previous?.value.query === text() && JSON.stringify(previous.selection) === JSON.stringify(selection))) return;

    if (previous?.value.query === text()) drafts.setSelection(previous.revision, selection);
    else drafts.edit(destination, { query: text() }, selection, "ordinary");
  };

  onCleanup(() => { if (open()) retain(); });

  const restoreQueryFocus = (): void => {
    const selection = input ? [input.selectionStart, input.selectionEnd, input.selectionDirection ?? "none"] as const : null;

    // Let removal of the pressed button finish before returning the native caret.
    queueFocus(() => {
      if (!open() || !input?.isConnected) return;
      input.focus();

      if (selection) input.setSelectionRange(...selection);
    });
  };

  const restoreFocusOnRemoval = (element: HTMLElement): void => {
    onCleanup(() => {
      // Removing a focused recovery action must leave the query ready for typing.
      if (element.contains(document.activeElement)) restoreQueryFocus();
    });
  };

  createEffect(on(retentionProblem, (problem, previous) => {
    if (!problem && previous) restoreQueryFocus();
  }, { defer: true }));

  createEffect(() => {
    const failure = copyFailure();

    if (failure && failure.revision !== (current()?.revision ?? null)) setCopyFailure(null);
  });

  const copyQuery = (): void => {
    const revision = current()?.revision ?? null;

    const query = text();
    void feedback.run(() => writeText(app, query), () => {
      if (revision === (current()?.revision ?? null)) setCopyFailure(null);
    }, () => {
      if (revision === (current()?.revision ?? null)) setCopyFailure({ revision });
    });
  };

  const close = (restore: boolean): void => {
    retain();
    chosenPane = !restore;
    setOpen(false);
  };

  const choose = (entry: Entry): void => batch(() => {
    chosenTerminal = entry.terminal?.id ?? null;
    chosenItem = entry.todo !== undefined || entry.pad !== undefined;
    close(false);
    props.onFailure(null);

    // U5240b: the Switcher has closed; the item opens as a click on its row does.
    if (entry.todo !== undefined) {
      const id = entry.todo.id;

      // The Rail's own row opens it when the Shelf is mounted; otherwise the Drawer opens alone.
      if (!openThroughRow("todo", id)) drawer.open(() => <TodoHost id={id} />, "key", { kind: "todo", project: project.path });

      return;
    }

    if (entry.pad !== undefined) {
      const name = entry.pad.name;

      if (!openThroughRow("pad", name)) drawer.open(() => <PadHost name={name} />, "key", { kind: "pad", project: project.path });

      return;
    }

    if (entry.terminal !== undefined) {
      rail.select(entry.terminal.owner === project.path ? null : entry.terminal.owner);
      window.dispatchEvent(new CustomEvent(REVEAL_BUBBLE, { detail: entry.terminal.id }));

      return;
    }

    const node = entry.node!;

    rail.select(node.id);
  });

  const [making, setMaking] = createSignal(false);
  const [makeFailure, setMakeFailure] = createSignal<string | null>(null);
  // An invalidated captured action must never turn its query into a create request.
  const makeName = () => openingSurvives() && shown().length === 0 && matching(opening().actions, text()).length === 0 ? text().trim() : "";

  createEffect(on(text, () => setMakeFailure(null), { defer: true }));

  /** U5241a: a query nothing matches names a new Workstream; the Switcher closes once the Daemon made it. */
  const make = async (): Promise<void> => {
    const name = makeName();

    if (name === "" || making()) return;
    setMaking(true);
    setMakeFailure(null);

    try {
      const failure = await rail.createNamedWorkstream(name);

      if (failure !== null) setMakeFailure(failure);
      else if (open()) { props.onFailure(null); close(false); }
    } finally { setMaking(false); }
  };

  /** UA10, UA11: runs the User action once by name, with no argument; a refusal raises one Toast carrying its label and cause. */
  const runUserAction = (entry: Entry): void => {
    const name = entry.value.slice(USER_PREFIX.length);

    close(true);
    props.onFailure(null);
    app.rpc("action.run", { name, args: [] }).catch((failure: RpcError) => {
      props.notify?.({ key: `${USER_PREFIX}${name}`, item: `${USER_PREFIX}${name}`, project: project.path, kind: "error", name: entry.label, line: failure.message, selected: false, open: () => null });
    });
  };

  const chooseValue = (value: string | null): void => {
    const user = userActions().find(candidate => candidate.value === value);

    if (user) {
      runUserAction(user);

      return;
    }

    const action = opening().actions.find((candidate) => candidate.value === value);

    if (action) {
      if (!openingSurvives() || !action.available()) return;
      // Release modal ownership before invoking native/modal actions, while their
      // originating surface and captured owner are still mounted.
      chosenAction = true;
      setDispatching(true);

      try { action.run(); }
      finally {
        close(true);
        setDispatching(false);
        const target = actionFocus;

        if (target) queueFocus(() => { if (target.isConnected) target.focus(); });
      }

      return;
    }

    const entry = [...matching(entries(), text()), ...items()].find((candidate) => candidate.value === value);

    if (entry) choose(entry);
  };

  createEffect(() => { if (open() && !dispatching() && modalOutside(panel)) close(false); });

  let openingFocus = captureFocus();

  const show = (query?: string): void => {
    if (modalOpen()) return;
    chosenPane = false;
    chosenAction = false;
    actionFocus = null;
    chosenTerminal = null;
    chosenItem = false;
    openingFocus = captureFocus(true);
    setOpening({ selected: rail.selected(), actions: captureActions(document.activeElement).filter(action => action.searchable) });
    props.onOpen();
    setRecording(null);
    setRefusal(null);
    savedSelection = query === undefined ? current()?.selection ?? null : null;
    restoring = true;

    if (query !== undefined) setText(query);
    setOpen(true);
  };

  registerKeys({ kind: "leader" }, [{ action: LEADER.find(row => row.keys === "K")!, searchable: false, capture: () => ({ available: () => !open() && !modalOpen(), invoke: args => show(args?.query === undefined ? undefined : String(args.query)) }) }]);
  // U5240a: the direct chord opens from anywhere, a focused Terminal included; the open Switcher's layer closes it again.
  registerKeys({ kind: "app" }, [{ action: CHORDS.find(row => row.name === "switcher.open")!, searchable: false, capture: () => ({ available: () => !open() && !modalOpen(), invoke: () => show() }) }]);

  const switcherScope = { kind: "layer", element: () => panel, active: () => open() && !dispatching(), modal: true } as const;

  registerKeys(switcherScope, [
    { chords: SWITCHER_CLOSE, run: () => close(true) },
    { chords: ["[Control]+[Alt]+[Meta]+[Shift]+(.+)"], when: event => pressOf(event) === chordNamed("switcher.open")?.presses[0], run: event => { if (!event.repeat) close(true); } },
    { chords: SWITCHER_RECORD, when: canRecord, run: () => { setRefusal(null); setRecording(highlightedCommand()!.value); } },
  ]);

  // U5240d: recording is a modal layer of its own, so no other chord runs and nothing reaches a Terminal; it ends with the layer.
  registerKeys({ kind: "layer", element: () => panel, active: () => recording() !== null, modal: true, parent: switcherScope }, [
    { chords: ["Escape"], run: () => { setRecording(null); setRefusal(null); } },
    { chords: ["[Control]+[Alt]+[Meta]+[Shift]+(.+)"], when: event => !isModifier(event), run: event => {
      const value = recording();
      const action = actions().find(candidate => candidate.value === value);

      if (!action) return;

      const checked = checkRecorded(action.name, event);

      if ("refusal" in checked) {
        setRefusal({ value: action.value, cause: checked.refusal });

        return;
      }

      void saveAppSettings({ shortcuts: shortcutsWith(action.name, checked.press) }).then(failure => {
        if (failure) setRefusal({ value: action.value, cause: failure });
        else { setRefusal(null); setRecording(null); }
      });
    } },
  ]);

  return (
    <Show when={open()}>
      <section {...dialog().getContentProps()} aria-label={copy.switcherLabel} class="switcher" ref={element => { panel = element; }}>
        <Combobox.Root autoFocus={false} focusScope={() => panel} onDismiss={() => close(false)} initialFocus={openingFocus} inputValue={text()} inputRef={(element) => {
          input = element;
          // Ark also reports programmatic clears on Escape/selection; only native edits replace recovery text.
          element.addEventListener("input", () => { restoring = false; setText(element.value); retain(); });
          element.addEventListener("select", () => {
            // Native select follows Ark's focus selection and controlled-value caret update.
            if (restoring && element.isConnected && document.activeElement === element) {
              restoring = false;

              if (savedSelection) element.setSelectionRange(savedSelection.start, savedSelection.end, savedSelection.direction);
            } else retain();
          });
          element.addEventListener("focus", () => setNameFocused(true));
          element.addEventListener("keydown", event => {
            if (event.key !== "Enter" || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || makeName() === "") return;
            event.preventDefault();
            void make();
          });
          element.addEventListener("keyup", retain);
          element.addEventListener("pointerup", retain);
          element.addEventListener("blur", (event) => {
            setNameFocused(false);

            // Zag can retain its trap until the selecting Combobox batch ends.
            // Keep only the focus destination requested by this synchronous action.
            if (dispatching() && event.relatedTarget instanceof HTMLElement && !panel?.contains(event.relatedTarget)) actionFocus = event.relatedTarget;

            // A recovery action must run before blur can retry storage and remove its target.
            if (event.relatedTarget instanceof Element && event.relatedTarget.closest(".switcher .reserved-actions")) return;
            retain();
          });
        }} items={shown()} contentRow={item => !item.value.startsWith("action:")} group={(item) => item.value.startsWith("action:") ? copy.switcherActions : undefined} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onInput={() => {}}
          onSelect={(value) => chooseValue(value)}
          label={copy.switcherLabel} placeholder={copy.switcherPlaceholder} empty={makeName() === "" ? copy.noMatch : <>{copy.makeWorkstream} {copy.workstreamName(makeName())} <KeyChip keys={SWITCHER_KEYS.choose} /></>}
          row={(item) => {
            const action = actions().find((candidate) => candidate.value === item.value);
            const entry = byValue().get(item.value);

            if (action) return <>
              <Show when={recording() === action.value} fallback={<KeyHint class="switcher-action" labelClass="switcher-name" chipAfter keys={keysOf(action)}>{action.label}</KeyHint>}>
                <span class="switcher-action key-hint"><span class="switcher-name">{action.label}</span> <span class="switcher-recording">{copy.pressAKey}</span></span>
              </Show>
            </>;

            if (!entry && item.value.startsWith(USER_PREFIX)) return <span class="switcher-action key-hint"><span class="switcher-name">{item.label}</span></span>;

            if (!entry) return null;

            return <StatusTip placement="right-start" status={entry.node?.status} dismissed={entry.node ? rail.dismissed(entry.node) : false}>{reveal => <span class="switcher-row" {...reveal()}>
              <Show when={entry.node?.status} fallback={entry.todo !== undefined ? <KindGlyph kind={entry.todo.blocked ? "blocked" : "idle"} decorative /> : entry.pad !== undefined ? <Icon name={PAD_ICON} /> : <span class="switcher-mark" />}>{(status) => <KindGlyph kind={shownKind(status(), rail.dismissed(entry.node!))} decorative />}</Show>
              <Show when={entry.todo !== undefined || entry.pad !== undefined}><span class="switcher-kind">{entry.todo !== undefined ? copy.kindTodo : copy.kindPad}</span></Show>
              <span class="switcher-name">{entry.label}</span>
              <Show when={entry.owner}><span class="switcher-owner">{entry.owner}</span></Show>
              <Show when={entry.node && !rail.dismissed(entry.node)}><FailureLine status={entry.node?.status} /></Show>
            </span>}</StatusTip>;
          }} />
        <ReservedLine message={makeFailure()} />
        <p class="switcher-footer"><For each={footer()}>{key => <span class="switcher-footer-key"><KeyChip keys={key.keys} /> {key.label}</span>}</For></p>
        <ReservedLine message={retentionProblem() ? copy.switcherRetentionFailure(retentionProblem()!.operation, project.name) : null}>
          <Show when={text() !== "" && !copyFailure()}>
            <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={copyQuery}>{copied() ? copy.queryCopied : copy.copyQuery}</button>
          </Show>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => { drafts.retry(); }}>{copy.retryStorage}</button>
          <Show when={text() !== ""}>
            <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => {
              const draft = current();

              if (draft) drafts.discard(draft.revision);
              setText("");
            }}>{copy.discardQuery}</button>
          </Show>
        </ReservedLine>
        <ReservedLine message={copyFailure() ? copy.switcherCopyFailure : null}>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={copyQuery}>{copied() ? copy.queryCopied : copy.copyQuery}</button>
          <button data-button="quiet" ref={restoreFocusOnRemoval} onClick={() => { setCopyFailure(null); }}>{copy.close}</button>
        </ReservedLine>
        <Show when={refusal()}>{shown => <ReservedLine message={shown().cause} />}</Show>
      </section>
    </Show>
  );
};
