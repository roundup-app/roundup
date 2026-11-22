import { createMemo, createSignal, flush, Show } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import { Field } from "../ui/Field";
import { copy } from "./copy";
import { fileValue, kindValue, moduleKey, noiseKey } from "./ChangedTree";
import { narrow, OVERVIEW } from "./lens";
import type { Grouped } from "./modules";

/** What the find reads of the view around it: the lens's rows, the open item, the list and its focus. */
type Around = {
  files: () => readonly ChangedFile[];
  listing: () => Grouped;
  opened: () => string | undefined;
  view: () => HTMLElement | undefined;
  focusTree: (key: string) => void;
  treeFocus: () => string | undefined;
  choose: (key: string, file?: string) => void;
};

/** U7679d: the letters typed in the find narrow what the list shows, never what is open; `/` opens it, Escape clears and closes it, and the list returns as it was, with focus where it was before the find. */
export const createFind = (around: Around) => {
  const [finding, setFinding] = createSignal(false);
  const [letters, setLetters] = createSignal("");

  const grouped = createMemo(() => letters() === "" ? around.listing() : narrow(around.listing(), letters()));

  let box: HTMLElement | undefined;
  let origin: string | undefined;
  let scrolled = 0;

  const list = () => around.view()?.querySelector<HTMLElement>(".changes-tree") ?? undefined;

  const open = () => {
    if (around.files().length === 0) return;

    if (!finding()) origin = around.treeFocus();
    setFinding(true);
    flush();
    box?.querySelector("input")?.focus();
  };

  const close = () => {
    setLetters("");
    setFinding(false);
    flush();

    const tree = list();

    if (tree) tree.scrollTop = scrolled;
    around.focusTree(origin ?? around.opened() ?? OVERVIEW);
  };

  const type = (value: string) => {
    if (letters() === "" && value !== "") scrolled = list()?.scrollTop ?? 0;
    setLetters(value);
  };

  // The first row the find shows, and the first file under it.
  const firstRow = () => {
    const module = grouped().modules[0];
    const noise = grouped().noise[0];

    if (letters() === "") return OVERVIEW;

    return module ? moduleKey(module.name) : noise ? kindValue(noise.kind) : undefined;
  };

  const firstFile = () => {
    const module = grouped().modules[0];
    const noise = grouped().noise[0];

    if (module?.files[0]) return { key: moduleKey(module.name), path: module.files[0].path, value: fileValue(module.files[0].path) };

    return noise?.files[0] ? { key: noiseKey(noise.files[0].path), path: noise.files[0].path, value: noiseKey(noise.files[0].path) } : undefined;
  };

  const keys = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "ArrowDown") {
      const row = firstRow();

      event.preventDefault();

      if (row) around.focusTree(row);
    } else if (event.key === "Enter") {
      const hit = firstFile();

      event.preventDefault();

      if (hit) {
        around.choose(hit.key, hit.path);
        flush();
        around.focusTree(hit.value);
      }
    }
  };

  return { finding, letters, grouped, open, close, type, keys, attach: (element: HTMLElement) => { box = element; } };
};

export type Find = ReturnType<typeof createFind>;

/** U7679d: the find's field, over the list while the find is open. */
export const FindField = (props: { find: Find }) => <Show when={props.find.finding()}>
  <div class="changes-find" ref={props.find.attach} onKeyDown={event => props.find.keys(event)}>
    <Field.Root>
      <Field.Input value={props.find.letters()} placeholder={copy.findFile} spellcheck={false} autocorrect="off" autocapitalize="off" aria-label={copy.findFile} onValueChange={props.find.type} />
    </Field.Root>
  </div>
</Show>;
