import { createMemo, createSignal, For, lazy, Loading, refresh, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { CompareEndpoint } from "@contracts/agent/CompareEndpoint";
import type { CompareRef } from "@contracts/agent/CompareRef";
import { failureOf } from "../app/failureOf";
import { BlockedFailure } from "../ink/MountedLine";
import { createMessageToasts } from "../ink/messageToast";
import { useConnectedProject } from "../state/connectedProject";
import { Select } from "../ui/Select";
import { copy } from "./copy";
import { loadReader } from "./chunks";
import { notesFor } from "./notes";
import { changedPath, statusText } from "./paths";
import "./styles.css";

const DiffReader = lazy(() => loadReader().then(module => ({ default: module.DiffReader })));

const keyOf = (endpoint: CompareEndpoint) => endpoint.kind === "worktree" ? `worktree:${endpoint.path}` : `head:${endpoint.branch}`;

/** A repository's name in the Project: its folder relative to the Project's root, else its own folder name; never an absolute path. */
const nameOf = (repo: string, root: string) => repo.startsWith(`${root}/`) ? repo.slice(root.length + 1) : repo.split("/").filter(Boolean).at(-1) ?? repo;

const sameEndpoint = (a: CompareEndpoint, b: CompareEndpoint) => keyOf(a) === keyOf(b);

const labelOf = (refs: readonly CompareRef[], endpoint: CompareEndpoint) => refs.find(ref => sameEndpoint(ref, endpoint))?.label ?? endpoint.branch;

/** U7610b: the file's `+added -removed` counts as the Daemon counted them; none for a binary file. */
const FileRow = (props: { file: ChangedFile; onChoose: () => void; editable: boolean; onEdit: () => void }) => <li class="changes-row">
  <button type="button" data-button="quiet" class="changes-file" onClick={() => props.onChoose()}>
    <span class="changes-path">{props.file.path}</span>
    <span class="changes-status">{statusText[props.file.status]}</span>
    <Show when={props.file.counts}>{value => <span class="changes-counts"><span data-sign="added">{copy.addedLines(value().added)}</span> <span data-sign="removed">{copy.removedLines(value().removed)}</span></span>}</Show>
  </button>
  <Show when={props.editable}><button type="button" data-button="quiet" aria-label={`${copy.openInEditor}: ${props.file.path}`} onClick={() => props.onEdit()}>{copy.openInEditor}</button></Show>
</li>;

/** U7186c, U7186d: the centre's diff of what one Agent owns, with From and To pickers over every worktree and branch head. */
const Surface = (props: { id: string; name: string }) => {
  const { app, owned, hideView, showView, project, drafts } = useConnectedProject();
  const notes = notesFor(app, project.path, drafts);

  const groups = () => {
    const read = owned.read(props.id);

    return read?.failure === null ? read.groups : [];
  };

  const [active, setActive] = createSignal(0);
  const group = () => groups()[active()] ?? groups()[0];
  // Read under ChangesView's Loading: the pickers and the title show once, with every endpoint listed.
  const choices = createMemo<CompareRef[]>(async () => (await app.rpc("project.compareRefs", null)).refs);
  const [picked, setPicked] = createSignal<{ from: CompareEndpoint; to: CompareEndpoint }>();
  const [path, setPath] = createSignal<string>();

  const [listed] = createSignal<{ failure: string | null; files: ChangedFile[] } | undefined>(async () => {
    const chosen = picked();

    if (!chosen) return undefined;
    let files: ChangedFile[] = [];
    const failure = await failureOf(async () => { files = (await app.rpc("agent.changedFiles", { id: props.id, from: chosen.from, to: chosen.to })).files; });

    return { failure, files };
  }, { loadingValue: undefined });

  // The Agent's own preset: its base against its current state, the worktree on the group's branch.
  const preset = createMemo(() => {
    const current = group();

    if (!current) return undefined;
    const trees = choices().flatMap(ref => ref.kind === "worktree" ? [ref] : []);
    const now = trees.find(ref => ref.path === current.repo && ref.branch === current.branch) ?? trees.find(ref => ref.branch === current.branch);
    const to: CompareEndpoint = now ? { kind: "worktree", path: now.path, branch: now.branch } : { kind: "head", branch: current.branch };

    const from: CompareEndpoint = { kind: "head", branch: current.base };

    return { from, to };
  });

  const ends = () => picked() ?? preset();

  const title = () => {
    const current = ends();

    if (!current) return `${copy.changes}: ${props.name}`;
    const against = picked() ? [labelOf(choices(), current.from), labelOf(choices(), current.to)] : [props.name, group()?.base ?? labelOf(choices(), current.from)];

    return `${copy.changes}: ${against.join(` ${copy.versus} `)}`;
  };

  const files = (): readonly ChangedFile[] => picked() ? listed()?.files ?? [] : group()?.files ?? [];

  // U2539d: a file that still exists opens in the editor at its line, from the checkout the comparison ends on; a failed open shows as one card.
  const [failures, setFailures] = createSignal<ReadonlyMap<string, string>>(new Map());

  const clear = (key: string) => setFailures(previous => {
    const next = new Map(previous);

    next.delete(key);

    return next;
  });

  const root = () => {
    const end = picked()?.to;

    return end ? (end.kind === "worktree" ? end.path : undefined) : group()?.repo;
  };

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

  const choose = (side: "from" | "to", value: string) => {
    const base = ends();
    const found = choices().find(ref => keyOf(ref) === value);

    if (!base || !found) return;
    const next = { ...base, [side]: found.kind === "worktree" ? { kind: "worktree", path: found.path, branch: found.branch } : { kind: "head", branch: found.branch } };

    setPicked(next);
    setPath(undefined);
  };

  const withEnd = (endpoint: CompareEndpoint | undefined): { value: string; label: string }[] => {
    const list = choices().map(ref => ({ value: keyOf(ref), label: ref.label }));

    return endpoint && !list.some(entry => entry.value === keyOf(endpoint)) ? [{ value: keyOf(endpoint), label: labelOf(choices(), endpoint) }, ...list] : list;
  };

  return <section class="changes-view" aria-label={copy.changes}>
    <header class="changes-head">
      <h2>{title()}</h2>
      <Show when={!path()}><button type="button" data-button="quiet" onClick={() => hideView("changes")}>{copy.closeChanges}</button></Show>
    </header>
    <Show when={groups().length > 1 && !picked()}>
      <ul class="changes-groups" aria-label={copy.changeGroups}>
        <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPath(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
      </ul>
    </Show>
    <Show when={ends()}>{current => <div class="changes-pickers">
      <Select label={copy.compareFrom} choices={withEnd(current().from)} value={keyOf(current().from)} onValueChange={value => choose("from", value)} />
      <Select label={copy.compareTo} choices={withEnd(current().to)} value={keyOf(current().to)} onValueChange={value => choose("to", value)} />
    </div>}</Show>
    <BlockedFailure message={listed()?.failure} recover={{ run: () => refresh(listed) }} />
    <div class="changes-body">
    <Show when={path()} fallback={<ul class="changes-files" aria-label={copy.changedFilesList}>
      <For each={files()}>{file => <FileRow file={file} editable={editable(file)} onEdit={() => edit(file)} onChoose={() => { void loadReader(); setPath(file.path); }} />}</For>
    </ul>}>
      {chosen => <Loading><DiffReader id={props.id} name={props.name} path={chosen()} from={ends()?.from} to={ends()?.to} notes={notes} onEdited={() => {}} onBack={() => setPath(undefined)} onClose={() => hideView("changes")} recover={() => showView("notes")} /></Loading>}
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
