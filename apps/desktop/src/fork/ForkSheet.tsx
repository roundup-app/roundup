import "./fork.css";
import Check from "lucide-solid/icons/check";
import Minus from "lucide-solid/icons/minus";
import { createTreeCollection } from "@ark-ui/solid/collection";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ForkColour } from "@contracts/data/ForkColour";
import type { App } from "../app/seam";
import { Dialog } from "../ui/Dialog";
import { claimKeys } from "../ui/RowCollection";
import { Field } from "../ui/Field";
import { RadioGroup } from "../ui/RadioGroup";
import { TreeView } from "../ui/TreeView";
import { ReservedLine } from "../ink/ReservedLine";
import { forkCopy } from "./copy";
import { createForkTicks, forkRows, type ForkRow, type ForkSource } from "./forkTicks";

const COLOURS: readonly ForkColour[] = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"];

/** FS5979c: 1 to 40 characters with no control character. */
const validName = (name: string): boolean => [...name].length >= 1 && [...name].length <= 40 && !/\p{Cc}/u.test(name);

/** The tree's keys: arrows, Home, End, Space and Enter belong to the focused row. */
const TREE_KEYS = /^(Arrow(Down|Up|Left|Right)|Home|End| |Enter)$/;

const claim = (element: HTMLElement) => claimKeys(element, event => TREE_KEYS.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey);

const Rows = (props: { rows: ForkRow[]; path: number[]; state: (id: string) => boolean | "indeterminate"; toggle: (id: string) => void }) => (
  <For each={props.rows}>{(row, at) => {
    const indexPath = () => [...props.path, at()];

    const box = () => (
      <TreeView.NodeCheckbox class="fork-box" aria-label={row.name} aria-checked={props.state(row.id) === "indeterminate" ? "mixed" : props.state(row.id) ? "true" : "false"}
        data-state={props.state(row.id) === "indeterminate" ? "indeterminate" : props.state(row.id) ? "checked" : "unchecked"}
        onClick={(event: MouseEvent) => { event.stopPropagation(); props.toggle(row.id); }}>
        <Show when={props.state(row.id) === "indeterminate"} fallback={<Show when={props.state(row.id)}><Check aria-hidden="true" /></Show>}><Minus aria-hidden="true" /></Show>
      </TreeView.NodeCheckbox>
    );

    return <TreeView.NodeProvider node={row} indexPath={indexPath()}>
      <Show when={row.children.length > 0} fallback={<TreeView.Item data-kind={row.kind} ref={claim}>{box()}<TreeView.ItemText>{row.name}</TreeView.ItemText></TreeView.Item>}>
        <TreeView.Branch data-kind={row.kind}>
          <TreeView.BranchControl ref={claim}>{box()}<TreeView.BranchText>{row.name}</TreeView.BranchText></TreeView.BranchControl>
          <TreeView.BranchContent><Rows rows={row.children} path={indexPath()} state={props.state} toggle={props.toggle} /></TreeView.BranchContent>
        </TreeView.Branch>
      </Show>
    </TreeView.NodeProvider>;
  }}</For>
);

const Form = (props: { app: App; rows: ForkRow[]; onClose: () => void; inputRef: (element: HTMLInputElement) => void }) => {
  const ticks = createForkTicks(() => props.rows);
  const [name, setName] = createSignal("");
  const [colour, setColour] = createSignal<ForkColour>("teal");
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  let tree: HTMLDivElement | undefined;
  const collection = () => createTreeCollection<ForkRow>({ rootNode: { id: "", name: "", kind: "project", path: "", children: props.rows }, nodeToValue: row => row.id, nodeToString: row => row.name });

  onMount(() => {
    let alive = true;

    void props.app.forkBranch().then(branch => {
      if (!alive) return;
      setName(branch);
      queueMicrotask(() => { input?.focus(); input?.select(); });
    });
    onCleanup(() => { alive = false; });

    // Space on a focused row toggles it through the same tick model as a click.
    const space = (event: KeyboardEvent) => {
      const row = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-part=branch-control], [data-part=item]") : null;

      if (event.key !== " " || !row?.dataset.value) return;
      event.preventDefault();
      event.stopPropagation();
      ticks.toggle(row.dataset.value);
    };

    tree?.addEventListener("keydown", space, true);
    onCleanup(() => tree?.removeEventListener("keydown", space, true));
  });

  const submit = async () => {
    if (busy() || !validName(name())) return;
    setBusy(true);
    setFailure(null);

    try {
      await props.app.forkMake({ name: name(), colour: colour(), projects: ticks.picks() });
      props.onClose();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  };

  return <form class="fork-sheet" onSubmit={event => { event.preventDefault(); void submit(); }}>
    <Dialog.Title>{forkCopy.title}</Dialog.Title>
    <div ref={tree} class="fork-tree">
      <TreeView.Root collection={collection()} expandedValue={collection().getBranchValues()} selectedValue={[]} checkedValue={[]}>
        <TreeView.Tree aria-label={forkCopy.tree}><Rows rows={props.rows} path={[]} state={ticks.state} toggle={ticks.toggle} /></TreeView.Tree>
      </TreeView.Root>
    </div>
    <Field.Root invalid={!validName(name())}>
      <Field.Label>{forkCopy.name}</Field.Label>
      <Field.Input ref={element => { input = element; props.inputRef(element); }} type="text" value={name()} onInput={event => setName(event.currentTarget.value)} />
      <Field.ErrorText>{forkCopy.invalidName}</Field.ErrorText>
    </Field.Root>
    <RadioGroup class="fork-swatches" label={forkCopy.colour} choices={COLOURS.map(value => ({ value, label: value }))} value={colour()} onValueChange={setColour} />
    <div class="app-dialog-actions">
      <ReservedLine class="fork-failure" message={failure()} />
      <Dialog.CloseTrigger type="button" data-button="quiet">{forkCopy.close}</Dialog.CloseTrigger>
      <button type="submit" data-button="primary" disabled={busy()}>{forkCopy.make}</button>
    </div>
  </form>;
};

/** FS5979: the Fork sheet; it holds the Rail tree of every open Project with all rows ticked each time it opens. */
export const ForkSheet = (props: { app: App; open: boolean; sources: () => readonly ForkSource[]; onClose: () => void }) => {
  let input: HTMLInputElement | undefined;

  return (
  <Dialog.Root open={props.open} initialFocusEl={() => input ?? null} onOpenChange={({ open }) => { if (!open) props.onClose(); }}>
    <Dialog.Positioner><Dialog.Content class="app-dialog-form">
      <Form app={props.app} rows={forkRows(props.sources())} onClose={props.onClose} inputRef={element => { input = element; }} />
    </Dialog.Content></Dialog.Positioner>
  </Dialog.Root>
  );
};
