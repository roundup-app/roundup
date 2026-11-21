import { createEffect, createMemo, createSignal, For, lazy, Loading, onSettled, refresh, Show, untrack } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { failureOf } from "../app/failureOf";
import { BlockedFailure, StatusNote } from "../ink/MountedLine";
import { captureFocus, focusTarget, returnFocus } from "../keys/focus";
import { registerKeys } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { SegmentGroup } from "../ui/SegmentGroup";
import { isDoor } from "../state/doorNode";
import type { ChangeTarget } from "../state/changeTargets";
import { copy } from "./copy";
import { causeOf, createRemoteMain } from "./remote";
import { RemoteChip } from "./RemoteChip";
import { loadReader } from "./chunks";
import { notesFor } from "./notes";
import { createEditor } from "./editor";
import { createLate } from "./late";
import { ChangedTree, moduleKey, noiseKey } from "./ChangedTree";
import { groupModules } from "./modules";
import type { DiffKeys } from "./DiffReader";
import "./styles.css";

const ModuleScroll = lazy(() => loadReader().then(module => ({ default: module.ModuleScroll })));

/** U7674b: the shown listing's totals; a `null` count adds nothing. */
const totalsOf = (files: readonly ChangedFile[]) => files.reduce((sum, file) => ({ added: sum.added + (file.counts?.added ?? 0), removed: sum.removed + (file.counts?.removed ?? 0) }), { added: 0, removed: 0 });

/** U7675c: the file after `gone` in `before` that `list` still holds, else the nearest one before it. */
const neighbourOf = (before: readonly string[], list: readonly string[], gone: string) => {
  const at = before.indexOf(gone);

  return before.slice(at + 1).find(each => list.includes(each)) ?? before.slice(0, at).reverse().find(each => list.includes(each));
};

/** U7675c: the open file that leaves the listing: its name until the reader acts, and `leave` told its neighbour in tree order. */
const createLeaving = (watch: () => { list: string[]; key: string }, open: () => string | undefined, leave: (neighbour: string | undefined) => void) => {
  const [left, setLeft] = createSignal<string>();
  let before: string[] = [];
  let source = "";

  createEffect(watch, ({ list, key }) => {
    const chosen = untrack(open);
    const was = chosen !== undefined && before.includes(chosen) ? chosen : before[0];
    const gone = key === source && was !== undefined && !list.includes(was) ? was : undefined;

    if (gone !== undefined) {
      setLeft(gone);
      leave(neighbourOf(before, list, gone));
    } else if (key !== source) setLeft(undefined);

    source = key;
    before = list;
  });

  return [left, setLeft] as const;
};

type KeyActions = { step: (direction: 1 | -1) => void; diff: () => DiffKeys | undefined; toggleHelp: () => void };

const registerChangesKeys = (section: () => HTMLElement | undefined, actions: KeyActions) => registerKeys({ kind: "region", element: section }, [
  { chords: ["j"], when: event => !typing(event), run: event => { event.preventDefault(); actions.step(1); } },
  { chords: ["k"], when: event => !typing(event), run: event => { event.preventDefault(); actions.step(-1); } },
  { chords: ["]"], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.step(1); } },
  { chords: ["["], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.step(-1); } },
  { chords: ["v"], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.reveal(); } },
  { chords: ["n"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.note(); } },
  { chords: ["e"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.edit(); } },
  { chords: ["Delete", "Backspace"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.remove(); } },
  { chords: ["?", "Shift+?"], when: event => !typing(event), run: event => { event.preventDefault(); actions.toggleHelp(); } },
  { chords: ["Tab"], when: event => event.target instanceof Element && event.target.closest(".changes-tree") !== null, run: event => { event.preventDefault(); actions.diff()?.focus(); } },
]);

/** A repository's name in the Project: its folder relative to the Project's root, else its own folder name; never an absolute path. */
const nameOf = (repo: string, root: string) => repo.startsWith(`${root}/`) ? repo.slice(root.length + 1) : repo.split("/").filter(Boolean).at(-1) ?? repo;

/** U7676b: N, E and Delete act on the focused diff, never while a field or the editor holds the key. */
const inDiff = (event: KeyboardEvent) => !typing(event) && event.target instanceof Element && event.target.closest(".diff-reader") !== null;

const typing = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]:not([contenteditable=false])") !== null;

/** U7186c, U7672c: the centre's diff of what one Agent owns, from the remote's main to the switch's value. */
const Surface = (props: { id: string; name: string }) => {
  const { app, rail, owned, hideView, showView, project, drafts, changeTargets, changePlaces } = useConnectedProject();
  const notes = notesFor(app, project.path, drafts);

  // Read live, not through the keyed Agent: losing or regaining the Worktree must not remount the view and its open note form.
  const worktree = () => {
    const node = rail.nodes.find(candidate => candidate.id === props.id);

    return node && isDoor(node) ? node.worktree?.path ?? null : null;
  };

  const groups = () => {
    const read = owned.read(props.id);

    return read?.failure === null ? read.groups : [];
  };

  const [active, setActive] = createSignal(0);
  const group = () => groups()[active()] ?? groups()[0];

  // U7672d: a remembered Tree or Branch for an Agent without a Worktree of its own falls back to Changes.
  const target = (): ChangeTarget => {
    const chosen = changeTargets.read(props.id);

    return chosen !== "changes" && worktree() === null ? "changes" : chosen;
  };

  const own = (): "tree" | "branch" | null => {
    const chosen = target();

    return chosen === "changes" ? null : chosen;
  };

  // U7675d, U7675f: the open file and each file's place outlive the view for the connection's session.
  const memory = changePlaces.of(untrack(() => props.id));
  const [picked, setPicked] = createSignal<string | undefined>(memory.open);
  const [start, setStart] = createSignal<string>();

  const places = {
    get: (file: string) => memory.places.get(file),
    set: (file: string, place: NonNullable<ReturnType<typeof memory.places.get>>) => { memory.places.set(file, place); },
  };

  const [listed] = createSignal<{ failure: string | null; files: ChangedFile[] } | undefined>(async () => {
    const to = own();

    if (!to) return undefined;
    let files: ChangedFile[] = [];
    const failure = await failureOf(async () => { files = (await app.rpc("agent.changedFiles", { id: props.id, to })).files; });

    return { failure, files };
  }, { loadingValue: undefined });

  const files = (): readonly ChangedFile[] => own() ? listed()?.files ?? [] : group()?.files ?? [];

  const grouped = createMemo(() => groupModules(files()));

  // U7678a: the rows that open something, in list order: each module, then each noise file.
  const rows = () => [...grouped().modules.map(module => moduleKey(module.name)), ...grouped().noise.flatMap(noise => noise.files.map(file => noiseKey(file.path)))];

  // U7674a, U7678d: what shows is the chosen module or noise file still listed, else the first module.
  const opened = () => {
    const chosen = picked();

    return chosen !== undefined && rows().includes(chosen) ? chosen : rows()[0];
  };

  // A module of another comparison is another scroll, though it keeps its name.
  const view = createMemo(() => {
    const key = opened();

    return key === undefined ? undefined : { key, source: `${target()}|${active()}` };
  }, { equals: (a, b) => a?.key === b?.key && a?.source === b?.source });

  // U7674e: the module that was open stays until the next one's first screen has painted.
  const [panes, setPanes] = createSignal<NonNullable<ReturnType<typeof view>>[]>([]);

  createEffect(view, next => { if (next) setPanes(list => list.includes(next) ? list : [...list, next]); });

  const ready = (pane: NonNullable<ReturnType<typeof view>>) => setPanes(list => list.includes(pane) && list.at(-1) !== list[0] ? list.slice(list.indexOf(pane)) : list);

  const openFiles = (key: string): readonly ChangedFile[] => key.startsWith("m:") ? grouped().modules.find(module => moduleKey(module.name) === key)?.files ?? [] : files().filter(file => noiseKey(file.path) === key);

  const scroll = (key: string) => ({
    get: () => memory.places.get(key)?.scroll,
    set: (top: number) => { memory.places.set(key, { revision: "", scroll: top, selection: { side: "new", start: 1, end: 1 } }); },
  });

  createEffect(opened, file => { memory.open = file; });

  // U7675a: the comparison's own answer, whichever read made it.
  const pending = () => own() ? listed() === undefined : owned.read(props.id) === undefined;
  const failure = () => own() ? listed()?.failure ?? null : owned.read(props.id)?.failure ?? null;
  const late = createLate(pending);

  // The Daemon names a Worktree whose folder is gone with `worktree_missing` (code NOT_FOUND); any other failure keeps its own cause.
  const missing = () => (failure() ?? "").startsWith("worktree_missing");
  const [checked, setChecked] = createSignal(false);
  let asked = false;

  createEffect(() => own() ? listed() : owned.read(props.id), () => {
    if (asked) setChecked(true);
    asked = false;
  });

  const retry = () => {
    asked = true;

    if (own()) refresh(listed); else void owned.refresh(props.id);
  };

  // U7693c: only the Fetch click lists again and reads the open file again, once, after the list answers.
  let diffKeys: DiffKeys | undefined;

  const remote = createRemoteMain(app, untrack(() => props.id), () => !pending(), () => {
    void (own() ? refresh(listed) : owned.refresh(props.id)).then(() => diffKeys?.reload());
  });

  const toLabel = () => target() === "tree" ? copy.targetTree : target() === "branch" ? copy.targetBranch : copy.changes;

  const empty = () => !pending() && failure() === null && files().length === 0;

  // U7675c: the open file that leaves says so, and focus moves to its neighbour in tree order, else to the view.
  let section: HTMLElement | undefined;
  let focusTree = (_path: string) => {};

  const [left, setLeft] = createLeaving(() => ({ list: rows(), key: `${target()}|${active()}` }), opened, neighbour => {
    setPicked(neighbour);
    setStart(undefined);

    if (neighbour) focusTree(neighbour); else section?.focus();
  });

  const choosePath = (key: string, file?: string) => {
    if (key !== untrack(opened)) setLeft(undefined);
    setPicked(key);
    setStart(file);
  };

  const totals = () => totalsOf(files());

  // U2539d: a file that still exists opens in the editor at its line, from the checkout the comparison ends on; a failed open shows as one card.
  const root = () => own() ? worktree() ?? undefined : group()?.repo;

  const { editable, edit } = createEditor(app, root);

  // U7675e: J and K step files from anywhere, ] and [ step changes, Tab crosses from the list to the diff, ? lists them.
  const [help, setHelp] = createSignal(false);

  const step = (direction: 1 | -1) => {
    const order = grouped().modules.map(module => moduleKey(module.name));
    const at = order.indexOf(opened() ?? "");
    const next = at === -1 ? direction === -1 ? order.at(-1) : undefined : order[at + direction];

    if (next === undefined) return;
    choosePath(next);
    focusTree(next);
  };

  registerChangesKeys(() => section, { step, diff: () => diffKeys, toggleHelp: () => setHelp(on => !on) });

  // U7675f: closing returns focus to the Rail icon.
  const iconId = untrack(() => props.id);

  const close = () => {
    hideView("changes");
    returnFocus(focusTarget(`changes.icon.${iconId}`) ?? null);
  };

  const choose = (value: ChangeTarget) => {
    changeTargets.choose(props.id, value);
    setPicked(undefined);
  };

  const segments = (): { value: ChangeTarget; label: string }[] => [
    ...worktree() === null ? [] : [{ value: "tree" as const, label: copy.targetTree }, { value: "branch" as const, label: copy.targetBranch }],
    { value: "changes", label: copy.changes },
  ];

  const editChosen = (chosen: string) => {
    const file = files().find(each => each.path === chosen);

    if (file && editable(file)) edit(file);
  };

  // Escape closes the keys list first, else the view unless a note field holds it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;

    if (typing(event)) return;

    if (help()) {
      setHelp(false);

      return;
    }

    close();
  };

  // Opening moves focus into the view, so Escape reaches its handler before any file does; the tree takes it when it draws.
  const initialFocus = captureFocus();

  onSettled(() => { initialFocus(() => section?.focus()); });

  return <section class="changes-view" aria-label={copy.changes} tabindex="-1" onKeyDown={onKeyDown} ref={element => { section = element; }}>
    <header class="changes-head">
      <span class="changes-name">{props.name}</span>
      <span class="changes-from"><span>{copy.compareFrom}</span> {copy.remoteMain}</span>
      <Show when={remote.chip()}>{chip => <RemoteChip chip={chip()} fetch={remote.fetch} retry={remote.retry} />}</Show>
      <Show when={segments().length > 1} fallback={<span class="changes-to"><span>{copy.compareTo}</span> <span class="changes-to-value">{copy.changes}</span></span>}>
        <SegmentGroup label={copy.compareTo} segments={segments()} value={target()} onValueChange={choose} />
      </Show>
      <span class="changes-totals">{copy.changedFiles(files().length)} {copy.addedLines(totals().added)} {copy.removedLines(totals().removed)}</span>
      <button type="button" data-button="quiet" onClick={close}>{copy.closeChanges}</button>
    </header>
    <Show when={remote.chip()}>{chip => <Show when={causeOf(chip()) !== ""}><p class="changes-remote-cause">{causeOf(chip())}</p></Show>}</Show>
    <Show when={failure() !== null}>
      <BlockedFailure message={missing() ? copy.folderGone(props.name) : `${copy.compareFailed(copy.remoteMain, toLabel())}: ${failure()}`} recover={{ run: retry }} />
      <StatusNote text={missing() && checked() ? copy.stillMissing : null} />
    </Show>
    <StatusNote text={pending() && late() ? copy.comparing : empty() ? own() === "tree" ? copy.folderMatches(props.name, copy.remoteMain) : copy.noChangesAgainst(copy.remoteMain) : null} />
    <Show when={left()}>{gone => <StatusNote text={copy.fileGone(gone().slice(2), copy.remoteMain)} />}</Show>
    <Show when={help()}>
      <section class="changes-keys" aria-label={copy.keys}>
        <ul>
          <For each={copy.keysList}>{what => <li>{what}</li>}</For>
        </ul>
      </section>
    </Show>
    <div class="changes-body">
      <div class="changes-side">
        <Show when={groups().length > 1 && !own()}>
          <ul class="changes-groups" aria-label={copy.changeGroups}>
            <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPicked(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
          </ul>
        </Show>
        <Show when={files().length > 0}>
          <ChangedTree grouped={grouped()} unfinished={new Set(notes.unfinished(props.id).map(form => form.comparison.newPath))} selected={opened()} controls={controls => { focusTree = controls.focus; }} onChoose={choosePath} onEdit={editChosen} />
        </Show>
      </div>
      <For each={panes()}>{pane => <div class="module-slot" data-pending={panes().length > 1 && panes().at(-1) === pane ? "true" : "false"}>
        <Loading><ModuleScroll id={props.id} name={props.name} files={openFiles(pane.key)} start={start()} scroll={scroll(pane.key)} places={places} keys={api => { if (panes().at(-1) === pane) diffKeys = api; }} onReady={() => ready(pane)} to={own() ?? "tree"} notes={notes} recover={() => showView("notes")} /></Loading>
      </div>}</For>
    </div>
  </section>;
};

/** U7186c: mounted over the centre while the Changes view is open for the selected Agent. */
export const ChangesView = () => {
  const { rail, hasView } = useConnectedProject();

  const agent = createMemo(() => {
    const node = rail.nodes.find(candidate => candidate.id === rail.selected());

    return node?.kind === "agent" ? { id: node.id, name: node.name } : null;
  }, { equals: (a, b) => a?.id === b?.id && a?.name === b?.name });

  return <Show when={hasView("changes") ? agent() : null} keyed>{each => <Loading><Surface id={each.id} name={each.name} /></Loading>}</Show>;
};
