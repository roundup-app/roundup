import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import Check from "@lucide/solid/icons/check";
import RotateCcw from "@lucide/solid/icons/rotate-ccw";
import { createTreeController, TreeItem, type TreeItemData } from "@ui-sdk/solid/tree";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { AppTree } from "../ui/TreeView";
import { copy } from "./copy";
import { OVERVIEW, type Lens } from "./lens";
import type { Grouped, ModuleGroup, NoiseKind } from "./modules";
import { isNew, statusText } from "./paths";

/** U7678a: a row's key in the open view: a module by its name, a noise file by its path. */
export const moduleKey = (name: string) => `m:${name}`;

export const noiseKey = (path: string) => `n:${path}`;

const noiseName: Record<NoiseKind, string> = { generated: copy.generated, lockfile: copy.lockfiles };

export const Counts = (props: { added: number; removed: number }) => <span class="changes-row-counts">{copy.addedLines(props.added)} {copy.removedLines(props.removed)}</span>;

export const Name = (props: { text: string; stale?: boolean | undefined }) => <span class="changes-row-name" data-stale={props.stale ? "true" : undefined}>{props.text}</span>;

/** U7689a, U7689b: an item's name: the readback's, with the function quiet beside it, and the mark of a flow the readback added. */
export const ItemName = (props: { item: ModuleGroup }) => <>
  <Name text={props.item.label ?? props.item.name} stale={props.item.read?.stale} />
  <Show when={props.item.function}>{name => <span class="changes-row-function">{name()}</span>}</Show>
  <Show when={props.item.read?.added}><span class="changes-row-status">{copy.fromReadback}</span></Show>
</>;

/** U7689a: a row's words aloud: its name, and the function a readback's name stands for. */
const titleOf = (item: ModuleGroup) => item.function ? copy.rowLabel(item.label ?? item.name, item.function) : item.label ?? item.name;

/** U7689b, U7689c, U7689d: the words a readback adds to an item's row: where it came from, that the diff moved on, and the way to a readback. */
const readWords = (item: ModuleGroup | undefined, offered: boolean | undefined) => [item?.read?.added ? copy.fromReadback : "", item?.read?.stale ? copy.changedSinceReadback : "", item?.untraced && offered ? copy.readToSee : ""];

/** A file row's tree value: its path under the item that holds it; a file two flows hold is two rows. */
export const fileValue = (owner: string, path: string) => `f:${owner}\0${path}`;

export const kindValue = (kind: NoiseKind) => `k:${kind}`;

const treeItems = (grouped: Grouped, overview: boolean): TreeItemData[] => [
  ...overview ? [{ value: OVERVIEW, label: copy.overview }] : [],
  ...grouped.modules.map(module => ({ value: moduleKey(module.name), label: module.label ?? module.name, children: module.files.map(file => ({ value: fileValue(moduleKey(module.name), file.path), label: file.path })) })),
  ...grouped.noise.map(noise => ({ value: kindValue(noise.kind), label: noiseName[noise.kind], children: noise.files.map(file => ({ value: noiseKey(file.path), label: file.path })) })),
];

/** The tree value of the row that holds focus, if one does. */
const focusedValue = (): string | undefined => {
  const row = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>(".changes-tree [data-row]") : null;
  const { row: kind, key, path } = row?.dataset ?? {};

  return kind === "file" && path !== undefined && key !== undefined && !key.startsWith("n:") ? fileValue(key, path) : key;
};

/** U7678a, U7678b, U7679c: the Overview row, then the lens's modules in path order, each folded to its files, and a quiet row for each noise kind; a row that takes focus is chosen, a file row chooses its module at that file, and Enter or a double click on a file edits it (U2539d). `finding` is U7679d: the rows of a narrowed list, each unfolded, the Overview row gone. */
export const ChangedTree = (props: { grouped: Grouped; lens: Lens; finding: boolean; selected: string | undefined; onChoose: (key: string, file?: string) => void; onEdit: (path: string) => void; unfinished: ReadonlySet<string>; viewed: ReadonlySet<string>; changed: ReadonlySet<string>; dimmed?: ReadonlySet<string> | undefined; /** U7685c: each item's repeats, by its name. */ repeats?: ReadonlyMap<string, number> | undefined; /** U7688e: each item's gaps, by its name. */ gaps?: ReadonlyMap<string, number> | undefined; /** U7689c: Not traced says the readback places its files. */ readHint?: boolean | undefined; controls?: (controls: { focus: (key: string) => void; focused: () => string | undefined }) => void }) => {
  const controller = createTreeController();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const open = (value: string) => props.finding || expanded().includes(value);

  /** U7685c: the repeats an item holds, by its row's key. */
  const repeatsOf = (key: string) => props.repeats?.get(key.slice(2)) ?? 0;

  /** U7688e: the gaps an item holds, by its row's key. */
  const gapsOf = (key: string) => props.gaps?.get(key.slice(2)) ?? 0;

  const marked = (files: readonly ChangedFile[]) => files.some(file => props.unfinished.has(file.path));

  /** U7680a, U7680d: a module row's name adds the words it shows: unfinished work, Viewed, and Changed since you viewed it. */
  const label = (text: string, files: readonly ChangedFile[], key?: string, item?: ModuleGroup) => [marked(files) ? copy.unfinishedWork : "", key !== undefined && repeatsOf(key) > 0 ? copy.repeatsCount(repeatsOf(key)) : "", key !== undefined && gapsOf(key) > 0 ? copy.gapsCount(gapsOf(key)) : "", key !== undefined && props.viewed.has(key) ? copy.viewed : "", key !== undefined && props.changed.has(key) ? copy.changedSinceViewed : "", key !== undefined && props.dimmed?.has(key) ? copy.changedSinceTraced : "", ...readWords(item, props.readHint)].filter(Boolean).reduce(copy.rowLabel, text);

  /** Each file row's module key and path, by the file's tree value. */
  const owners = createMemo(() => new Map(props.grouped.modules.flatMap(module => module.files.map(file => [fileValue(moduleKey(module.name), file.path), { owner: moduleKey(module.name), path: file.path }] as const))));

  /** A module row chooses itself, a file row its module at that file; a noise row (`k:`) chooses nothing, so the open scroll stays. */
  const choose = (value: string | null) => {
    if (value === null) return;

    if (value === OVERVIEW) return props.onChoose(OVERVIEW);

    const owner = owners().get(value);

    if (owner !== undefined) props.onChoose(owner.owner, owner.path);
    else if (value.startsWith("m:")) props.onChoose(value);
    else if (value.startsWith("n:")) props.onChoose(value, value.slice(2));
  };

  createEffect(() => props.controls, controls => controls?.({ focus: key => controller.focus(key), focused: focusedValue }));

  // Opening lands focus on the open row, so Escape and the keys act from the list.
  onSettled(() => { if (props.selected) controller.focus(props.selected); });

  const File = (each: { file: ChangedFile; value: string; key: string; owner: string; noise?: true }) => <TreeItem value={each.value} class={each.noise ? "changes-row changes-noise row-wash" : "changes-row row-wash"} data-row="file" data-key={each.key} data-owner={each.owner} data-path={each.file.path} aria-label={copy.rowLabel(each.file.path, statusText[each.file.status])}
    onDblClick={() => props.onEdit(each.file.path)} onKeyDown={event => { if (event.key === "Enter") props.onEdit(each.file.path); }}>
    <Name text={each.file.path} />
    <Show when={isNew(each.file.status)}><span class="changes-row-status">{statusText[each.file.status]}</span></Show>
    <Show when={each.file.counts}>{counts => <Counts added={counts().added} removed={counts().removed} />}</Show>
  </TreeItem>;

  return <AppTree class="changes-tree" aria-label={copy.lenses[props.lens]} items={treeItems(props.grouped, !props.finding)} controller={controller} activation="automatic" expanded={props.finding ? treeItems(props.grouped, false).map(item => item.value) : expanded()} onExpandedChange={next => { if (!props.finding) setExpanded(next); }} value={props.selected ?? null} onValueChange={choose}>
    <Show when={!props.finding}>
      <TreeItem value={OVERVIEW} class="changes-row row-wash" data-row="overview" data-key={OVERVIEW} aria-label={copy.overview}>
        <Name text={copy.overview} />
      </TreeItem>
    </Show>
    <For each={props.grouped.modules} keyed={each => each.name}>{module => <>
      <TreeItem value={moduleKey(module().name)} class="changes-row row-wash" data-row="module" data-key={moduleKey(module().name)} data-dim={props.dimmed?.has(moduleKey(module().name)) ? "true" : undefined} aria-label={label(copy.rowLabel(titleOf(module()), copy.filesCount(module().total)), module().files, moduleKey(module().name), module())}>
        <ItemName item={module()} />
        <span class="changes-row-files">{copy.filesCount(module().total)}</span>
        <Show when={module().counted}><Counts added={module().added} removed={module().removed} /></Show>
        <Show when={repeatsOf(moduleKey(module().name)) > 0}><span class="changes-row-repeats">{copy.repeatsCount(repeatsOf(moduleKey(module().name)))}</span></Show>
        <Show when={gapsOf(moduleKey(module().name)) > 0}><span class="changes-row-repeats">{copy.gapsCount(gapsOf(moduleKey(module().name)))}</span></Show>
        <Show when={module().untraced && props.readHint}><span class="changes-row-status">{copy.readToSee}</span></Show>
        <Show when={props.viewed.has(moduleKey(module().name))}><Check class="changes-row-state" data-state="viewed" aria-hidden="true" /></Show>
        <Show when={props.changed.has(moduleKey(module().name))}><RotateCcw class="changes-row-state" data-state="changed" aria-hidden="true" /></Show>
      </TreeItem>
      <Show when={open(moduleKey(module().name))}>
        <For each={module().files}>{file => <File file={file} value={fileValue(moduleKey(module().name), file.path)} key={moduleKey(module().name)} owner={moduleKey(module().name)} />}</For>
      </Show>
    </>}</For>
    <For each={props.grouped.noise}>{noise => <>
      <TreeItem value={kindValue(noise.kind)} class="changes-row changes-noise row-wash row-wash-inert" data-row="noise" data-key={kindValue(noise.kind)} aria-label={label(copy.noiseRow(noiseName[noise.kind], noise.total), noise.files)}>
        <Name text={copy.noiseRow(noiseName[noise.kind], noise.total)} />
      </TreeItem>
      <Show when={open(kindValue(noise.kind))}>
        <For each={noise.files}>{file => <File file={file} value={noiseKey(file.path)} key={noiseKey(file.path)} owner={kindValue(noise.kind)} noise />}</For>
      </Show>
    </>}</For>
  </AppTree>;
};
