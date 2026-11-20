import { createMemo, createSignal, createUniqueId, For, lazy, Loading, refresh, Show } from "solid-js";
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
import { changedPath, statusText } from "./paths";
import "./styles.css";

const DiffReader = lazy(() => loadReader().then(module => ({ default: module.DiffReader })));

/** A repository's name in the Project: its folder relative to the Project's root, else its own folder name; never an absolute path. */
const nameOf = (repo: string, root: string) => repo.startsWith(`${root}/`) ? repo.slice(root.length + 1) : repo.split("/").filter(Boolean).at(-1) ?? repo;

/** U7610b: the file's `+added -removed` counts as the Daemon counted them; none for a binary file. */
const FileRow = (props: { file: ChangedFile; onChoose: () => void; editable: boolean; onEdit: () => void }) => {
  const pathId = createUniqueId();

  return <li class="changes-row">
  <button type="button" data-button="quiet" class="changes-file" onClick={() => props.onChoose()}>
    <span class="changes-path" id={pathId}>{props.file.path}</span>
    <span class="changes-status">{statusText[props.file.status]}</span>
    <Show when={props.file.counts}>{value => <span class="changes-counts"><span data-sign="added">{copy.addedLines(value().added)}</span> <span data-sign="removed">{copy.removedLines(value().removed)}</span></span>}</Show>
  </button>
  <Show when={props.editable} fallback={<span class="changes-edit" aria-hidden="true">{copy.openInEditor}</span>}><button type="button" data-button="quiet" class="changes-edit" aria-describedby={pathId} onClick={() => props.onEdit()}>{copy.openInEditor}</button></Show>
  </li>;
};

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

  const title = () => `${copy.changes}: ${props.name} ${copy.versus} ${copy.remoteMain}`;

  const files = (): readonly ChangedFile[] => own() ? listed()?.files ?? [] : group()?.files ?? [];

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

  return <section class="changes-view" aria-label={copy.changes}>
    <header class="changes-head">
      <h2>{title()}</h2>
      <Show when={!path()}><button type="button" data-button="quiet" onClick={() => hideView("changes")}>{copy.closeChanges}</button></Show>
    </header>
    <Show when={groups().length > 1 && !own()}>
      <ul class="changes-groups" aria-label={copy.changeGroups}>
        <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPath(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
      </ul>
    </Show>
    <div class="changes-pickers">
      <span class="changes-from"><span>{copy.compareFrom}</span> {copy.remoteMain}</span>
      <Show when={segments().length > 1} fallback={<span class="changes-to"><span>{copy.compareTo}</span> <span class="changes-to-value">{copy.changes}</span></span>}>
        <SegmentGroup label={copy.compareTo} segments={segments()} value={target()} onValueChange={choose} />
      </Show>
    </div>
    <BlockedFailure message={own() ? listed()?.failure : null} recover={{ run: () => refresh(listed) }} />
    <div class="changes-body">
    <Show when={path()} fallback={<ul class="changes-files" aria-label={copy.changedFilesList}>
      <For each={files()}>{file => <FileRow file={file} editable={editable(file)} onEdit={() => edit(file)} onChoose={() => { void loadReader(); setPath(file.path); }} />}</For>
    </ul>}>
      {chosen => <Loading><DiffReader id={props.id} name={props.name} path={chosen()} to={own() ?? "tree"} notes={notes} onEdited={() => {}} onBack={() => setPath(undefined)} onClose={() => hideView("changes")} recover={() => showView("notes")} /></Loading>}
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
