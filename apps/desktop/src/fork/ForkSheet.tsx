import "./fork.css";
import Check from "lucide-solid/icons/check";
import Minus from "lucide-solid/icons/minus";
import { createTreeCollection } from "@ark-ui/solid/collection";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { ForkColour } from "@contracts/data/ForkColour";
import type { App, ForkListed } from "../app/seam";
import { Dialog } from "../ui/Dialog";
import { claimKeys } from "../ui/RowCollection";
import { Field } from "../ui/Field";
import { RadioGroup } from "../ui/RadioGroup";
import { TreeView } from "../ui/TreeView";
import { ReservedLine } from "../ink/ReservedLine";
import { forkCopy } from "./copy";
import { createForkTicks, forkRows, type ForkRow, type ForkSource } from "./forkTicks";

const COLOURS: readonly ForkColour[] = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"];

/** AI7152a: each Channel's name and fixed colour, as `contracts::identity::CHANNELS` holds them. */
const CHANNELS: readonly { name: string; colour: ForkColour }[] = [
  { name: "Roundup", colour: "orange" },
  { name: "Roundup Dev", colour: "violet" },
  { name: "Roundup Source", colour: "blue" },
];

const RESERVED = [...CHANNELS.map(channel => channel.name), "Dev", "Source"];

/** AI7152d: the first free colour is chosen: teal, then `ForkColour` order. */
const FIRST: readonly ForkColour[] = ["teal", ...COLOURS.filter(colour => colour !== "teal")];

/** AI7152b: names compare equal after trimming and lower-casing. */
const fold = (name: string): string => name.trim().toLowerCase();

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
  const [picked, setPicked] = createSignal<ForkColour>("teal");
  const [forks, setForks] = createSignal<readonly ForkListed[]>([]);
  const free = () => COLOURS.filter(value => !CHANNELS.some(channel => channel.colour === value) && !forks().some(fork => fork.colour === value));

  const holder = (): string | null => {
    const folded = fold(name());
    const channel = RESERVED.find(taken => fold(taken) === folded);

    if (channel) return channel;

    const fork = forks().find(taken => fold(taken.name) === folded);

    return fork ? `the Fork at ${fork.path}` : null;
  };

  const problem = (): string | null => {
    if (!validName(name())) return forkCopy.invalidName;
    const taken = holder();

    return taken ? forkCopy.taken(name(), taken) : null;
  };


  const colour = (): ForkColour => (free().includes(picked()) ? picked() : FIRST.find(value => free().includes(value)) ?? picked());
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  let tree: HTMLDivElement | undefined;
  const collection = () => createTreeCollection<ForkRow>({ rootNode: { id: "", name: "", kind: "project", path: "", children: props.rows }, nodeToValue: row => row.id, nodeToString: row => row.name });

  onMount(() => {
    let alive = true;

    void props.app.forkList().then(listed => { if (alive) setForks(listed); }, () => {});
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
    if (busy() || problem() || free().length === 0) return;
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
    <Field.Root invalid={problem() !== null}>
      <Field.Label>{forkCopy.name}</Field.Label>
      <Field.Input ref={element => { input = element; props.inputRef(element); }} type="text" value={name()} onInput={event => setName(event.currentTarget.value)} />
      <Field.ErrorText>{problem()}</Field.ErrorText>
    </Field.Root>
    <Show when={forks().length > 0}>
      <ul class="fork-list" aria-label={forkCopy.list}>
        <For each={forks()}>{fork => <li><span>{fork.name}</span> <span>{fork.colour}</span>{fork.collides ? <span class="fork-collides"> {forkCopy.collides(fork.collides)}</span> : null}</li>}</For>
      </ul>
    </Show>
    <Show when={free().length > 0} fallback={<p class="fork-colours-full">{forkCopy.colourTaken}</p>}>
      <RadioGroup class="fork-swatches" label={forkCopy.colour} choices={free().map(value => ({ value, label: value }))} value={colour()} onValueChange={setPicked} />
    </Show>
    <div class="app-dialog-actions">
      <ReservedLine class="fork-failure" message={failure()} dismiss={() => setFailure(null)} />
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
