import { createMemo, createSignal, For, lazy, Loading, refresh, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { failureOf } from "../app/failureOf";
import { BlockedFailure } from "../ink/MountedLine";
import { createMessageToasts } from "../ink/messageToast";
import { useConnectedProject } from "../state/connectedProject";
import { SegmentGroup } from "../ui/SegmentGroup";
import { isDoor } from "../state/doorNode";
import type { ChangeTarget } from "../state/changeTargets";
import { copy } from "./copy";
import { loadReader } from "./chunks";
import { notesFor } from "./notes";
import { changedPath } from "./paths";
import { ChangedTree, firstInTree } from "./ChangedTree";
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

  const [path, setPath] = createSignal<string>();

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

  const choose = (value: ChangeTarget) => {
    changeTargets.choose(props.id, value);
    setPath(undefined);
  };

  const segments = (): { value: ChangeTarget; label: string }[] => [
    ...worktree() === null ? [] : [{ value: "tree" as const, label: copy.targetTree }, { value: "branch" as const, label: copy.targetBranch }],
    { value: "changes", label: copy.changes },
  ];

  // Escape closes the view unless a note field holds it.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;

    if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]:not([contenteditable=false])")) return;
    hideView("changes");
  };

  return <section class="changes-view" aria-label={copy.changes} onKeyDown={onKeyDown}>
    <header class="changes-head">
      <span class="changes-name">{props.name}</span>
      <span class="changes-from"><span>{copy.compareFrom}</span> {copy.remoteMain}</span>
      <Show when={segments().length > 1} fallback={<span class="changes-to"><span>{copy.compareTo}</span> <span class="changes-to-value">{copy.changes}</span></span>}>
        <SegmentGroup label={copy.compareTo} segments={segments()} value={target()} onValueChange={choose} />
      </Show>
      <span class="changes-totals">{copy.changedFiles(files().length)} {copy.addedLines(totals().added)} {copy.removedLines(totals().removed)}</span>
      <button type="button" data-button="quiet" onClick={() => hideView("changes")}>{copy.closeChanges}</button>
    </header>
    <BlockedFailure message={own() ? listed()?.failure : null} recover={{ run: () => refresh(listed) }} />
    <div class="changes-body">
      <div class="changes-side">
        <Show when={groups().length > 1 && !own()}>
          <ul class="changes-groups" aria-label={copy.changeGroups}>
            <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPath(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
          </ul>
        </Show>
        <Show when={files().length > 0}>
          <ChangedTree files={files()} selected={opened()} onChoose={setPath} onEdit={chosen => { const file = files().find(each => each.path === chosen); if (file && editable(file)) edit(file); }} />
        </Show>
      </div>
      <Show when={opened()}>
        {chosen => <Loading><DiffReader id={props.id} name={props.name} path={chosen()} to={own() ?? "tree"} notes={notes} onEdited={() => {}} recover={() => showView("notes")} /></Loading>}
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
