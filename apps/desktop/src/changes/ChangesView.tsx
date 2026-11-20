import { createEffect, createMemo, createSignal, For, lazy, Loading, refresh, Show, untrack } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { failureOf } from "../app/failureOf";
import { BlockedFailure, StatusNote } from "../ink/MountedLine";
import { focusTarget } from "../keys/focus";
import { registerKeys } from "../keys/registry";
import { createMessageToasts } from "../ink/messageToast";
import { useConnectedProject } from "../state/connectedProject";
import { SegmentGroup } from "../ui/SegmentGroup";
import { isDoor } from "../state/doorNode";
import type { ChangeTarget } from "../state/changeTargets";
import { copy } from "./copy";
import { loadReader } from "./chunks";
import { notesFor } from "./notes";
import { changedPath } from "./paths";
import { ChangedTree, firstInTree, treeOrder } from "./ChangedTree";
import { rememberedFor } from "./lines";
import type { DiffKeys } from "./DiffReader";
import "./styles.css";

const DiffReader = lazy(() => loadReader().then(module => ({ default: module.DiffReader })));

/** A repository's name in the Project: its folder relative to the Project's root, else its own folder name; never an absolute path. */
const nameOf = (repo: string, root: string) => repo.startsWith(`${root}/`) ? repo.slice(root.length + 1) : repo.split("/").filter(Boolean).at(-1) ?? repo;

/** U7186c, U7672c: the centre's diff of what one Agent owns, from the remote's main to the switch's value. */
const Surface = (props: { id: string; name: string }) => {
  const { app, rail, owned, hideView, showView, project, drafts, changeTargets } = useConnectedProject();
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
    const value = target();

    return value === "changes" ? null : value;
  };

  // U7675d, U7675f: the open file and each file's place outlive the view for the App's run.
  const memory = rememberedFor(`${project.path}\0${props.id}`);
  const [path, setPath] = createSignal<string | undefined>(memory.open);

  const places = {
    get: (file: string) => memory.places.get(file),
    set: (file: string, place: NonNullable<ReturnType<typeof memory.places.get>>) => { memory.places.set(file, place); },
    forget: (file: string) => { memory.places.delete(file); },
  };

  const [listed] = createSignal<{ failure: string | null; files: ChangedFile[] } | undefined>(async () => {
    const to = own();

    if (!to) return undefined;
    let files: ChangedFile[] = [];
    const failure = await failureOf(async () => { files = (await app.rpc("agent.changedFiles", { id: props.id, to })).files; });

    return { failure, files };
  }, { loadingValue: undefined });

  const files = (): readonly ChangedFile[] => own() ? listed()?.files ?? [] : group()?.files ?? [];

  // U7674a: the file shown is the chosen one still listed, else the first in tree order.
  const opened = () => files().find(file => file.path === path())?.path ?? firstInTree(files());

  createEffect(opened, file => { memory.open = file; });

  // U7675a: the comparison's own answer, whichever read made it.
  const pending = () => own() ? listed() === undefined : owned.read(props.id) === undefined;
  const failure = () => own() ? listed()?.failure ?? null : owned.read(props.id)?.failure ?? null;
  const [late, setLate] = createSignal(false);

  createEffect(pending, waiting => {
    setLate(false);

    if (!waiting) return undefined;
    const timer = setTimeout(() => setLate(true), 150);

    return () => clearTimeout(timer);
  });

  const missing = () => /no longer exists|no such file or directory|does not exist/i.test(failure() ?? "");
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

  const toLabel = () => target() === "tree" ? copy.targetTree : target() === "branch" ? copy.targetBranch : copy.changes;

  const empty = () => !pending() && failure() === null && files().length === 0;

  // U7675c: the open file that leaves says so, and focus moves to its neighbour in tree order.
  const [left, setLeft] = createSignal<string>();
  let before: string[] = [];
  let lastOpen: string | undefined;
  let source = "";
  let focusTree = (_path: string) => {};

  createEffect(() => ({ list: treeOrder(files()), key: `${target()}|${active()}` }), ({ list, key }) => {
    const gone = key === source && lastOpen !== undefined && before.includes(lastOpen) && !list.includes(lastOpen) ? lastOpen : undefined;
    let neighbour: string | undefined;

    if (gone !== undefined) {
      const at = before.indexOf(gone);

      neighbour = before.slice(at + 1).find(each => list.includes(each)) ?? before.slice(0, at).reverse().find(each => list.includes(each));
      setLeft(gone);
      setPath(neighbour);

      if (neighbour) focusTree(neighbour);
    } else if (key !== source) setLeft(undefined);

    source = key;
    before = list;
    lastOpen = gone === undefined ? untrack(opened) : neighbour;
  });

  const choosePath = (file: string) => {
    if (file !== untrack(opened)) setLeft(undefined);
    setPath(file);
  };

  // U7674b: the shown listing's totals; a `null` count adds nothing.
  const totals = () => files().reduce((sum, file) => ({ added: sum.added + (file.counts?.added ?? 0), removed: sum.removed + (file.counts?.removed ?? 0) }), { added: 0, removed: 0 });

  // U2539d: a file that still exists opens in the editor at its line, from the checkout the comparison ends on; a failed open shows as one card.
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());

  const clear = (key: string) => setFailures(previous => {
    const next = new Map(previous);

    next.delete(key);

    return next;
  });

  const root = () => own() ? worktree() ?? undefined : group()?.repo;

  const editable = (file: ChangedFile) => file.status !== "deleted" && root() !== undefined;

  const edit = (file: ChangedFile) => {
    const target = changedPath(root() ?? "", file);

    void failureOf(() => app.openInEditor(target, file.line ?? undefined)).then(error => {
      if (error) setFailures(previous => new Map(previous).set(file.path, error));
      else clear(file.path);
    });
  };

  createMessageToasts(() => [...failures().keys()], key => ({
    get message() {
      const error = failures().get(key);

      return error === undefined ? null : `${key.split("/").pop()}: ${error}`;
    },
    dismiss: () => clear(key),
  }));

  // U7675e: J and K step files from anywhere, ] and [ step changes, Tab crosses from the list to the diff, ? lists them.
  const [help, setHelp] = createSignal(false);
  let diffKeys: DiffKeys | undefined;
  let section: HTMLElement | undefined;

  const step = (direction: 1 | -1) => {
    const order = treeOrder(files());
    const at = order.indexOf(opened() ?? "");
    const next = order[at + direction];

    if (next === undefined) return;
    choosePath(next);
    focusTree(next);
  };

  const typing = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]:not([contenteditable=false])") !== null;

  registerKeys({ kind: "region", element: () => section }, [
    { chords: ["j"], when: event => !typing(event), run: event => { event.preventDefault(); step(1); } },
    { chords: ["k"], when: event => !typing(event), run: event => { event.preventDefault(); step(-1); } },
    { chords: ["]"], when: event => !typing(event), run: event => { event.preventDefault(); diffKeys?.step(1); } },
    { chords: ["["], when: event => !typing(event), run: event => { event.preventDefault(); diffKeys?.step(-1); } },
    { chords: ["?", "Shift+?"], when: event => !typing(event), run: event => { event.preventDefault(); setHelp(on => !on); } },
    { chords: ["Tab"], when: event => event.target instanceof Element && event.target.closest(".changes-tree") !== null, run: event => { event.preventDefault(); diffKeys?.focus(); } },
  ]);

  // U7675f: closing returns focus to the Rail icon.
  const iconId = untrack(() => props.id);

  const close = () => {
    hideView("changes");
    queueMicrotask(() => focusTarget(`changes.icon.${iconId}`)?.focus());
  };

  const choose = (value: ChangeTarget) => {
    changeTargets.choose(props.id, value);
    setPath(undefined);
  };

  const segments = (): { value: ChangeTarget; label: string }[] => [
    ...worktree() === null ? [] : [{ value: "tree" as const, label: copy.targetTree }, { value: "branch" as const, label: copy.targetBranch }],
    { value: "changes", label: copy.changes },
  ];

  // Escape closes the keys list first, else the view unless a note field holds it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;

    if (typing(event)) return;

    if (help()) { setHelp(false);

 return; }

    close();
  };

  return <section class="changes-view" aria-label={copy.changes} onKeyDown={onKeyDown} ref={element => { section = element; }}>
    <header class="changes-head">
      <span class="changes-name">{props.name}</span>
      <span class="changes-from"><span>{copy.compareFrom}</span> {copy.remoteMain}</span>
      <Show when={segments().length > 1} fallback={<span class="changes-to"><span>{copy.compareTo}</span> <span class="changes-to-value">{copy.changes}</span></span>}>
        <SegmentGroup label={copy.compareTo} segments={segments()} value={target()} onValueChange={choose} />
      </Show>
      <span class="changes-totals">{copy.changedFiles(files().length)} {copy.addedLines(totals().added)} {copy.removedLines(totals().removed)}</span>
      <button type="button" data-button="quiet" onClick={close}>{copy.closeChanges}</button>
    </header>
    <Show when={failure() !== null}>
      <BlockedFailure message={missing() ? copy.folderGone(props.name) : `${copy.compareFailed(copy.remoteMain, toLabel())}: ${failure()}`} recover={{ run: retry }} />
      <StatusNote text={missing() && checked() ? copy.stillMissing : null} />
    </Show>
    <StatusNote text={pending() && late() ? copy.comparing : empty() ? own() === "tree" ? copy.folderMatches(props.name, copy.remoteMain) : copy.noChangesAgainst(copy.remoteMain) : null} />
    <Show when={left()}>{file => <StatusNote text={copy.fileGone(file(), copy.remoteMain)} />}</Show>
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
            <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPath(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
          </ul>
        </Show>
        <Show when={files().length > 0}>
          <ChangedTree files={files()} selected={opened()} controls={controls => { focusTree = controls.focus; }} onChoose={choosePath} onEdit={chosen => { const file = files().find(each => each.path === chosen);

 if (file && editable(file)) edit(file); }} />
        </Show>
      </div>
      <Show when={opened()}>
        {chosen => <Loading><DiffReader id={props.id} name={props.name} path={chosen()} blob={files().find(file => file.path === chosen())?.blob} places={places} keys={api => { diffKeys = api; }} to={own() ?? "tree"} notes={notes} onEdited={() => {}} recover={() => showView("notes")} /></Loading>}
      </Show>
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
