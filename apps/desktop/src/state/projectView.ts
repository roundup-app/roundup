import { createSignal, type Accessor } from "solid-js";
import type { ActivationSource } from "../keys/registry";
import { holdMount } from "./mountHold";

type Creation = { kind: "todo" | "pad" | "terminal"; home: string };

/** The Shelf tab a request lands on. */
export type ShelfRequest = (tab: "todos" | "pads") => void;

/** Per-Project view state: the views stacked in the centre, the Made selection, the Pads destination and the pending creation request. */
export type ProjectView = {
  /** The creation requested and not yet taken; a Todos or Pads list that mounts after the request still takes it. */
  creation: Accessor<Creation | null>;
  /** Opens the Shelf for a Todo or Pad, where the request is made; a terminal request leaves it. */
  createIn: (kind: Creation["kind"], home: string) => void;
  finishCreation: () => void;
  /** U4457: the Agent whose Pads group the Shelf is asked to show, until the Pads tab has taken it. */
  padsRequest: Accessor<string | null>;
  padsOwner: Accessor<string | null>;
  showPadsOf: (agent: string, tab?: "todos") => void;
  padsTab: Accessor<"pads" | "todos">;
  finishPadsRequest: () => void;
  view: Accessor<string | null>;
  hasView: (view: string) => boolean;
  /** U8005a: how the latest view change was asked for, so what it moves slides at the key or the pointer duration. */
  viewSource: () => ActivationSource;
  hideView: (view: string, source?: ActivationSource) => void;
  showView: (view: string | null, source?: ActivationSource) => void;
  /** U6249c2: the published Deliverable the Made panel marks as chosen; a link sets it, and the panel's own opens do. */
  madeSelected: Accessor<string | null>;
  selectMade: (id: string | null) => void;
};

export const createProjectView = (selected: Accessor<string | null>, openShelf: ShelfRequest = () => {}): ProjectView => {
  const [creation, setCreation] = createSignal<Creation | null>(null);
  const [padsRequest, setPadsRequest] = createSignal<string | null>(null);
  const [padsDestination, setPadsDestination] = createSignal<{ agent: string; selection: string | null; tab: "todos" } | null>(null);
  const [views, setViews] = createSignal<readonly string[]>([]);
  let viewSource: ActivationSource = "pointer";
  const [madeSelected, selectMade] = createSignal<string | null>(null);

  const createIn = (kind: Creation["kind"], home: string) => {
    setCreation({ kind, home });

    if (kind !== "terminal") openShelf(kind === "todo" ? "todos" : "pads");
  };

  const showPadsOf = (agent: string, tab: "todos" = "todos") => {
    setPadsDestination({ agent, selection: selected(), tab });
    setPadsRequest(agent);
    openShelf(tab);
  };

  const view = () => views().at(-1) ?? null;

  return {
    creation, createIn, finishCreation: () => setCreation(null),
    padsRequest, padsTab: () => padsDestination()?.tab ?? "todos", finishPadsRequest: () => setPadsRequest(null), showPadsOf,
    padsOwner: () => {
      const destination = padsDestination();

      return destination?.selection === selected() ? destination.agent : null;
    },
    view, hasView: name => views().includes(name),
    viewSource: () => viewSource,
    showView: (name, source = "pointer") => {
      viewSource = source;

      if (name === "changes" && !views().includes(name)) holdMount();

      setViews(previous => name === null ? [] : previous.includes(name) ? previous : [...previous, name]);
    },
    hideView: (name, source = "pointer") => { viewSource = source; setViews(previous => previous.includes(name) ? previous.filter(value => value !== name) : previous); },
    madeSelected, selectMade,
  };
};
