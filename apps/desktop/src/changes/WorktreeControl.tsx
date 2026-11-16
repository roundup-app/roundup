import { isDoor } from "../state/doorNode";
import { LEADER } from "../keys/chords";
import { registerKeys } from "../keys/registry";
import { captureFocus, queueFocus } from "../keys/focus";
import { createCutTitle } from "../ui/cutTitle";
import { createEffect, createMemo, createSignal, lazy, Loading, onCleanup, Show, untrack, type Accessor } from "solid-js";
import type { ChangedFiles } from "@contracts/agent/ChangedFiles";
import type { Worktree } from "@contracts/agent/Worktree";
import { copy } from "./copy";
import { ReservedLine } from "../ink/ReservedLine";
import { Icon } from "../ink/Icon";
import { failureOf } from "../app/failureOf";
import { useConnectedProject } from "../state/connectedProject";
import { Popover } from "../ui/Popover";
import { notesFor } from "./notes";
import type { Notes, Note } from "./notes";
import { NoteBatch, NoteRecovery } from "./NoteBatch";
import { loadReader, loadTree } from "./chunks";
import "./styles.css";

const DiffReader = lazy(() => loadReader().then(module => ({ default: module.DiffReader })));

const ChangedTree = lazy(() => loadTree().then(module => ({ default: module.ChangedTree })));

type Read = { failure: null; changed: ChangedFiles } | { failure: string; changed?: ChangedFiles } | null;

/** A re-read is the same while every file keeps its path, status, line and old path. */
const sameChanged = (a: ChangedFiles | undefined, b: ChangedFiles | undefined): boolean => a === b || (a !== undefined && b !== undefined && a.files.length === b.files.length && a.files.every((file, index) => {
  const other = b.files[index];

  return other !== undefined && file.path === other.path && file.status === other.status && file.line === other.line && file.from === other.from;
}));

/** U2539b: the panel of one Agent's Worktree. It reads again on every open and closes when the selection moves, because it is keyed on the Agent. */
const Panel = (props: { id: string; name: string; worktree: Worktree; notes: Notes; recoveryOpen: boolean; onOpen: () => void; returnFocus?: (() => void) | undefined; recover: () => void }) => {
  const { app, worktrees, rail, daemonExit } = useConnectedProject();
  const state = () => worktrees.read(props.id);

  const facts = () => {
    const read = state();

    return read?.failure === null ? read.state : null;
  };

  let treeFocus = captureFocus();
  const [open, setOpen] = createSignal(false);
  const [read, setRead] = createSignal<Read>(null);
  const [version, setVersion] = createSignal(0);
  const [dismissedState, setDismissedState] = createSignal<ReturnType<typeof state>>();
  const [dismissedRead, setDismissedRead] = createSignal<Read>();

  const failure = () => {
    const shared = state();
    const local = read();

    return (shared !== dismissedState() ? shared?.failure : null) ?? (local !== dismissedRead() ? local?.failure : null);
  };

  const dismiss = () => {
    const shared = state();

    if (shared?.failure && shared !== dismissedState()) setDismissedState(shared);
    else setDismissedRead(read());
  };

  const [path, setPath] = createSignal<string>();
  const [editing, setEditing] = createSignal<Note>();
  const [diff, setDiff] = createSignal(false);

  const close = () => { setOpen(false); setDiff(false); setEditing(undefined); };

  let generation = 0;

  const refresh = async () => {
    if (open() && document.activeElement?.closest(".worktree-tree")) treeFocus = captureFocus();
    const request = ++generation;
    let changed: ChangedFiles | undefined;
    const failure = await failureOf(async () => { changed = await app.rpc("agent.changedFiles", { id: props.id }); });

    if (request !== generation) return failure;
    setRead(previous => {
      if (failure === null && changed) return { failure: null, changed };
      const failed: Read = { failure: failure! };

      if (previous?.changed) failed.changed = previous.changed;

      return failed;
    });

    if (changed?.files.length === 0 && open()) {
      close();
      queueFocus(() => props.returnFocus?.());
    }

    return failure;
  };

  onCleanup(() => { generation++; });
  // rc.21 runs an effect's apply on every recompute; the memo lets only a new state or version reload.
  const reload = createMemo(() => [state(), version()] as const, { equals: (a, b) => a[0] === b[0] && a[1] === b[1] });
  createEffect(reload, () => { void refresh(); });


  const node = () => {
    const found = rail.nodes.find(node => node.id === props.id);

    return found && isDoor(found) ? found : undefined;
  };

  createEffect(() => node()?.status_revision, (next, before) => {
    const kind = node()?.status?.kind;

    if (before !== undefined && next !== before && (kind === "done" || kind === "error" || kind === "idle")) void refresh();
  });
  // A re-read that returns the same files keeps the mounted tree, so its selection and focus survive (U3787c).
  const sameFiles = createMemo(() => read()?.changed, { equals: sameChanged });
  const count = () => read()?.changed?.files.length ?? 0;

  const branchCut = createCutTitle(() => props.worktree.branch);
  const baseCut = createCutTitle(() => props.worktree.base);

  let viewButton: HTMLButtonElement | undefined;

  // The Panel is made per Worktree (a keyed Show), so what it was made for is read once.
  const { id, worktree, title } = untrack(() => ({ id: props.id, worktree: { ...props.worktree }, title: `${copy.reviewChanges} · ${props.name}: ` }));

  const originalAvailable = () => {
    const found = rail.nodes.find(node => node.id === id);
    const current = found && isDoor(found) ? found.worktree : undefined;

    return !daemonExit() && current?.path === worktree.path && current?.branch === worktree.branch && current?.base === worktree.base;
  };

  // Keep the request's result outside the panel's render lifetime, using the existing Project failure holder.
  const review = async (shared = Boolean(state())) => {
    if (!originalAvailable()) {
      rail.commandFailure.show(`${title}${copy.worktreeReadUnavailable}`, null, "rail", () => { void review(shared); });

      return;
    }

    const failure = shared ? (await worktrees.refresh(id)).failure : await refresh();

    if (failure) rail.commandFailure.show(`${title}${failure}`, null, "rail", () => { void review(shared); });
    else if (rail.commandFailure.message()?.startsWith(title)) rail.commandFailure.clear();
  };

  createEffect(() => state()?.failure, (next, before) => {
    if (next === null && Boolean(before) && untrack(() => rail.commandFailure.message())?.startsWith(title)) rail.commandFailure.clear();
  }, { defer: true });

  const openPanel = () => {
    // The reader and the tree are separate chunks (startup budget); opening the panel fetches them ahead of use.
    void loadReader();
    void loadTree();
    treeFocus = captureFocus(true);
    props.onOpen();
    setOpen(true);
    void review();
  };

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.changes"], capture: () => ({ available: () => count() > 0 && rail.selected() === id && originalAvailable(), invoke: openPanel }) }]);

  createEffect(createMemo(() => props.recoveryOpen), open => { if (open) close(); });

  return (
    <Popover.Root initialFocus={treeFocus} closeOnInteractOutside={false} open={open()} onOpenChange={({ open: next }) => { if (next) openPanel(); else close(); }}>
      <Show when={count() > 0}><Popover.Trigger render={(trigger) => (
        <button {...trigger} type="button" data-button="quiet" class="worktree-control" aria-label={copy.changedFiles(count())} data-stale={read()?.failure ? "true" : undefined} onClick={() => (open() ? close() : openPanel())}>
          <Icon name="branch" />
          <span>{count()}</span>
        </button>
      )} /></Show>
      <ReservedLine message={failure()} status={failure() && count() > 0 ? copy.changesStale : null} dismiss={dismiss} action={<button type="button" data-button="quiet" onClick={() => setVersion(value => value + 1)}>{copy.retry}</button>} />
      <Show when={count() > 0}>
        <Popover.Content side="top" align="end" class="worktree-panel" data-diff={diff() ? "true" : undefined} aria-label={copy.worktree} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
          <Show when={!diff()}><div class="diff-actions"><button type="button" data-button="quiet" onClick={close}>{copy.close}</button></div></Show>
          <Show when={!diff()} fallback={<Loading><DiffReader id={props.id} name={props.name} path={path()!} notes={props.notes} editing={editing()} onEdited={() => setEditing(undefined)} onBack={() => { treeFocus = captureFocus(true); setEditing(undefined); setDiff(false); }} onClose={close} recover={props.recover} /></Loading>}>
          <dl class="worktree-facts">
            <dt>{copy.branch}</dt>
            <dd {...branchCut.attrs()} style={{ width: "fit-content", "max-width": "100%" }}>{props.worktree.branch}</dd>
            <dt>{copy.base}</dt>
            <dd {...baseCut.attrs()} style={{ width: "fit-content", "max-width": "100%" }}>{props.worktree.base}</dd>
            <Show when={facts()}>
              {(state) => (
                <>
                  <dt>{copy.worktreeState}</dt>
                  <dd>{copy.worktreeStateText(state().ahead, state().behind, state().dirty)}</dd>
                  <dt>{copy.worktreeCi}</dt>
                  <dd><Show when={state().ci} fallback={copy.worktreeCiUnavailable}>{(ci) => <>{copy.worktreeCiText(ci().state, ci().stale)}</>}</Show></dd>
                  <dt>{copy.worktreePr}</dt>
                  <dd><Show when={state().pr} fallback={copy.worktreePrUnavailable}>{(pr) => <>{copy.worktreePrText(pr().number, pr().stale)}</>}</Show></dd>
                </>
              )}
            </Show>
          </dl>
          <Show when={sameFiles()} keyed>
            {(value) => {
              if (value.files.length === 0) return null;

              return <><Loading><ChangedTree initialFocus={treeFocus} root={props.worktree.path} files={value.files} selected={path()} onSelect={setPath} /></Loading><button type="button" data-button="quiet" ref={element => { viewButton = element; }} disabled={!path()} onClick={() => setDiff(true)}>{copy.viewDiff}</button></>;
            }}
          </Show>
        <NoteBatch fallback={() => viewButton?.focus()} recover={props.recover} id={props.id} name={props.name} notes={props.notes} edit={note => { setPath(note.comparison.newPath); setEditing(note); setDiff(true); }} />
          </Show>
        </Popover.Content>
      </Show>
    </Popover.Root>
  );
};

/** U2539b: the bottom bar's one control for the selected Agent's Worktree; none for an Agent without one. */
export const WorktreeControl = (props: { compact?: boolean | undefined; returnFocus?: (() => void) | undefined }) => {
  const { rail, app, project, drafts, hasView, hideView, showView } = useConnectedProject();
  const notes = notesFor(app, project.path, drafts);
  const names = new Map<string, string>();

  createEffect(() => rail.nodes.map(node => [node.id, node.name] as const), entries => { for (const [id, name] of entries) names.set(id, name); });

  const recoveryOpen = () => hasView("notes");
  const setRecoveryOpen = (open: boolean) => { if (open) showView("notes"); else hideView("notes"); };

  const selected: Accessor<{ id: string; name: string; worktree: Worktree } | null> = createMemo(
    () => {
      const node = rail.nodes.find((candidate) => candidate.id === rail.selected());

      return node && isDoor(node) && node.worktree ? { id: node.id, name: node.name, worktree: node.worktree } : null;
    },
    { equals: (a, b) => a?.id === b?.id && a?.worktree.branch === b?.worktree.branch && a?.worktree.path === b?.worktree.path && a?.worktree.base === b?.worktree.base },
  );

  return <><Show when={selected()} keyed>{(each) => <Panel returnFocus={props.returnFocus} recover={() => setRecoveryOpen(true)} id={each.id} name={each.name} worktree={each.worktree} notes={notes} recoveryOpen={recoveryOpen()} onOpen={() => setRecoveryOpen(false)} />}</Show><NoteRecovery compact={props.compact} name={id => rail.nodes.find(node => node.id === id)?.name ?? names.get(id) ?? copy.unavailableAgent} notes={notes} open={recoveryOpen()} onOpenChange={setRecoveryOpen} available={id => rail.nodes.some(node => node.id === id && isDoor(node) && node.worktree !== null)} /></>;
};
