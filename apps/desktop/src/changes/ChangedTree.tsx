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
import { RiskMark } from "./RiskMark";
import { countFor, groupTarget } from "./itemNotes";
import type { ItemNote } from "./notes";

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
  <Show when={props.item.risk}>{risk => <RiskMark risk={risk()} />}</Show>
</>;

/** U7697a: a row's risk mark aloud. */
const riskWords = (item?: ModuleGroup) => item?.risk ? [copy.riskMark[item.risk.level]] : [];

/** U7689a: a row's words aloud: its name, and the function a readback's name stands for. */
const titleOf = (item: ModuleGroup) => item.function ? copy.rowLabel(item.label ?? item.name, item.function) : item.label ?? item.name;

/** U7689b, U7689c, U7689d: the words a readback adds to an item's row: where it came from, that the diff moved on, and the way to a readback. */
const readWords = (item: ModuleGroup | undefined, offered: boolean | undefined) => [item?.read?.added ? copy.fromReadback : "", item?.read?.stale ? copy.changedSinceReadback : "", item?.untraced && offered ? copy.readToSee : ""];

type DotSignal = "finding" | "risk" | "repeat" | "moved" | "note";

/** U8009b: a module row named by its folder, not a flow or the readback's words. */
const plainModule = (module: ModuleGroup) => module.flow === undefined && module.label === undefined;

/** U8009b: a module's own name, the last segment of its folder. */
const leafOf = (module: ModuleGroup) => plainModule(module) ? module.name.split("/").at(-1) ?? module.name : module.name;

/** U8009b: the folder a row shares its name under, dimmed before the name; none for a row whose name is its own. */
const folderOf = (module: ModuleGroup, shared: ReadonlySet<string>) => {
  if (!plainModule(module) || !shared.has(leafOf(module))) return undefined;

  const parent = module.name.split("/").slice(0, -1).join("/");

  return parent === "" ? copy.rootFolder : `${parent}/`;
};

/** A file row's tree value: its path under the item that holds it; a file two flows hold is two rows. */
export const fileValue = (owner: string, path: string) => `f:${owner}\0${path}`;

export const kindValue = (kind: NoiseKind) => `k:${kind}`;

const treeItems = (grouped: Grouped, overview: boolean): TreeItemData[] => [
  ...overview ? [{ value: OVERVIEW, label: copy.overview }] : [],
  ...grouped.modules.map(module => ({ value: moduleKey(module.name), label: module.label ?? module.name, children: module.files.map(file => ({ value: fileValue(moduleKey(module.name), file.path), label: file.path })) })),
  ...grouped.noise.map(noise => ({ value: kindValue(noise.kind), label: noiseName[noise.kind], children: noise.files.map(file => ({ value: noiseKey(file.path), label: file.path })) })),
];

/** U7691a: the item a list row's N notes and the key of the scroll that holds it; none for the Overview, Unplaced, Not traced and a noise kind. */
const rowItem = (value: string | undefined, modules: readonly ModuleGroup[]) => {
  if (value === undefined) return undefined;

  if (value.startsWith("n:")) return { item: { kind: "file" as const, name: value.slice(2) }, pane: value };

  if (value.startsWith("f:")) {
    const [owner = "", path = ""] = value.slice(2).split("\0");

    return { item: { kind: "file" as const, name: path }, pane: owner };
  }

  const target = modules.map(groupTarget).find(each => each !== undefined && moduleKey(each.name) === value);

  return target && { item: { kind: target.kind, name: target.name }, pane: value };
};

/** U7691a: N on a list row asks the scroll it opened to take a note on that row's item. */
export const noteOnRow = (value: string | undefined, modules: readonly ModuleGroup[], opened: string | undefined, keys: { noteItem: (item: { kind: "module" | "flow" | "file"; name: string }) => void } | undefined) => {
  const row = rowItem(value, modules);

  if (row !== undefined && row.pane === opened) keys?.noteItem(row.item);
};

/** The tree value of the row that holds focus, if one does. */
const focusedValue = (): string | undefined => {
  const row = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>(".changes-tree [data-row]") : null;
  const { row: kind, key, path } = row?.dataset ?? {};

  return kind === "file" && path !== undefined && key !== undefined && !key.startsWith("n:") ? fileValue(key, path) : key;
};

/** U7678a, U7678b, U7679c: the Overview row, then the lens's modules in path order, each folded to its files, and a quiet row for each noise kind; a row that takes focus is chosen, a file row chooses its module at that file, and Enter or a double click on a file edits it (U2539d). `finding` is U7679d: the rows of a narrowed list, each unfolded, the Overview row gone. */
export const ChangedTree = (props: { grouped: Grouped; lens: Lens; finding: boolean; selected: string | undefined; onChoose: (key: string, file?: string) => void; onEdit: (path: string) => void; /** U7691a: the names of the modules and flows holding an and U7691d: the item notes each row counts. */ itemNotes: readonly ItemNote[]; viewed: ReadonlySet<string>; changed: ReadonlySet<string>; dimmed?: ReadonlySet<string> | undefined; /** U7685c: each item's repeats, by its name. */ repeats?: ReadonlyMap<string, number> | undefined; /** U7704c: each item's tool spots, by its name, one entry for each source. */ sources?: ReadonlyMap<string, readonly (readonly [string, number])[]> | undefined; /** U7688e: each item's gaps, by its name. */ gaps?: ReadonlyMap<string, number> | undefined; /** U7700c: each item's findings still to keep or drop, by its name. */ findings?: ReadonlyMap<string, number> | undefined; /** U7696c: each item's moved and renamed code, by its name. */ moved?: ReadonlyMap<string, number> | undefined; /** U7689c: Not traced says the readback places its files. */ readHint?: boolean | undefined; controls?: (controls: { focus: (key: string) => void; focused: () => string | undefined }) => void }) => {
  const controller = createTreeController();
  const [expanded, setExpanded] = createSignal<string[]>([]);
  const open = (value: string) => props.finding || expanded().includes(value);

  /** U7685c: the repeats an item holds, by its row's key. */
  const repeatsOf = (key: string) => props.repeats?.get(key.slice(2)) ?? 0;

  /** U7704c: the spots of each tool an item holds, by its row's key. */
  const sourcesOf = (key: string) => props.sources?.get(key.slice(2)) ?? [];

  /** U7688e: the gaps an item holds, by its row's key. */
  const gapsOf = (key: string) => props.gaps?.get(key.slice(2)) ?? 0;

  /** U7700c: the findings an item holds, by its row's key. */
  const findingsOf = (key: string) => props.findings?.get(key.slice(2)) ?? 0;

  /** U7696c: the moves an item holds, by its row's key. */
  const movedOf = (key: string) => props.moved?.get(key.slice(2)) ?? 0;

  /** The counts an item row says: its repeats, gaps, findings and moves, each when above 0, then each tool's spots. */
  const countWords = (key: string | undefined) => key === undefined ? [] : [{ count: repeatsOf, say: copy.repeatsCount }, { count: gapsOf, say: copy.gapsCount }, { count: findingsOf, say: copy.findingsCount }, { count: movedOf, say: copy.movedCount }].flatMap(({ count, say }) => count(key) > 0 ? [say(count(key))] : []).concat(sourcesOf(key).map(([name, count]) => copy.fromSource(count, name)));

  const notesOf = (item: ModuleGroup) => countFor(props.itemNotes, item);

  /** U7680a, U7680d: a module row's name adds the words it shows: Viewed, and Changed since you viewed it. */
  const label = (text: string, files: readonly ChangedFile[], key?: string, item?: ModuleGroup) => [item !== undefined && notesOf(item) > 0 ? copy.noteCount(notesOf(item)) : "", ...countWords(key), key !== undefined && props.viewed.has(key) ? copy.viewed : "", key !== undefined && props.changed.has(key) ? copy.changedSinceViewed : "", key !== undefined && props.dimmed?.has(key) ? copy.changedSinceTraced : "", ...readWords(item, props.readHint), ...riskWords(item)].filter(Boolean).reduce(copy.rowLabel, text);

  /** U8009a: the longest change among the list's modules; each bar is drawn against it. */
  const longest = createMemo(() => Math.max(1, ...props.grouped.modules.map(module => module.added + module.removed)));

  const share = (lines: number) => lines === 0 ? 0 : Math.max(3, lines / longest() * 100);

  /** U8009b: the last segments that more than one module row ends in. */
  const shared = createMemo(() => {
    const seen = new Map<string, number>();

    for (const module of props.grouped.modules) if (plainModule(module)) seen.set(leafOf(module), (seen.get(leafOf(module)) ?? 0) + 1);

    return new Set([...seen].flatMap(([leaf, count]) => count > 1 ? [leaf] : []));
  });

  /** U8009a: the one dot's signal, the most urgent the module holds: a finding, a risk mark, a repeat, moved code, a note. */
  const signalOf = (module: ModuleGroup): DotSignal | undefined => {
    const key = moduleKey(module.name);

    const counts: [number, DotSignal][] = [[findingsOf(key), "finding"], [module.risk ? 1 : 0, "risk"], [repeatsOf(key), "repeat"], [movedOf(key), "moved"], [notesOf(module), "note"]];

    return counts.find(([count]) => count > 0)?.[1];
  };

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
      <TreeItem value={moduleKey(module().name)} class="changes-row row-wash" data-row="module" data-key={moduleKey(module().name)} data-open={props.selected === moduleKey(module().name) ? "true" : undefined} data-dim={props.dimmed?.has(moduleKey(module().name)) ? "true" : undefined} aria-label={label(copy.rowLabel(copy.rowLabel(titleOf(module()), copy.filesCount(module().total)), module().counted ? `${copy.addedLines(module().added)} ${copy.removedLines(module().removed)}` : ""), module().files, moduleKey(module().name), module())}>
        <span class="changes-row-mark">
          <Show when={props.viewed.has(moduleKey(module().name))}><Check class="changes-row-state" data-state="viewed" aria-hidden="true" /></Show>
          <Show when={props.changed.has(moduleKey(module().name))}><RotateCcw class="changes-row-state" data-state="changed" aria-hidden="true" /></Show>
        </span>
        <span class="changes-row-text">
          <Show when={folderOf(module(), shared())}>{folder => <span class="changes-row-folder">{folder()}</span>}</Show>
          <Name text={module().label ?? leafOf(module())} stale={module().read?.stale} />
          <Show when={module().function}>{name => <span class="changes-row-function">{name()}</span>}</Show>
          <Show when={props.selected === moduleKey(module().name) && module().counted}><Counts added={module().added} removed={module().removed} /></Show>
        </span>
        <span class="changes-row-bar" aria-hidden="true">
          <Show when={module().counted}><span class="changes-row-added" style={{ "inline-size": `${share(module().added)}%` }} /><span class="changes-row-removed" style={{ "inline-size": `${share(module().removed)}%` }} /></Show>
        </span>
        <span class="changes-row-slot">
          <Show when={signalOf(module())}>{signal => <Show when={signal() === "risk" ? module().risk : undefined} fallback={<span class="changes-row-dot" data-signal={signal()} aria-hidden="true" />}>{risk => <RiskMark risk={risk()} />}</Show>}</Show>
        </span>
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
