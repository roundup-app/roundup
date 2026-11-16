import { createMemo, createResource, createSignal, For, lazy, Show, Suspense } from "solid-js";
import { diffLines } from "diff";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { CompareEndpoint } from "@contracts/agent/CompareEndpoint";
import type { CompareRef } from "@contracts/agent/CompareRef";
import type { AppSeam } from "../app/seam";
import { failureOf } from "../app/failureOf";
import { ReservedLine } from "../ink/ReservedLine";
import { useConnectedProject } from "../state/connectedProject";
import { Select } from "../ui/Select";
import { copy } from "./copy";
import { loadReader } from "./chunks";
import { notesFor } from "./notes";
import { statusText } from "./paths";
import "./styles.css";

const DiffReader = lazy(() => loadReader().then(module => ({ default: module.DiffReader })));

const HEAD: CompareEndpoint = { kind: "head", branch: "" };

const keyOf = (endpoint: CompareEndpoint) => endpoint.kind === "worktree" ? `worktree:${endpoint.path}` : `head:${endpoint.branch}`;

const sameEndpoint = (a: CompareEndpoint, b: CompareEndpoint) => keyOf(a) === keyOf(b);

const labelOf = (refs: readonly CompareRef[], endpoint: CompareEndpoint) => refs.find(ref => sameEndpoint(ref, endpoint))?.label ?? (endpoint.kind === "worktree" ? endpoint.branch : endpoint.branch);

/** The `+added -removed` line counts of one file between two endpoints; none for a binary file or a failed read. */
const countsOf = async (app: AppSeam, id: string, path: string, from: CompareEndpoint, to: CompareEndpoint): Promise<{ added: number; removed: number } | null> => {
  try {
    const comparison = await app.rpc("agent.compareFile", { id, path, from, to });

    if (comparison.old.kind === "binary" || comparison.new.kind === "binary") return null;
    let added = 0;
    let removed = 0;

    for (const part of diffLines(comparison.old.kind === "text" ? comparison.old.text : "", comparison.new.kind === "text" ? comparison.new.text : "")) {
      if (part.added) added += part.count; else if (part.removed) removed += part.count;
    }

    return { added, removed };
  } catch {
    return null;
  }
};

const FileRow = (props: { id: string; file: ChangedFile; from: CompareEndpoint; to: CompareEndpoint; onChoose: () => void }) => {
  const { app } = useConnectedProject();
  const [counts] = createResource(() => [props.id, props.file.path, keyOf(props.from), keyOf(props.to)] as const, () => countsOf(app, props.id, props.file.path, props.from, props.to));

  return <li><button type="button" data-button="quiet" class="changes-file" onClick={() => props.onChoose()}>
    <span class="changes-path">{props.file.path}</span>
    <span class="changes-status">{statusText[props.file.status]}</span>
    <Show when={counts()}>{value => <span class="changes-counts"><span data-sign="added">{copy.addedLines(value().added)}</span> <span data-sign="removed">{copy.removedLines(value().removed)}</span></span>}</Show>
  </button></li>;
};

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
  const [refs] = createResource(async () => (await app.rpc("project.compareRefs", null)).refs);
  const choices = () => refs() ?? [];
  const [picked, setPicked] = createSignal<{ from: CompareEndpoint; to: CompareEndpoint }>();
  const [path, setPath] = createSignal<string>();

  const [listed, { refetch }] = createResource(picked, async (chosen): Promise<{ failure: string | null; files: ChangedFile[] }> => {
    let files: ChangedFile[] = [];
    const failure = await failureOf(async () => { files = (await app.rpc("agent.changedFiles", { id: props.id, from: chosen.from, to: chosen.to })).files; });

    return { failure, files };
  });

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
      <button type="button" data-button="quiet" onClick={() => hideView("changes")}>{copy.closeChanges}</button>
    </header>
    <Show when={groups().length > 1 && !picked()}>
      <ul class="changes-groups" aria-label={copy.changeGroups}>
        <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each} onClick={() => { setActive(index()); setPath(undefined); }}>{copy.groupLabel(each.repo, each.branch)}</button></li>}</For>
      </ul>
    </Show>
    <Show when={ends()}>{current => <div class="changes-pickers">
      <Select label={copy.compareFrom} choices={withEnd(current().from)} value={keyOf(current().from)} onValueChange={value => choose("from", value)} />
      <Select label={copy.compareTo} choices={withEnd(current().to)} value={keyOf(current().to)} onValueChange={value => choose("to", value)} />
    </div>}</Show>
    <ReservedLine message={listed()?.failure ?? null} blocked recover={{ run: () => { void refetch(); } }} />
    <Show when={path()} fallback={<ul class="changes-files" aria-label={copy.changedFilesList}>
      <For each={files()}>{file => <FileRow id={props.id} file={file} from={ends()?.from ?? HEAD} to={ends()?.to ?? HEAD} onChoose={() => { void loadReader(); setPath(file.path); }} />}</For>
    </ul>}>
      {chosen => <Suspense><DiffReader id={props.id} name={props.name} path={chosen()} from={ends()?.from} to={ends()?.to} notes={notes} onEdited={() => {}} onBack={() => setPath(undefined)} onClose={() => hideView("changes")} recover={() => showView("notes")} /></Suspense>}
    </Show>
  </section>;
};

/** U7186c: mounted over the centre while the Changes view is open for the selected Agent. */
export const ChangesView = () => {
  const { rail, hasView } = useConnectedProject();

  const agent = createMemo(() => {
    const node = rail.nodes.find(candidate => candidate.id === rail.selected());

    return node?.kind === "agent" ? { id: node.id, name: node.name } : null;
  }, null, { equals: (a, b) => a?.id === b?.id && a?.name === b?.name });

  return <Show when={hasView("changes") ? agent() : null} keyed>{each => <Surface id={each.id} name={each.name} />}</Show>;
};
