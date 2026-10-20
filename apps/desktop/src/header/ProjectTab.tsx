import type { ProjectsState } from "../state/projects";
import { copy } from "../copy";
import * as v from "valibot";
import { ProjectDraftsContext } from "../state/connectedProject";
import { Portal } from "solid-js/web";
import { createEffect, createMemo, createSignal, on, onMount, Show, For, useContext } from "solid-js";
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
const RenameField = (props: { name: string; recovered: boolean; selection: { start: number; end: number; direction: "forward" | "backward" | "none" } | null; onEdit: (field: HTMLInputElement) => void; onDone: (saved: string | null, refocus: boolean) => void }) => {
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
    onBlur={event => finish((event.relatedTarget instanceof Element && event.relatedTarget.closest(".strip")) || (props.recovered && !changed) ? null : field?.value ?? "", false)} />;
};

/** One Project's library-owned tab, with a sibling close control. */
export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  closeFocus?: boolean;
  onMark: () => void;
  onRename: (name: string, base?: string) => ReturnType<ProjectsState["rename"]>;
  onClose: () => void;
  /** U2694a: the seam that shows the tab's system menu; a tab without one has none. */
  app?: Pick<App, "showContextMenu"> | undefined;
  ref?: (element: HTMLElement) => void;
}) => {
  const { near, handlers } = createNear();
  const [editing, setEditing] = createSignal<number | null>(null);
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
  const records = createMemo(() => drafts?.list().filter(draft => draft.destination.surface === destination.surface && draft.destination.object === props.tab.path) ?? []);
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

  const originalSourceLabel = copy.copyField(copy.draftField("base").toLowerCase());

  const copyName = async (original = false) => {
    const draft = shown();

    if (!draft) return;
    const parsed = v.safeParse(schema, draft.value);

    if (!parsed.success) return;

    try { await navigator.clipboard.writeText(original ? parsed.output.base ?? "" : parsed.output.name); failCopy(null); }
    catch (error) { failCopy(copy.copyDraftFailure(error instanceof Error ? error.message : String(error))); }
  };

  let base: string | undefined;
  let restoredSelection: ReturnType<NonNullable<typeof drafts>["list"]>[number]["selection"] = null;
  let initialName = "";
  let recovered = false;
  let revision: string | undefined;

  const capture = (field: HTMLInputElement) => {
    const previous = records().find(draft => draft.revision === revision);
    const selection = { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0, direction: field.selectionDirection ?? "none" };

    if (previous?.value.name === field.value && JSON.stringify(previous.selection) === JSON.stringify(selection)) return;
    const value = base === undefined ? { name: field.value } : { name: field.value, base };
    revision = drafts?.edit(destination, value, selection, "ordinary").draft.revision;
  };

  createEffect(on(() => props.selected, selected => { if (!selected) setEditing(null); }));

  const edit = () => {
    const retained = current() ?? records().filter(draft => draft.status === "failed").at(-1);
    const parsed = retained && v.safeParse(schema, retained.value);
    const value = parsed && parsed.success ? parsed.output : null;
    // Older shared recovery records had no captured base: keep them copy/discard-only.
    base = value ? value.base : props.tab.base;
    initialName = value?.name ?? props.tab.name;
    recovered = value !== null;
    restoredSelection = value ? retained!.selection : null;
    revision = value ? retained!.revision : undefined;
    setEditing(wrap?.offsetWidth ?? 0);
  };

  registerKeys({ kind: "region", element: () => wrap }, [
    { chords: ["F2"], when: (press) => press.target === button, run: edit },
  ]);

  return <Tabs.Context>{(tabs) => <>
    <FlatTab class="project-tab" selected={props.selected} role="presentation" data-path={props.tab.path} data-unfinished={records().length || problem() ? "true" : undefined}
      style={editing() === null ? undefined : { width: `${editing()}px` }}
      ref={(element) => { wrap = element; props.ref?.(element); }}
      onPointerEnter={handlers.onMouseEnter} onPointerLeave={handlers.onMouseLeave}
      onFocusIn={handlers.onFocusIn} onFocusOut={handlers.onFocusOut}
      onContextMenu={(press: MouseEvent) => {
        const app = props.app;

        if (app) openOnRelease(press, (x, y) => void contextMenu(app, [
          { id: "rename", label: copy.rename, shortcut: "F2", run: edit },
          { id: "close", label: copy.close, run: () => props.onClose() },
        ], x, y));
      }}>
      <Show when={editing() === null} fallback={<RenameField name={initialName} recovered={recovered} selection={restoredSelection} onEdit={capture} onDone={(saved, refocus) => {
        setEditing(null);

        if (refocus) button?.focus();

        if (saved !== null && base === undefined) {
          recover(true);

          return;
        }

        if (saved !== null) {
          const submitted = revision;

          if (submitted) drafts?.submit(submitted);
          void props.onRename(saved, base).then(outcome => {
            if (submitted) drafts?.settle(submitted, outcome.status);
          });
        }
      }} />}>
        <Tip ids={{ trigger: tabs().getTriggerProps({ value: props.tab.path }).id }} class="tab-tip" content={<>{props.tab.path}<Show when={mark()}><br />{tipOf(props.tab)}</Show><Show when={shown()}>{draft => <><br />{copy.draftIdentity(copy.unfinishedWork, String(draft().value.name ?? ""))}</>}</Show></>}>
          {(tooltip) =>
              <Tabs.Trigger {...tooltip({})} value={props.tab.path} class="tab-name-button"
                aria-description={records().length || problem() ? copy.unfinishedWork : undefined} data-selected={props.selected ? "true" : undefined} aria-busy={props.tab.busy} ref={(element) => (button = element)}
                onClick={(click) => {
                  if (click.target instanceof Element && click.target.closest('.tab-mark')) {
                    click.preventDefault();
                    props.onMark();
                  }
                }}>
                <span class="tab-name" onDblClick={edit}><span class="tab-head">{parts()[0]}</span><span class="tab-tail">{parts()[1]}</span></span>
                <Show when={mark()}>{(shown) => <span class="tab-mark ink" data-tone={MARKS[shown()].tone} data-kind={shown()} role="img" aria-label={MARKS[shown()].label} />}</Show>
              </Tabs.Trigger>
          }
        </Tip>
        <div class="tab-actions">
        <Show when={records().length || problem()}>
          <Tip text={copy.recoverDrafts}>{trigger => <IconButton {...trigger()} class="tab-recover" data-visible={near() || props.selected} tabIndex={props.selected ? 0 : -1} aria-label={copy.draftIdentity(copy.recoverDrafts, props.tab.path)} onClick={() => recover(true)}><Icon name="edit" /></IconButton>}</Tip>
        </Show>
        <IconButton class="tab-close" aria-label={copy.closeProject(props.tab.name)} data-visible={near() || props.closeFocus === true} onClick={() => props.onClose()}><Icon name="x" /></IconButton>
        </div>
      </Show>
    </FlatTab>
    <Dialog.Root open={recovering()} onOpenChange={details => recover(details.open)} finalFocusEl={() => button ?? null}>
      <Portal><Dialog.Positioner asChild={positioner => <aside {...positioner({})} />}><Dialog.Content class="draft-recovery header-recovery" ref={element => { panel = element; }}>
        <Dialog.Title asChild={title => <h2 {...title({})}>{copy.unfinishedWork}</h2>} />
        <Dialog.Description class="draft-identity">{problem() ? copy.projectName : props.tab.path}</Dialog.Description>
        <Show when={problem()}>{failure => <p role="alert">{copy.draftRetention(props.tab.path, copy.projectName, failure().cause)}</p>}</Show>
        <Show when={copyFailure()}>{failure => <p role="alert">{failure()}</p>}</Show>
        <For each={[...records()].reverse().sort((a, b) => Number(b.revision === current()?.revision) - Number(a.revision === current()?.revision))}>{(draft, index) => <Show when={records().length > 1} fallback={<span class="draft-status" role="status" aria-label={copy.draftStatus[draft.status]} data-state={draft.status}>{draft.revision === current()?.revision ? copy.currentDraft : copy.draftStatus[draft.status]}</span>}><button type="button" data-button="quiet" aria-pressed={shown()?.revision === draft.revision} onClick={() => inspect(draft.revision)}>{copy.draftIdentity(draft.revision === current()?.revision ? copy.currentDraft : copy.draftStatus[draft.status], String(index() + 1))}</button></Show>}</For>
        <Show when={shown()}>{draft => <>
          <Show when={draft().value.base !== props.tab.base}><p role="status">{copy.railDraftConflict}</p></Show>
          <pre class="draft-value">{String(draft().value.name ?? "")}</pre>
        </>}</Show>
        <div class="draft-actions">
        <Show when={shown()}>{draft => <><button type="button" data-button="quiet" onClick={() => void copyName()}>{copy.copyProjectName}</button>
          <Show when={draft().value.base !== undefined}><button type="button" data-button="quiet" onClick={() => void copyName(true)}>{originalSourceLabel}</button></Show>
          <button type="button" data-button="quiet" onClick={() => { drafts?.discard(draft().revision); setEditing(null); }}>{copy.discardRevision}</button>
        </>}</Show>
          <Show when={problem()}><button type="button" data-button="quiet" onClick={() => drafts?.retry()}>{copy.storageRetry}</button></Show>
        <Dialog.CloseTrigger data-button="quiet">{copy.close}</Dialog.CloseTrigger></div>
      </Dialog.Content></Dialog.Positioner></Portal>
    </Dialog.Root>
  </>}</Tabs.Context>;
};
