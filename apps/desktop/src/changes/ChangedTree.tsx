import { createEffect, createSignal, For, onSettled, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { copy } from "./copy";
import type { Grouped, NoiseKind } from "./modules";
import { statusText } from "./paths";

/** U7678a: a row's key in the open view: a module by its name, a noise file by its path. */
export const moduleKey = (name: string) => `m:${name}`;

export const noiseKey = (path: string) => `n:${path}`;

const noiseName: Record<NoiseKind, string> = { generated: copy.generated, lockfile: copy.lockfiles };

const Counts = (props: { added: number; removed: number }) => <span class="changes-row-counts">{copy.addedLines(props.added)} {copy.removedLines(props.removed)}</span>;

/** U7678a, U7678b: the change as modules in path order, each folded to its files, and a quiet row for each noise kind; a module row that takes focus is chosen, a file row chooses its module at that file, and Enter or a double click on a file edits it (U2539d). */
export const ChangedTree = (props: { grouped: Grouped; selected: string | undefined; onChoose: (key: string, file?: string) => void; onEdit: (path: string) => void; unfinished: ReadonlySet<string>; controls?: (controls: { focus: (key: string) => void }) => void }) => {
  let host: HTMLUListElement | undefined;
  const [unfolded, setUnfolded] = createSignal<ReadonlySet<string>>(new Set());

  const fold = (key: string, open: boolean) => setUnfolded(before => {
    const next = new Set(before);

    if (open) next.add(key); else next.delete(key);

    return next;
  });

  const rows = () => [...host?.querySelectorAll<HTMLElement>("[data-row]") ?? []];

  const focusKey = (key: string) => host?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();

  createEffect(() => props.controls, controls => controls?.({ focus: focusKey }));

  const marked = (files: readonly ChangedFile[]) => files.some(file => props.unfinished.has(file.path));

  const label = (text: string, files: readonly ChangedFile[]) => marked(files) ? `${text}, ${copy.unfinishedWork}` : text;

  const choose = (event: FocusEvent | MouseEvent) => {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-row]") : null;
    const key = row?.dataset.key;

    if (!row || key === undefined) return;

    if (row.dataset.row === "file") props.onChoose(key, row.dataset.path);
    else if (row.dataset.row === "module") props.onChoose(key);
  };

  const arrow = (name: string, row: HTMLElement, at: number, key: string, list: readonly HTMLElement[]) => {
    if (name === "ArrowDown" || name === "ArrowUp") list[at + (name === "ArrowDown" ? 1 : -1)]?.focus();
    else if (name === "ArrowRight") { if (row.dataset.row !== "file") fold(key, true); }
    else if (row.dataset.row === "file") host?.querySelector<HTMLElement>(`[data-key="${CSS.escape(row.dataset.owner ?? "")}"]`)?.focus();
    else fold(key, false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-row]") : null;

    if (!row) return;
    const list = rows();
    const at = list.indexOf(row);
    const key = row.dataset.key ?? "";

    if (event.key === "Enter") {
      if (row.dataset.row === "file" && row.dataset.path) props.onEdit(row.dataset.path);

      return;
    }

    if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(event.key)) return;
    event.preventDefault();
    arrow(event.key, row, at, key, list);
  };

  const onDoubleClick = (event: MouseEvent) => {
    const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-row="file"]') : null;

    if (row?.dataset.path) props.onEdit(row.dataset.path);
  };

  // Opening lands focus on the open row, so Escape and the keys act from the list.
  onSettled(() => { if (props.selected) focusKey(props.selected); });

  const Files = (each: { owner: string; files: readonly ChangedFile[] }) => <Show when={unfolded().has(each.owner)}>
    <ul class="changes-files">
      <For each={each.files}>{file => <li>
        <button type="button" class="changes-row" data-row="file" data-key={each.owner} data-owner={each.owner} data-path={file.path} tabindex="-1" aria-label={`${file.path}, ${statusText[file.status]}`}>
          <span class="changes-row-name">{file.path}</span>
          <Show when={file.counts}>{counts => <Counts added={counts().added} removed={counts().removed} />}</Show>
        </button>
      </li>}</For>
    </ul>
  </Show>;

  return <ul class="changes-tree" aria-label={copy.modules} ref={element => { host = element; }} onFocusIn={choose} onClick={choose} onKeyDown={onKeyDown} onDblClick={onDoubleClick}>
    <For each={props.grouped.modules} keyed={each => each.name}>{module => <li>
      <button type="button" class="changes-row" data-row="module" data-key={moduleKey(module().name)} data-selected={props.selected === moduleKey(module().name) ? "true" : "false"} tabindex={props.selected === moduleKey(module().name) ? 0 : -1} aria-expanded={unfolded().has(moduleKey(module().name)) ? "true" : "false"} aria-label={label(`${module().name}, ${copy.filesCount(module().files.length)}`, module().files)} onClick={() => fold(moduleKey(module().name), !unfolded().has(moduleKey(module().name)))}>
        <span class="changes-row-name">{module().name}</span>
        <span class="changes-row-files">{copy.filesCount(module().files.length)}</span>
        <Show when={module().counted}><Counts added={module().added} removed={module().removed} /></Show>
      </button>
      <Files owner={moduleKey(module().name)} files={module().files} />
    </li>}</For>
    <For each={props.grouped.noise}>{noise => <li class="changes-noise">
      <button type="button" class="changes-row" data-row="noise" data-key={`k:${noise.kind}`} tabindex="-1" aria-expanded={unfolded().has(`k:${noise.kind}`) ? "true" : "false"} aria-label={label(copy.noiseRow(noiseName[noise.kind], noise.files.length), noise.files)} onClick={() => fold(`k:${noise.kind}`, !unfolded().has(`k:${noise.kind}`))}>
        <span class="changes-row-name">{copy.noiseRow(noiseName[noise.kind], noise.files.length)}</span>
      </button>
      <Show when={unfolded().has(`k:${noise.kind}`)}>
        <ul class="changes-files">
          <For each={noise.files}>{file => <li>
            <button type="button" class="changes-row" data-row="file" data-key={noiseKey(file.path)} data-owner={`k:${noise.kind}`} data-path={file.path} data-noise="true" tabindex="-1" aria-label={`${file.path}, ${statusText[file.status]}`}>
              <span class="changes-row-name">{file.path}</span>
            </button>
          </li>}</For>
        </ul>
      </Show>
    </li>}</For>
  </ul>;
};
