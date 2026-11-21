import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js";
import { createTreeController, TreeItem, type TreeItemData } from "@ui-sdk/solid/tree";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { AppTree } from "../ui/TreeView";
import { copy } from "./copy";
import type { Grouped, NoiseKind } from "./modules";
import { statusText } from "./paths";

/** U7678a: a row's key in the open view: a module by its name, a noise file by its path. */
export const moduleKey = (name: string) => `m:${name}`;

export const noiseKey = (path: string) => `n:${path}`;

const noiseName: Record<NoiseKind, string> = { generated: copy.generated, lockfile: copy.lockfiles };

const Counts = (props: { added: number; removed: number }) => <span class="changes-row-counts">{copy.addedLines(props.added)} {copy.removedLines(props.removed)}</span>;

const Name = (props: { text: string }) => <span class="changes-row-name">{props.text}</span>;

/** A file row's tree value: its path under the module that holds it. */
const fileValue = (path: string) => `f:${path}`;

const kindValue = (kind: NoiseKind) => `k:${kind}`;

const treeItems = (grouped: Grouped): TreeItemData[] => [
  ...grouped.modules.map(module => ({ value: moduleKey(module.name), label: module.name, children: module.files.map(file => ({ value: fileValue(file.path), label: file.path })) })),
  ...grouped.noise.map(noise => ({ value: kindValue(noise.kind), label: noiseName[noise.kind], children: noise.files.map(file => ({ value: noiseKey(file.path), label: file.path })) })),
];

/** U7678a, U7678b: the change as modules in path order, each folded to its files, and a quiet row for each noise kind; a module row that takes focus is chosen, a file row chooses its module at that file, and Enter or a double click on a file edits it (U2539d). */
export const ChangedTree = (props: { grouped: Grouped; selected: string | undefined; onChoose: (key: string, file?: string) => void; onEdit: (path: string) => void; unfinished: ReadonlySet<string>; controls?: (controls: { focus: (key: string) => void }) => void }) => {
  const controller = createTreeController();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const open = (value: string) => expanded().includes(value);

  const marked = (files: readonly ChangedFile[]) => files.some(file => props.unfinished.has(file.path));

  const label = (text: string, files: readonly ChangedFile[]) => marked(files) ? `${text}, ${copy.unfinishedWork}` : text;

  /** Each file row's module key, by the file's tree value. */
  const owners = createMemo(() => new Map(props.grouped.modules.flatMap(module => module.files.map(file => [fileValue(file.path), moduleKey(module.name)] as const))));

  /** A module row chooses itself, a file row its module at that file; a noise row (`k:`) chooses nothing, so the open scroll stays. */
  const choose = (value: string | null) => {
    if (value === null) return;

    const owner = owners().get(value);

    if (owner !== undefined) props.onChoose(owner, value.slice(2));
    else if (value.startsWith("m:")) props.onChoose(value);
    else if (value.startsWith("n:")) props.onChoose(value, value.slice(2));
  };

  createEffect(() => props.controls, controls => controls?.({ focus: key => controller.focus(key) }));

  // Opening lands focus on the open row, so Escape and the keys act from the list.
  onSettled(() => { if (props.selected) controller.focus(props.selected); });

  const File = (each: { file: ChangedFile; value: string; key: string; owner: string; noise?: true }) => <TreeItem value={each.value} class={each.noise ? "changes-row changes-noise row-wash" : "changes-row row-wash"} data-row="file" data-key={each.key} data-owner={each.owner} data-path={each.file.path} aria-label={`${each.file.path}, ${statusText[each.file.status]}`}
    onDblClick={() => props.onEdit(each.file.path)} onKeyDown={event => { if (event.key === "Enter") props.onEdit(each.file.path); }}>
    <Name text={each.file.path} />
    <Show when={each.file.counts}>{counts => <Counts added={counts().added} removed={counts().removed} />}</Show>
  </TreeItem>;

  return <AppTree class="changes-tree" aria-label={copy.modules} items={treeItems(props.grouped)} controller={controller} activation="automatic" expanded={expanded()} onExpandedChange={setExpanded} value={props.selected ?? null} onValueChange={choose}>
    <For each={props.grouped.modules} keyed={each => each.name}>{module => <>
      <TreeItem value={moduleKey(module().name)} class="changes-row row-wash" data-row="module" data-key={moduleKey(module().name)} aria-label={label(`${module().name}, ${copy.filesCount(module().files.length)}`, module().files)}>
        <Name text={module().name} />
        <span class="changes-row-files">{copy.filesCount(module().files.length)}</span>
        <Show when={module().counted}><Counts added={module().added} removed={module().removed} /></Show>
      </TreeItem>
      <Show when={open(moduleKey(module().name))}>
        <For each={module().files}>{file => <File file={file} value={fileValue(file.path)} key={moduleKey(module().name)} owner={moduleKey(module().name)} />}</For>
      </Show>
    </>}</For>
    <For each={props.grouped.noise}>{noise => <>
      <TreeItem value={kindValue(noise.kind)} class="changes-row changes-noise row-wash row-wash-inert" data-row="noise" data-key={kindValue(noise.kind)} aria-label={label(copy.noiseRow(noiseName[noise.kind], noise.files.length), noise.files)}>
        <Name text={copy.noiseRow(noiseName[noise.kind], noise.files.length)} />
      </TreeItem>
      <Show when={open(kindValue(noise.kind))}>
        <For each={noise.files}>{file => <File file={file} value={noiseKey(file.path)} key={noiseKey(file.path)} owner={kindValue(noise.kind)} noise />}</For>
      </Show>
    </>}</For>
  </AppTree>;
};
