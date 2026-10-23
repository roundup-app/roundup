import { ReservedLine } from "../ink/ReservedLine";
import type { ProjectsState } from "../state/projects";
import { copy } from "../copy";
import * as v from "valibot";
import { ProjectDraftsContext } from "../state/connectedProject";
import { Portal } from "solid-js/web";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show, For, useContext } from "solid-js";
import { createNear } from "../ink/near";
import { Icon } from "../ink/Icon";
import { FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { Tabs } from "../ui/Tabs";
import { Dialog } from "../ui/Dialog";
import { Tip } from "../ui/Tip";
import { contextMenu, openOnRelease } from "../ui/contextMenu";
import type { App } from "../app/seam";
import { registerKeys } from "../keys/registry";
import { MARKS, markOf, nameParts, tipOf } from "./tab";
import type { StripTab } from "./tab";

/** Rename keeps authored keystrokes out of Project shortcuts while leaving native text editing intact. */
const RenameField = (props: { name: string; restored: "none" | "current" | "selected"; selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null; onEdit: (field: HTMLInputElement) => void; onDone: (saved: string | null, refocus: boolean) => void }) => {
  let field: HTMLInputElement | undefined;
  let finished = false;
  let changed = false;

  const finish = (saved: string | null, refocus: boolean) => {
    if (finished) return;
    finished = true;

    if (field && refocus) props.onEdit(field);
    props.onDone(saved, refocus);
  };

  registerKeys({ kind: "layer", element: () => field, active: () => !finished, modal: true }, [
    { chords: ["Enter"], when: (press) => !press.isComposing, run: () => finish(field?.value ?? "", true) },
    { chords: ["Escape"], when: (press) => !press.isComposing, run: () => finish(null, true) },
  ]);
  onMount(() => {
    field?.focus();

    if (props.selection) field?.setSelectionRange(props.selection.start, props.selection.end, props.selection.direction);
    else field?.select();
  });

  return <input class="tab-rename" aria-label={copy.projectName} value={props.name} ref={field}
    onInput={event => { changed = true; props.onEdit(event.currentTarget); }}
    onSelect={event => { if (!finished && document.activeElement === event.currentTarget) props.onEdit(event.currentTarget); }}
    onBlur={event => finish((event.relatedTarget instanceof Element && event.relatedTarget.closest(".strip")) || (props.restored === "selected" || (props.restored === "current" && !changed)) ? null : field?.value ?? "", false)} />;
};

/** One Project's library-owned tab, with a sibling close control. */
export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  closeFocus?: boolean;
  /** Opens only this Project's retained revision with its captured base; absent/foreign,
   * pending and legacy records stay copy/discard-only. Opening never sends or reads.
   */
  recovery?: { project: string; revision: string } | undefined;
  onMark: () => void;
  onRename: (name: string, base?: string) => ReturnType<ProjectsState["rename"]>;
  onClose: () => void;
  /** U2694a: the seam that shows the tab's system menu; a tab without one has none. */
  app?: Pick<App, "showContextMenu"> | undefined;
  ref?: (element: HTMLElement) => void;
}) => {
  const { near, handlers } = createNear();
  const [editing, setEditing] = createSignal<{ width: number } | null>(null);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const mark = () => markOf(props.tab);
  const parts = createMemo(() => nameParts(props.tab.name));
  const authority = useContext(ProjectDraftsContext);
  const drafts = authority?.(props.tab.path);
  const schema = v.strictObject({ name: v.string(), base: v.optional(v.string()) });
  drafts?.validate("header", schema);
  drafts?.registerRecovery("header", draft => draft.destination.object === props.tab.path ? "available" : "unavailable");
  const destination = Object.freeze({ surface: "header", object: props.tab.path, recipient: null });
  createEffect(() => { if (editing() !== null && drafts) onCleanup(drafts.editor(destination)); });
  const records = createMemo(() => drafts?.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === props.tab.path && draft.destination.recipient === null) ?? []);
  const current = createMemo(() => records().filter(draft => draft.status === "draft").at(-1));
  const [recovering, recover] = createSignal(false);
  const [inspected, inspect] = createSignal<string>();
  const [copyFailure, failCopy] = createSignal<string | null>(null);
  const shown = () => records().find(draft => draft.revision === inspected()) ?? current() ?? records().at(-1);

  const problem = createMemo(() => {
    const failure = drafts?.problem();

    return (failure?.destination && failure.destination.surface !== "header") || (!failure?.destination && records().length === 0) ? null : failure;
  });

  let panel: HTMLDivElement | undefined;
  registerKeys({ kind: "layer", element: () => panel, active: recovering, modal: true }, []);

  const copyName = async () => {
    const draft = shown();

    if (!draft) return;
    const parsed = v.safeParse(schema, draft.value);

    if (!parsed.success) return;

    try { await navigator.clipboard.writeText(parsed.output.name); failCopy(null); }
    catch (error) { failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); }
  };

  let base: string | undefined;
  let restoredSelection: ReturnType<NonNullable<typeof drafts>["list"]>[number]["selection"] = null;
  let initialName = "";
  let restored: "none" | "current" | "selected" = "none";
  let revision: string | undefined;

  const capture = (field: HTMLInputElement) => {
    const previous = records().find(draft => draft.revision === revision);
    const selection = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    if (previous?.value.name === field.value && JSON.stringify(previous.selection) === JSON.stringify(selection)) return;
    const value = base === undefined ? { name: field.value } : { name: field.value, base };
    revision = drafts?.edit(destination, value, selection, "ordinary", revision ?? null).draft.revision;
  };

  createEffect(on(() => props.selected, selected => { if (!selected) setEditing(null); }));

  const edit = (selected?: { project: string; revision: string }) => {
    const retained = selected ? records().find(draft => draft.revision === selected.revision)
      : current() ?? records().filter(draft => draft.status === "failed").at(-1);

    const parsed = retained && v.safeParse(schema, retained.value);
    const value = parsed && parsed.success ? parsed.output : null;

    if (selected && (selected.project !== props.tab.path || !retained || retained.status === "pending" || !value || value.base === undefined)) return;
    // Older shared recovery records had no captured base: keep them copy/discard-only.
    base = value ? value.base : props.tab.base;
    initialName = value?.name ?? props.tab.name;
    restored = selected ? "selected" : value ? "current" : "none";
    restoredSelection = value ? retained!.selection : null;
    revision = value ? retained!.revision : undefined;
    setEditing({ width: wrap?.offsetWidth ?? 0 });
  };

  createEffect(on(() => props.recovery, selected => { if (selected) edit(selected); }));

  registerKeys({ kind: "region", element: () => wrap }, [
    { chords: ["F2"], when: (press) => press.target === button, run: () => edit() },
  ]);

  return <Tabs.Context>{(tabs) => <>
    <FlatTab class="project-tab" selected={props.selected} role="presentation" data-path={props.tab.path} data-unfinished={records().length || problem() ? "true" : undefined}
      style={editing() === null ? undefined : { width: `${editing()?.width}px` }}
      ref={(element) => { wrap = element; props.ref?.(element); }}
      onPointerEnter={handlers.onMouseEnter} onPointerLeave={handlers.onMouseLeave}
      onFocusIn={handlers.onFocusIn} onFocusOut={handlers.onFocusOut}
      onContextMenu={(press: MouseEvent) => {
        const app = props.app;

        if (app) openOnRelease(press, (x, y) => void contextMenu(app, [
          { id: "copy", label: copy.copy, run: async () => {
            const details = records().length ? { name: props.tab.name, path: props.tab.path, drafts: records() } : { name: props.tab.name, path: props.tab.path };

            try { await navigator.clipboard.writeText(JSON.stringify(details, null, 2)); failCopy(null); }
            catch (error) { failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); recover(true); }
          } },
          { id: "rename", label: copy.rename, shortcut: "F2", run: edit },
          { id: "close", label: copy.close, run: () => props.onClose() },
        ], x, y));
      }}>
      <Show when={editing() === null} fallback={<Show when={editing()} keyed>{_session => <RenameField name={initialName} restored={restored} selection={restoredSelection} onEdit={capture} onDone={(saved, refocus) => {
        setEditing(null);

        if (refocus) button?.focus();

        if (saved !== null && base === undefined) {
          recover(true);

          return;
        }

        if (saved !== null) {
          const submitted = revision;

          if (submitted && !drafts?.submit(submitted)) {
            recover(true);

            return;
          }

          void props.onRename(saved, base).then(outcome => {
            if (submitted) drafts?.settle(submitted, outcome.status);
          });
        }
      }} />}</Show>}>
        <Tip ids={{ trigger: tabs().getTriggerProps({ value: props.tab.path }).id }} class="tab-tip" content={<>{props.tab.name}<Show when={mark()}><br />{tipOf(props.tab)}</Show><Show when={shown()}>{draft => <><br />{copy.draftIdentity(copy.unfinishedWork, String(draft().value.name ?? ""))}</>}</Show></>}>
          {(tooltip) =>
              <Tabs.Trigger {...tooltip({})} value={props.tab.path} class="tab-name-button"
                aria-description={records().length || problem() ? copy.unfinishedWork : undefined} data-selected={props.selected ? "true" : undefined} aria-busy={props.tab.busy} ref={(element) => (button = element)}
                onClick={(click) => {
                  if (click.target instanceof Element && click.target.closest('.tab-mark')) {
                    click.preventDefault();
                    props.onMark();
                  }
                }}>
                <span class="tab-name" onDblClick={() => edit()}><span class="tab-head">{parts()[0]}</span><span class="tab-tail">{parts()[1]}</span></span>
                <Show when={mark()}>{(shown) => <span class="tab-mark ink" data-tone={MARKS[shown()].tone} data-kind={shown()} role="img" aria-label={MARKS[shown()].label} />}</Show>
              </Tabs.Trigger>
          }
        </Tip>
        <div class="tab-actions">
        <Show when={records().length || problem()}>
          <Tip text={copy.recoverDrafts}>{trigger => <IconButton {...trigger()} class="tab-recover" data-visible={near() || props.selected} tabIndex={props.selected ? 0 : -1} aria-label={copy.draftIdentity(copy.recoverDrafts, props.tab.name)} onClick={() => recover(true)}><Icon name="edit" /></IconButton>}</Tip>
        </Show>
        <IconButton class="tab-close" aria-label={copy.closeProject(props.tab.name)} data-visible={near() || props.closeFocus === true} onClick={() => props.onClose()}><Icon name="x" /></IconButton>
        </div>
      </Show>
    </FlatTab>
    <Dialog.Root instant open={recovering()} onOpenChange={details => recover(details.open)} finalFocusEl={() => button ?? null}>
      <Portal><Dialog.Positioner asChild={positioner => <aside {...positioner({})} />}><Dialog.Content class="draft-recovery header-recovery" ref={element => { panel = element; }}>
        <Dialog.Title asChild={title => <h2 {...title({})}>{copy.unfinishedWork}</h2>} />
        <Dialog.Description class="draft-identity">{props.tab.name}</Dialog.Description>
        <ReservedLine message={(copyFailure()) || (problem() ? (copy.draftRetention(props.tab.name, copy.projectName, problem()!.cause)) : null) || null} />
        <For each={[...records()].reverse().sort((a, b) => Number(b.revision === current()?.revision) - Number(a.revision === current()?.revision))}>{(draft, index) => <Show when={records().length > 1} fallback={<ReservedLine aria-label={copy.draftStatus[draft.status]} status={draft.revision === current()?.revision ? copy.currentDraft : copy.draftStatus[draft.status]} data-state={draft.status} />}><button type="button" data-button="quiet" aria-pressed={shown()?.revision === draft.revision} onClick={() => inspect(draft.revision)}>{copy.draftIdentity(draft.revision === current()?.revision ? copy.currentDraft : copy.draftStatus[draft.status], String(index() + 1))}</button></Show>}</For>
        <Show when={shown()}>{draft => <>
          <ReservedLine status={draft().value.base !== props.tab.base ? copy.railDraftConflict : null} />
          <pre class="draft-value">{String(draft().value.name ?? "")}</pre>
        </>}</Show>
        <div class="draft-actions">
        <Show when={shown()}>{draft => <><button type="button" data-button="quiet" onClick={() => void copyName()}>{copy.copyProjectName}</button>
          <button type="button" data-button="quiet" onClick={() => { drafts?.discard(draft().revision); setEditing(null); }}>{copy.discardRevision}</button>
        </>}</Show>
          <Show when={problem()}><button type="button" data-button="quiet" onClick={() => drafts?.retry()}>{copy.storageRetry}</button></Show>
        <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger></div>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>}</Tabs.Context>;
};
