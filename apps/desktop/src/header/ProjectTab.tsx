import { dismissable, ReservedLine } from "../ink/ReservedLine";
import type { ProjectsState } from "../state/projects";
import { copy } from "./copy";
import * as v from "valibot";
import { ProjectDraftsContext, type createProjectDrafts } from "../state/connectedProject";
import { createEffect, createMemo, createSignal, flush, onCleanup, onSettled, Show, untrack, useContext } from "solid-js";
import { createNear } from "../ink/near";
import { Icon } from "../ink/Icon";
import { FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { Tabs } from "../ui/Tabs";
import { NameDraftRecovery } from "../drawer/NameDraftRecovery";
import type { SortableParts } from "../ui/sortable";
import { contextMenu, openOnRelease } from "../ui/contextMenu";
import type { MenuEntry } from "../ui/contextMenu";
import type { App } from "../app/seam";
import { modalOpen, registerKeys } from "../keys/registry";
import { CHORDS, TAB_CLOSE, ariaChord } from "../keys/chords";
import { MARKS, markOf, nameParts } from "./tab";
import { PROJECT_ALERTS, type ProjectAlerts } from "../state/projectAlerts";
import { createDraftField } from "../state/draftField";
import type { Applied } from "../app/pending";
import type { StripTab } from "./tab";

const schema = v.strictObject({ name: v.string(), base: v.exactOptional(v.string()) });

/** A Project's draft owner, checking its header drafts and recovering only those that name this Project. */
const headerDrafts = (drafts: ReturnType<ReturnType<typeof createProjectDrafts>> | undefined, path: string) => {
  drafts?.validate("header", schema);
  drafts?.registerRecovery("header", draft => draft.destination.object === path ? "available" : "unavailable");

  return drafts;
};

type Field = ReturnType<typeof createDraftField<v.InferOutput<typeof schema>>>;

type Renamed = Awaited<ReturnType<ProjectsState["rename"]>>;

/** A rename's reply as the draft field reads a change: acknowledged is applied, failed is refused, unknown stays unsettled. */
const asApplied = (renamed: Renamed): Applied<Renamed> => {
  if (renamed.status === "acknowledged") return { kind: "applied", value: renamed };
  const error = new Error(renamed.error);

  return { kind: renamed.status === "failed" ? "refused" : "pending", error, thrown: error };
};

/** Enter or a click elsewhere sends the new name through the draft owner's own send, so a recovered name goes too; with no owner it is sent directly. */
const sendRename = async (draft: Field | undefined, rename: () => ReturnType<ProjectsState["rename"]>, acknowledged: (renamed: Renamed) => void, skipped: () => void) => {
  if (!draft) {
    void rename().then(acknowledged);

    return;
  }

  draft.save();
  const sent = await draft.send(() => rename().then(asApplied));

  if (sent.kind === "skipped") skipped();
  else if (sent.kind === "applied") acknowledged(sent.result);
};

/** Rename keeps authored keystrokes out of Project shortcuts while leaving native text editing intact. */
const RenameField = (props: { name: string; restored: "none" | "current" | "selected"; selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null; onEdit: (field: HTMLInputElement) => void; onDone: (saved: string | null, refocus: boolean) => void }) => {
  let field: HTMLInputElement | undefined;
  let finished = false;
  let changed = false;

  const finish = (saved: string | null, refocus: boolean) => {
    if (finished) return;
    finished = true;

    if (field) props.onEdit(field);
    props.onDone(saved, refocus);
  };

  onCleanup(() => { if (!finished && field) props.onEdit(field); });

  registerKeys({ kind: "layer", element: () => field, active: () => !finished, modal: true }, [
    { chords: ["Enter"], when: (press) => !press.isComposing, run: () => finish(field?.value ?? "", true) },
    { chords: ["Escape"], when: (press) => !press.isComposing, run: () => finish(null, true) },
  ]);
  onSettled(() => {
    field?.focus();

    if (props.selection) field?.setSelectionRange(props.selection.start, props.selection.end, props.selection.direction);
    else field?.select();
  });

  return <input spellcheck="false" autocorrect="off" autocapitalize="off" class="tab-rename field-inline" aria-label={copy.projectName} value={props.name} ref={field}
    onInput={event => { changed = true; props.onEdit(event.currentTarget); }}
    onSelect={event => { if (!finished && document.activeElement === event.currentTarget) props.onEdit(event.currentTarget); }}
    onBlur={event => {
      // Keep the tab geometry until Ark receives the destination tab's click; selection closes this editor.
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest('[role="tab"]')) {
        finished = true;

        return;
      }

      finish((event.relatedTarget instanceof Element && event.relatedTarget.closest(".strip")) || (props.restored === "selected" || (props.restored === "current" && !changed)) ? null : field?.value ?? "", false);
    }} />;
};

/** One Project's library-owned tab, with a sibling close control. */
type BulkCloses = { others?: (() => void) | undefined; left?: (() => void) | undefined; right?: (() => void) | undefined };

const bulkCloseItems = (closing: BulkCloses = {}) => [
  { id: "close-others", label: copy.closeOthers, enabled: closing.others !== undefined, run: () => closing.others?.() },
  { id: "close-left", label: copy.closeToLeft, enabled: closing.left !== undefined, run: () => closing.left?.() },
  { id: "close-right", label: copy.closeToRight, enabled: closing.right !== undefined, run: () => closing.right?.() },
];

const closeOnKey = (close: () => void) => (press: KeyboardEvent) => {
  if (TAB_CLOSE.presses.includes(press.key) && !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey && !press.isComposing) {
    press.preventDefault();
    close();
  }
};

/** A selected revision reopens in its own Project once it is no longer pending. Older shared recovery records had no captured base: they stay copy/discard-only. */
const reopensSelected = (ownProject: boolean, retained: { status: string } | undefined, value: { base?: string | undefined } | null): boolean =>
  ownProject && retained !== undefined && retained.status !== "pending" && value !== null && value.base !== undefined;

/** U2694a: the Project tab's system menu; Recover drafts shows only when there is work to recover. */
const tabMenu = (tab: { edit: () => void; recoverable: boolean; recover: () => void; alerts: ProjectAlerts; onAlerts: (level: ProjectAlerts) => void; close: () => void; closing: BulkCloses | undefined }): MenuEntry[] => [
  { id: "rename", label: copy.rename, shortcut: "F2", run: tab.edit },
  ...(tab.recoverable ? [{ id: "recover", label: copy.recoverDrafts, run: tab.recover }] : []),
  { id: "alerts", label: copy.alerts, children: PROJECT_ALERTS.map(level => ({ id: `alerts:${level}`, label: copy.alertLevels[level], checked: tab.alerts === level, run: () => tab.onAlerts(level) })) },
  { id: "close", label: copy.close, run: tab.close },
  ...bulkCloseItems(tab.closing),
];

export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  suppressed?: boolean;
  closeFocus?: boolean;
  /** U6220c: the sortable the strip lifts this tab with; a tab without one stays where it is. */
  sort?: SortableParts | undefined;
  /** U6220d: this Project's alert level, and the menu's way to change it. */
  alerts: ProjectAlerts;
  onAlerts: (level: ProjectAlerts) => void;
  /** Opens only this Project's retained revision with its captured base; absent/foreign,
   * pending and legacy records stay copy/discard-only. Opening never sends or reads.
   */
  recovery?: { project: string; revision: string } | undefined;
  onMark: () => void;
  onRename: (name: string, base?: string) => ReturnType<ProjectsState["rename"]>;
  onClose: () => void;
  /** U6544b: the menu's bulk closes; absent when that item would close nothing. */
  closing?: BulkCloses | undefined;
  /** U2694a: the seam that shows the tab's system menu; a tab without one has none. */
  app?: Pick<App, "showContextMenu" | "writeClipboardText"> | undefined;
  ref?: (element: HTMLElement) => void;
}) => {
  const { near, handlers } = createNear();
  const [editing, setEditing] = createSignal<{ width: number; from: { revision: string } | undefined } | null>(null);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const mark = () => props.suppressed ? null : markOf(props.tab);
  const parts = createMemo(() => nameParts(props.tab.name));
  const path = untrack(() => props.tab.path);
  const drafts = headerDrafts(useContext(ProjectDraftsContext)?.(path), path);
  const destination = Object.freeze({ surface: "header", object: path, recipient: null });
  createEffect(createMemo(() => editing() !== null), open => open && drafts ? drafts.editor(destination) : undefined);
  const records = createMemo(() => drafts?.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === props.tab.path && draft.destination.recipient === null) ?? []);
  const current = createMemo(() => records().filter(draft => draft.status === "draft").at(-1));
  const [recovering, recover] = createSignal(false);
  const [copyFailure, failCopy] = createSignal<{ project: string; revision: string | null; message: string } | null>(null);
  createEffect(
    () => {
      const failure = copyFailure();

      return !!failure && (failure.project !== props.tab.path || (failure.revision !== null && !records().some(draft => draft.revision === failure.revision)));
    },
    stale => { if (stale) failCopy(null); },
  );

  const problem = createMemo(() => {
    const failure = drafts?.problem();

    return (failure?.destination && failure.destination.surface !== "header") || (!failure?.destination && records().length === 0) ? null : failure;
  });

  const retention = dismissable(() => {
    const failure = problem();

    return failure ? copy.draftRetention(props.tab.name, copy.projectName, failure.cause) : null;
  });

  let panel: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => panel, active: recovering, modal: true }, []);

  let base: string | undefined;
  let restoredSelection: ReturnType<NonNullable<typeof drafts>["list"]>[number]["selection"] = null;
  let initialName = "";
  let restored: "none" | "current" | "selected" = "none";

  const capture = (draft: Field | undefined, field: HTMLInputElement) => {
    const selection = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    draft?.keep(base === undefined ? { name: field.value } : { name: field.value, base }, selection);
  };

  createEffect(() => props.selected, selected => { if (!selected) setEditing(null); });

  // A rename field holds the pointer's drags for its text selection.
  createEffect(() => ({ sortable: props.sort?.sortable, renaming: editing() !== null }), ({ sortable, renaming }) => { if (sortable) sortable.disabled = renaming; });

  /** The tab's name button is the sortable's handle for as long as it is shown. */
  const dragHandleRef = () => {
    onCleanup(() => props.sort?.handleRef(undefined));

    return (element: HTMLButtonElement) => { button = element; props.sort?.handleRef(element); };
  };

  const edit = (selected?: { project: string; revision: string }) => {
    const retained = selected ? records().find(draft => draft.revision === selected.revision)
      : current() ?? records().filter(draft => draft.status === "failed").at(-1);

    const parsed = retained && v.safeParse(schema, retained.value);
    const value = parsed && parsed.success ? parsed.output : null;

    if (selected && !reopensSelected(selected.project === props.tab.path, retained, value)) return;
    base = value ? value.base : props.tab.base;
    initialName = value?.name ?? props.tab.name;
    restored = selected ? "selected" : value ? "current" : "none";
    restoredSelection = value ? retained!.selection : null;
    setEditing({ width: wrap?.offsetWidth ?? 0, from: retained && value ? { revision: retained.revision } : undefined });
  };

  createEffect(() => props.recovery, selected => { if (selected) edit(selected); });

  registerKeys({ kind: "region", element: () => wrap }, [
    { action: CHORDS["rail.rename"], when: press => press.target === button,
      capture: focus => ({
        available: () => focus === button && button?.isConnected === true && document.activeElement === button && editing() === null && !modalOpen(),
        invoke: () => edit(),
      }),
    },
  ]);

  const finishRename = async (draft: Field | undefined, saved: string | null, refocus: boolean) => {
    setEditing(null);

    // The tab button the rename field replaced is drawn again by the flush; focus lands on that one.
    if (refocus) {
      flush();
      button?.focus();
    }

    if (saved !== null && base === undefined) {
      recover(true);

      return;
    }

    if (saved !== null) {
      const failure = copyFailure();
      const expected = base;
      const onRename = props.onRename;
      const rename = () => onRename(saved, expected);

      const acknowledged = (renamed: Renamed) => {
        if (renamed.status === "acknowledged" && copyFailure() === failure) failCopy(null);
      };

      await sendRename(draft, rename, acknowledged, () => recover(true));
    }
  };

  return <>
    <FlatTab class="project-tab" selected={props.selected} role="presentation" data-path={props.tab.path}
      style={editing() === null ? undefined : { width: `${editing()?.width}px` }}
      ref={(element) => { wrap = element; props.ref?.(element); props.sort?.ref(element); }}
      onPointerEnter={handlers.onMouseEnter} onPointerLeave={handlers.onMouseLeave}
      onFocusIn={handlers.onFocusIn} onFocusOut={handlers.onFocusOut}
      onContextMenu={(press: MouseEvent) => {
        const app = props.app;

        // The menu shows the tab as it is when the press is released.
        if (app) openOnRelease(press, (x, y) => void contextMenu(app, untrack(() => tabMenu({ edit, recoverable: !!(records().length || problem() || copyFailure()), recover: () => recover(true), alerts: props.alerts, onAlerts: props.onAlerts, close: props.onClose, closing: props.closing })), x, y));
      }}>
      <Show when={editing() === null} fallback={<Show when={editing()} keyed>{session => {
        const draft = drafts && createDraftField(drafts, destination, schema, session.from);

        return <RenameField name={initialName} restored={restored} selection={restoredSelection} onEdit={field => capture(draft, field)} onDone={(saved, refocus) => finishRename(draft, saved, refocus)} />;
      }}</Show>}>
        <Tabs.Trigger value={props.tab.path} class="tab-name-button"
          aria-description={records().length || problem() || copyFailure() ? copy.unfinishedWork : undefined} data-selected={props.selected ? "true" : undefined} aria-busy={props.tab.busy ? "true" : "false"} aria-keyshortcuts={ariaChord(TAB_CLOSE)}
          onKeyDown={closeOnKey(() => props.onClose())}
          ref={dragHandleRef()}
          onClick={(click) => {
            if (click.target instanceof Element && click.target.closest('.tab-mark')) {
              click.preventDefault();
              props.onMark();
            }
          }}>
          <span class="tab-name" onDblClick={() => edit()}><span class="tab-head">{parts()[0]}</span><span class="tab-tail">{parts()[1]}</span></span>
          <span class="tab-mark-slot"><Show when={mark()}>{(shown) => <span class="tab-mark ink" data-tone={MARKS[shown()].tone} data-kind={shown()} role="img" aria-label={MARKS[shown()].label} />}</Show></span>
        </Tabs.Trigger>
        <div class="tab-actions">
        <IconButton class="tab-close" aria-hidden="true" tabindex={-1} aria-label={copy.closeProject(props.tab.name)} data-visible={String(near() || props.selected || props.closeFocus === true)} onClick={() => props.onClose()}><Icon name="x" /></IconButton>
        </div>
      </Show>
    </FlatTab>
    <NameDraftRecovery class="header-recovery" open={recovering()} onOpenChange={recover} finalFocusEl={() => button ?? null} panel={element => { panel = element; }}
      identity={props.tab.name} records={records()} current={current()} app={props.app!}
      lines={<>
        <ReservedLine message={copyFailure()?.message} dismiss={() => failCopy(null)} />
        <Show when={retention.message()}>{message => <ReservedLine message={message()} dismiss={retention.dismiss} recover={{ run: () => drafts?.retry(), label: copy.storageRetry }} />}</Show>
      </>}
      label={(draft, index, isCurrent) => copy.draftIdentity(isCurrent ? copy.currentDraft : copy.draftStatus[draft.status], String(index + 1))}
      solo={(draft, isCurrent) => <ReservedLine aria-label={copy.draftStatus[draft.status]} status={isCurrent ? copy.currentDraft : copy.draftStatus[draft.status]} data-state={draft.status} />}
      notice={draft => <ReservedLine status={draft.value.base !== props.tab.base ? copy.railDraftConflict : null} />}
      value={draft => String(draft.value.name ?? "")}
      onCopySuccess={() => failCopy(null)}
      onCopyFailure={(draft, error) => failCopy({ project: destination.object, revision: draft.revision, message: copy.copyDraftFailure(error.message) })}
      onDiscard={draft => { drafts?.discard(draft.revision); setEditing(null); }} />
  </>;
};
