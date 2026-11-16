import "./fork.css";
import Check from "@lucide/solid/icons/check";
import Minus from "@lucide/solid/icons/minus";
import { createMemo, createSignal, flush, For, onSettled, Show } from "solid-js";
import { TreeGroup, TreeItem, TreeItemLabel, type TreeItemData } from "@ui-sdk/solid/tree";
import type { ForkColour } from "@contracts/data/ForkColour";
import type { App, ForkListed } from "../app/seam";
import { Dialog } from "../ui/Dialog";
import { claimKeys } from "../ui/RowCollection";
import { Field } from "../ui/Field";
import { RadioGroup } from "../ui/RadioGroup";
import { AppTree } from "../ui/TreeView";
import { branchesOf } from "../rail/collection";
import { ReservedLine } from "../ink/ReservedLine";
import { forkCopy } from "./copy";
import { BusyButton } from "../ui/BusyButton";
import { ForkList } from "./ForkList";
import { createForkTicks, forkRows, type ForkRow, type ForkSource } from "./forkTicks";

const COLOURS: readonly ForkColour[] = ["red", "orange", "amber", "green", "teal", "blue", "violet", "pink"];

/** AI7152a, AI7152b: a Channel's name, fixed colour and reserved names: the name and its last word (`Roundup Dev`, `Dev`). */
const channel = (name: string, colour: ForkColour) => ({ name, colour, reserved: [name, name.slice(name.lastIndexOf(" ") + 1)] });

/** As `contracts::identity::CHANNELS` holds them. */
const CHANNELS = [channel(forkCopy.channelStable, "orange"), channel(forkCopy.channelDev, "violet"), channel(forkCopy.channelSource, "blue")];

/** AI7152d: the first free colour is chosen: teal, then `ForkColour` order. */
const FIRST: readonly ForkColour[] = ["teal", ...COLOURS.filter(colour => colour !== "teal")];

/** AI7152b: names compare equal after trimming and lower-casing. */
const fold = (name: string): string => name.trim().toLowerCase();

/** FS5979c: 1 to 40 characters with no control character. */
const validName = (name: string): boolean => [...name].length >= 1 && [...name].length <= 40 && !/\p{Cc}/u.test(name);

/** The tree's keys: arrows, Home, End, Space and Enter belong to the focused row. */
const TREE_KEYS = /^(Arrow(Down|Up|Left|Right)|Home|End| |Enter)$/;

const claim = (element: HTMLElement) => claimKeys(element, event => TREE_KEYS.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey);

const forkItems = (rows: readonly ForkRow[]): TreeItemData[] => rows.map(row => {
  const item: TreeItemData = { value: row.id, label: row.name };

  if (row.children.length > 0) item.children = forkItems(row.children);

  return item;
});

const Rows = (props: { rows: ForkRow[]; state: (id: string) => boolean | "indeterminate"; toggle: (id: string) => void }) => (
  <For each={props.rows}>{row => (
    <TreeItem value={row.id} data-kind={row.kind} ref={claim} onKeyDown={event => {
      // Space on a focused row toggles it through the same tick model as a click.
      if (event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      props.toggle(row.id);
    }}>
      <TreeItemLabel>
        <span role="checkbox" class="fork-box" aria-label={row.name} aria-checked={props.state(row.id) === "indeterminate" ? "mixed" : props.state(row.id) ? "true" : "false"}
          data-state={props.state(row.id) === "indeterminate" ? "indeterminate" : props.state(row.id) ? "checked" : "unchecked"}
          onClick={event => { event.stopPropagation(); event.currentTarget.closest<HTMLElement>("[role=treeitem]")?.focus({ preventScroll: true }); props.toggle(row.id); }}>
          <Show when={props.state(row.id) === "indeterminate"} fallback={<Show when={props.state(row.id)}><Check aria-hidden="true" /></Show>}><Minus aria-hidden="true" /></Show>
        </span>
        {row.name}
      </TreeItemLabel>
      <Show when={row.children.length > 0}>
        <TreeGroup><Rows rows={row.children} state={props.state} toggle={props.toggle} /></TreeGroup>
      </Show>
    </TreeItem>
  )}</For>
);

const Form = (props: { app: App; rows: ForkRow[]; onClose: () => void; inputRef: (element: HTMLInputElement) => void }) => {
  const ticks = createForkTicks(() => props.rows);
  const [name, setName] = createSignal("");
  const [picked, setPicked] = createSignal<ForkColour>("teal");
  const [forks, setForks] = createSignal<readonly ForkListed[]>([]);
  const free = () => COLOURS.filter(value => !CHANNELS.some(channel => channel.colour === value) && !forks().some(fork => fork.colour === value));

  const holder = (): string | null => {
    const folded = fold(name());
    const taker = CHANNELS.find(taken => taken.reserved.some(reserved => fold(reserved) === folded));

    if (taker) return taker.name;

    const fork = forks().find(taken => fold(taken.name) === folded);

    return fork ? forkCopy.forkAt(fork.path) : null;
  };

  const problem = (): string | null => {
    if (!validName(name())) return forkCopy.invalidName;
    const taken = holder();

    return taken ? forkCopy.claimedBy(name(), taken) : null;
  };


  const colour = (): ForkColour => (free().includes(picked()) ? picked() : FIRST.find(value => free().includes(value)) ?? picked());
  const [busy, setBusy] = createSignal(false);
  const [failure, setFailure] = createSignal<string | null>(null);
  let input: HTMLInputElement | undefined;
  const items = createMemo(() => forkItems(props.rows));

  const reload = () => void props.app.forkList().then(setForks, () => {});

  onSettled(() => {
    let alive = true;

    reload();
    void props.app.forkBranch().then(branch => {
      if (!alive) return;
      setName(branch);
      // The field must show the branch before it is selected.
      flush();
      queueMicrotask(() => { input?.focus(); input?.select(); });
    });

    return () => { alive = false; };
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
    <div class="fork-tree">
      <AppTree<"none"> aria-label={forkCopy.tree} items={items()} mode="none" expandOnPress={false} expanded={branchesOf(items())}><Rows rows={props.rows} state={ticks.state} toggle={ticks.toggle} /></AppTree>
    </div>
    <Field.Root invalid={problem() !== null}>
      <Field.Label>{forkCopy.name}</Field.Label>
      <Field.Input ref={element => { input = element; props.inputRef(element); }} type="text" value={name()} onInput={event => setName(event.currentTarget.value)} />
      <Field.ErrorText>{problem()}</Field.ErrorText>
    </Field.Root>
    <Show when={forks().length > 0}>
      <ForkList app={props.app} forks={forks()} free={free()} done={reload} />
    </Show>
    <Show when={free().length > 0} fallback={<p class="fork-colours-full">{forkCopy.colourTaken}</p>}>
      <RadioGroup class="fork-swatches" label={forkCopy.colour} choices={free().map(value => ({ value, label: value }))} value={colour()} onValueChange={setPicked} />
    </Show>
    <div class="app-dialog-actions">
      <ReservedLine class="fork-failure" message={failure()} dismiss={() => setFailure(null)} />
      <Dialog.CloseTrigger type="button" data-button="quiet">{forkCopy.close}</Dialog.CloseTrigger>
      <BusyButton kind="primary" type="submit" busy={busy()} busyLabel={forkCopy.making}>{forkCopy.make}</BusyButton>
    </div>
  </form>;
};

/** FS5979: the Fork sheet; it holds the Rail tree of every open Project with all rows ticked each time it opens. */
export const ForkSheet = (props: { app: App; open: boolean; sources: () => readonly ForkSource[]; onClose: () => void }) => {
  let input: HTMLInputElement | undefined;

  return (
  <Dialog.Root open={props.open} initialFocusEl={() => input ?? null} onOpenChange={({ open }) => { if (!open) props.onClose(); }}>
    <Dialog.Content class="app-dialog-form">
      <Form app={props.app} rows={forkRows(props.sources())} onClose={props.onClose} inputRef={element => { input = element; }} />
    </Dialog.Content>
  </Dialog.Root>
  );
};
