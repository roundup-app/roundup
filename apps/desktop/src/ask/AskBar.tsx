import "../ui/Row.css";
import { Inbox } from "../inbox/Inbox";
import { AskRows } from "./AskRows";
import { useDialog } from "@ark-ui/solid/dialog";
import { Presence } from "@ark-ui/solid/presence";
import { captureFocus, queueFocus } from "../keys/focus";
import type { JSX } from "solid-js";
import { batch, untrack, createEffect, createMemo, createSignal, For, Index, onCleanup, Show } from "solid-js";
import * as v from "valibot";
import type { AskSubmission } from "../state/asks";
import { copy } from "./copy";
import { dismissable, ReservedLine } from "../ink/ReservedLine";
import { ASK_CLOSE, CHORDS, chordsFor } from "../keys/chords";
import { modalOpen, modalOutside, registerKeys, type KeyScope } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { Select } from "../ui/Select";
import { createProjectPick } from "./projectPick";
import { Mentions } from "../ui/Mentions";
import { KindGlyph } from "../ink/KindGlyph";
import { errorCause, shownKind } from "../ink/FailureLine";
import { selectedRailRow } from "../rail/selectedRow";
import { Tip } from "../ui/Tip";
import { ProjectOverview } from "./Overview";
import { createDeliverables, Deliverables } from "./Deliverables";
import { createCut } from "../ink/Tip";
import "./styles.css";

/** The leading `@` and the letters after it, while the user has not yet typed the space that ends the name (U504). */
const mentionOf = (text: string): string | null => /^@(\S*)$/.exec(text)?.[1] ?? null;

const optionalViews = ["made"];

/** U504, U6244c: the Ask bar and its rows. Only `⌘/` opens it, over whatever the centre shows; Escape closes it and returns focus. Requested lists show while nothing is selected. */

export const AskBar = (props: {
  /** Change on the mounted owner to open one retained revision without reloading its readers.
   * Closing returns ordinary editing to the current work; selection never submits or reconciles.
   */
  recovery?: { project: string; revision: string } | undefined;
  viewLabel?: ((id: string) => string | undefined) | undefined;
}) => {
  const connected = useConnectedProject();
  const { asks, rail, daemonExit, drafts } = connected;
  const deliverables = createDeliverables();

  const [opening, setOpening] = createSignal<"over" | null>(null);
  const over = () => opening() === "over";
  const [selected, setSelected] = createSignal<string | null>(null);
  const destination = { surface: "ask", object: "ask-bar", recipient: null };
  const formSchema = v.object({ text: v.string(), workstream: v.optional(v.nullable(v.string())), name: v.optional(v.nullable(v.string())), recovered: v.optional(v.literal(true)) });

  drafts.validate("ask", formSchema);
  drafts.registerRecovery("ask", (draft, facts) => {
    const target = v.safeParse(v.string(), draft.value.workstream);
    const available = !target.success || facts.rail.nodes.some(node => node.kind === "workstream" && node.id === target.output);
    const state = facts.daemonExit() !== null || facts.rail.failure() ? "unverified" : available ? "available" : "unavailable";

    return state;
  });
  const records = () => drafts.list().filter(draft => draft.destination.surface === "ask" && draft.destination.object === "ask-bar" && draft.destination.recipient === null);

  const problem = () => {
    const found = drafts.problem();

    const own = found?.destination?.surface === destination.surface
      && found.destination.object === destination.object && found.destination.recipient === destination.recipient;

    return !connected.drawer.content() && own ? found : null;
  };

  // Recovered edits remain selectable without displacing the ordinary current work.
  const ordinary = () => records().filter(draft => draft.value.recovered !== true).at(-1);

  const current = () => {
    if (selected() !== null) return records().find(draft => draft.revision === selected() && draft.status !== "pending");

    const latest = ordinary();

    return latest?.status === "draft" || latest?.status === "failed" ? latest : undefined;
  };

  const text = () => {
    const value = v.safeParse(v.string(), current()?.value.text);

    return value.success ? value.output : "";
  };

  const setText = (value: string, recipient?: string) => {
    const previous = current();
    const captured = v.safeParse(v.string(), previous?.value.workstream);
    const previousName = v.safeParse(v.string(), previous?.value.name);
    const starts = (text: string, name: string) => text.toLowerCase().startsWith(`@${name.toLowerCase()} `);

    const named = recipient === undefined
      ? rail.nodes.filter(node => node.kind === "workstream" && starts(value, node.name)).sort((a, b) => b.name.length - a.name.length)[0]
      : rail.nodes.find(node => node.kind === "workstream" && node.id === recipient);

    // Newly typed longer names are a new choice; a replacement matching unchanged text is not.
    const keep = recipient === undefined && captured.success && previousName.success && starts(value, previousName.output)
      && !(named && named.name.length > previousName.output.length && !starts(text(), named.name));

    const workstream = keep ? captured.output : named?.id ?? null;
    const name = keep ? previousName.output : named?.name ?? null;

    const recovering = selected() !== null;

    const recovered = previous?.value.recovered === true || (recovering && previous?.revision !== ordinary()?.revision);

    const form = { text: value, workstream, name };

    const retained = drafts.edit(destination, recovered ? { ...form, recovered: true } : form,
      field ? { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection } : null, "ordinary",
      previous?.revision ?? null);

    if (recovering) setSelected(retained.draft.revision);
  };

  const retainSelection = () => {
    const draft = current();

    if (!draft || !field?.isConnected) return;
    const selection = { start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection };

    if (JSON.stringify(draft.selection) !== JSON.stringify(selection)) drafts.setSelection(draft.revision, selection);
  };

  const restoreSelection = (element: HTMLTextAreaElement) => {
    field = element;
    const caret = current()?.selection;

    queueMicrotask(() => {

      if (element.isConnected && caret) element.setSelectionRange(caret.start, caret.end, caret.direction);
    });
  };

  const [failure, setFailure] = createSignal<{ revision: string; message: string } | null>(null);
  const [dismissed, setDismissed] = createSignal(false);

  const dismissSend = () => {
    setFailure(null);

    const intake = asks.intakeFailure();

    if (intake) asks.dismiss(intake);
  };

  const sendLine = dismissable(() => problem() ? copy.draftRetention(connected.project.name, copy.draftSurface("ask"), problem()!.cause) : failure()?.message ?? (records().some(draft => draft.status === "unknown") ? null : asks.failure()));

  const dismissSendLine = () => {
    const listed = asks.listFailure() ?? asks.intakeFailure();

    if (problem()) sendLine.dismiss();
    else if (failure()) dismissSend();
    else if (listed) asks.dismiss(listed);
    else sendLine.dismiss();
  };

  const [highlighted, setHighlighted] = createSignal<string | null>(null);
  let panel: HTMLElement | undefined;
  let field: HTMLTextAreaElement | undefined;

  let openingFocus = captureFocus();
  let selectedPane = false;

  const dialog = useDialog(() => ({
    open: over(), modal: false, trapFocus: true, preventScroll: false,
    restoreFocus: true, closeOnInteractOutside: true,
    "aria-label": copy.askBarLabel,
    initialFocusEl: () => openingFocus.target(() => {
      if (field) restoreSelection(field);

      return field;
    }),
    finalFocusEl: () => selectedPane
      ? document.querySelector<HTMLElement>('.thread[data-mode="thread"] .thread-composer textarea:not(:disabled)')
        ?? document.querySelector<HTMLElement>(".pane-screen textarea")
        ?? selectedRailRow()
      : null,
    // Background layers may close while Ask remains the newer focus owner.
    onRequestDismiss: event => event.preventDefault(),
    onOpenChange: details => { if (!details.open) close(true); },
  }));

  // Requested lists show with nothing selected; the Made list shows over any selection.
  const listed = () => optionalViews.some(connected.hasView) || rail.selected() === null && (connected.hasView("attention") || connected.hasView("workstreams"));
  const shown = () => over() || listed();

  createEffect(() => {
    if (over()) onCleanup(drafts.editor(destination));
  });

  asks.load();
  const [treeReady, setTreeReady] = createSignal(false);
  void rail.settled().then(() => setTreeReady(true));

  const names = createMemo(() => rail.nodes.filter((node) => node.kind === "workstream").map((node) => ({ value: node.id, label: node.name })));

  const matching = createMemo(() => {
    const typed = mentionOf(text());

    return dismissed() || typed === null ? [] : names().filter((item) => item.label.toLowerCase().includes(typed.toLowerCase()));
  });

  createEffect(() => {
    const list = matching();

    if (!list.some((item) => item.value === highlighted())) setHighlighted(list[0]?.value ?? null);
  });

  const close = (restore: boolean): void => {
    if (optionalViews.some(connected.hasView)) optionalViews.forEach(connected.hideView);
    selectedPane = !restore;
    batch(() => { setOpening(null); setSelected(null); });

    if (field?.isConnected) restoreSelection(field);
  };

  createEffect(() => { if (over() && modalOutside(panel)) close(false); });

  const open = (): void => {
    if (modalOpen()) return;
    selectedPane = false;
    openingFocus = captureFocus(true);
    setOpening("over");
  };

  createEffect(() => {
    const recovery = props.recovery;

    untrack(() => {
      if (!recovery || recovery.project !== connected.project.path) return;
      const draft = records().find(entry => entry.revision === recovery.revision);

      if (!draft || draft.status === "pending" || drafts.availability(draft, connected) !== "available") return;
      batch(() => { setSelected(draft.revision); open(); });
    });
  });

  registerKeys({ kind: "app" }, [{
    action: CHORDS.find((row) => row.name === "ask.open")!,
    when: () => daemonExit() === null && !over(),
    capture: () => ({ available: () => daemonExit() === null && !over(),
    invoke: open }),
  }]);
  const scope: KeyScope = { kind: "layer", element: () => panel, active: over, modal: true };

  registerKeys(scope, [
    { chords: chordsFor("⌘/"), run: (press) => { if (!press.repeat) close(true); } },
    { chords: ASK_CLOSE, when: event => !(event.target instanceof Element && event.target.closest(".app-select-list, [aria-expanded=true]")), run: () => { if (matching().length > 0) setDismissed(true); else close(true); } },
  ]);

  const projectPick = createProjectPick({
    place: value => asks.place(value),
    projects: asks.projects,
    active: connected.project.name,
    text,
    named: () => v.safeParse(v.string(), current()?.value.workstream).success,
  });

  const send = async (): Promise<void> => {
    const value = text();

    if (value.trim() === "") return;

    const draft = current();
    // Read before the submit makes the draft pending and empties the field.
    const placement = projectPick.request();

    if (!draft || !(await drafts.submit(draft.revision))) return;
    setFailure(null);
    const workstream = v.safeParse(v.string(), draft.value.workstream);
    const request: AskSubmission = { text: value, submission: draft.revision };

    if (workstream.success) request.workstream = workstream.output;
    else Object.assign(request, placement);

    projectPick.clear();
    void asks.send(request).then((outcome) => {
      drafts.settle(draft.revision, outcome.kind === "refused" ? "failed" : outcome.kind);

      if (outcome.kind === "refused") setFailure({ revision: draft.revision, message: copy.askNotSent + outcome.error.message });
    });
  };

  const complete = (id: string): void => {
    const node = rail.nodes.find(node => node.kind === "workstream" && node.id === id);

    if (!node) return;
    const value = `@${node.name} `;

    setText(value, id);
    field?.focus({ preventScroll: true });
    field?.setSelectionRange(value.length, value.length);
    retainSelection();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && matching().length > 0) {
      event.preventDefault();
      event.stopPropagation();
      setDismissed(true);

      return;
    }

    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;

    event.preventDefault();

    const picked = matching().length > 0 ? highlighted() : null;

    if (picked === null) send();
  };

  return (<>
    <Show when={shown()}>
      <section {...(over() ? dialog().getContentProps() : {})} role={over() ? "dialog" : "region"} class="ask-bar" data-mode={over() ? "over" : "home"} aria-label={copy.askBarLabel} ref={(element) => { panel = element; }}>
        <Show when={over()}><div class="ask-compose">
        <Mentions.Root inputValue={text()} onDismiss={() => setDismissed(true)} items={matching()} highlightedValue={highlighted()} onHighlightChange={setHighlighted} onSelect={complete}>
          <Mentions.Field class="ask-input" ref={restoreSelection}
            rows={1} aria-label={copy.askBarLabel} placeholder={copy.askBarPlaceholder} value={text()} open={matching().length > 0}
            onInput={(event) => { setDismissed(false); setText(event.currentTarget.value); }} onSelect={retainSelection} onKeyUp={retainSelection} onClick={retainSelection} onKey={onKey} />
          <Show when={matching().length > 0}><Mentions.List label={copy.askMentions} items={matching()} row={item => {
            const node = () => rail.nodes.find(node => node.id === item.value);

            const parent = () => names().filter(other => other.label === item.label).length > 1
              ? (rail.nodes.find(other => other.id === node()?.parent)?.name ?? connected.project.name) : undefined;

            const start = () => item.label.toLowerCase().indexOf((mentionOf(text()) ?? "").toLowerCase());
            const end = () => start() + (mentionOf(text())?.length ?? 0);

            const [cutRef, cut] = createCut();

            const dismissed = () => node() !== undefined && rail.dismissed(node()!);

            return <><KindGlyph decorative kind={shownKind(node()?.status, dismissed())} /><Tip text={item.label} cut={cut}>{trigger => <span {...trigger()} ref={cutRef} class="app-mention-name">{item.label.slice(0, start())}<mark>{item.label.slice(start(), end())}</mark>{item.label.slice(end())}</span>}</Tip><Show when={parent()}>{name => <span class="app-mention-parent">{name()}</span>}</Show><Show when={!dismissed()}><Show when={errorCause(node()?.status, false)}>{cause => <ReservedLine status={cause()} />}</Show></Show></>;
          }} /></Show>
        </Mentions.Root>
        <Show when={projectPick.chips().length > 0}><div class="ask-choices ask-chips">
          <Index each={projectPick.chips()}>{(chip, index) => <span class="ask-chip">
            <span class="ask-chip-lead">{projectPick.chips().length > 1 ? chip().text : copy.askProject}</span>
            <Select label={projectPick.chips().length > 1 ? copy.askProjectOf(chip().text) : copy.askProject} value={chip().project}
              choices={asks.projects().map(project => ({ value: project.name, label: project.name }))} onValueChange={value => projectPick.pick(index, value)} />
          </span>}</Index>
        </div></Show>
        <ReservedLine overlay class="ask-send-status" message={sendLine.message()} status={records().some(draft => draft.status === "unknown") ? copy.askUnknownState : null} dismiss={dismissSendLine} recover={problem() ? { run: () => drafts.retry(), label: copy.storageRetry } : undefined} action={<>
        <For each={records().filter(draft => draft.status === "unknown").map(draft => draft.revision)}>{revision => {
          const [cause, setCause] = createSignal<string | null>(null);
          const label = () => String(records().find(draft => draft.revision === revision)?.value.text ?? "");

          return <div class="reserved-unknown">
            <div class="ask-unknown-content">
              <span class="ask-unknown-text">{label()}</span>
              <span data-state="unknown">{cause() ? copy.askUnknown + cause() : copy.askUnknownState}</span>
            </div>
            <button type="button" data-button="quiet" aria-label={copy.askCheckAcceptanceLabel(label())} onClick={() => {
              void asks.reconcile(revision).then(outcome => {
                drafts.settle(revision, outcome.kind === "refused" ? "failed" : outcome.kind);

                if (outcome.kind === "unknown") setCause(outcome.message);
                else setFailure(previous => previous?.revision === revision ? null : previous);
              });
            }}>{copy.askCheckAcceptance}</button>
          </div>;
        }}</For>
        </>} />
        </div>
        <AskRows keys={scope} onOpened={() => close(false)} /></Show>
        <Show when={!over()}>
          <RequestedViews ready={treeReady()} deliverables={deliverables} />
        </Show>
      </section>
    </Show>
  </>);
};

/** On-demand lists: Made, the full attention inspection and the Workstreams view (U504). Each closes back to the Ask input. */
const RequestedViews = (props: { ready: boolean; deliverables: ReturnType<typeof createDeliverables> }) => {
  const connected = useConnectedProject();

  // A request made from a Terminal brings the Overview forward first, as the Project menu's Made does.
  createEffect(() => { if (connected.hasView("attention") || connected.hasView("made")) untrack(() => connected.rail.select(null)); });

  // A requested list keeps its selection while another is up: Presence mounts it on the first request and then only hides it.
  const wanted = (id: string) => connected.hasView(id) && (id === "made" || !connected.hasView("made"));

  const Requested = (own: { id: "attention" | "made"; label: string; children: JSX.Element }) => <Presence lazyMount present={wanted(own.id)}>
    <div class="made-heading"><h2 class="overview-heading">{own.label}</h2><button type="button" data-button="quiet" onClick={() => { connected.hideView(own.id); queueFocus(() => document.querySelector<HTMLElement>(".ask-input")?.focus()); }}>{copy.closeView(own.label)}</button></div>
    {own.children}
  </Presence>;

  return <>
    <Presence lazyMount present={props.ready && wanted("workstreams")}><ProjectOverview /></Presence>
    <Requested id="attention" label={copy.needsYou}><Inbox /></Requested>
    <Requested id="made" label={copy.deliverables}><Deliverables state={props.deliverables} /></Requested>
  </>;
};
