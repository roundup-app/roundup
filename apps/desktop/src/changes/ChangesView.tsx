import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { createEffect, createMemo, createSignal, flush, For, lazy, Loading, onSettled, refresh, Show, untrack } from "solid-js";
import type { ChangedFile } from "@contracts/agent/ChangedFile";
import type { Events } from "../app/events";
import { failureOf } from "../app/failureOf";
import type { AppSeam } from "../app/seam";
import { BlockedFailure, StatusNote } from "../ink/MountedLine";
import { captureFocus, focusTarget, returnFocus } from "../keys/focus";
import { activationSource, registerKeys, type ActivationSource } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { SegmentGroup } from "../ui/SegmentGroup";
import { isDoor } from "../state/doorNode";
import type { ChangeTarget } from "../state/changeTargets";
import { copy } from "./copy";
import { causeOf, createRemoteMain } from "./remote";
import { RemoteChip } from "./RemoteChip";
import { loadReader } from "./chunks";
import { notesFor, type Notes } from "./notes";
import { flowListed, itemNotes, outdatedItem, paneTarget } from "./itemNotes";
import type { ScrollKeys } from "./ModuleScroll";
import { createOpenAt } from "./editor";
import { createLate } from "./late";
import { ChangedTree, moduleKey, noiseKey, noteOnRow } from "./ChangedTree";
import { createFind, FindField } from "./Find";
import { groupLens, lensAfter, LENSES, OVERVIEW, type Lens } from "./lens";
import { createViewed } from "./createViewed";
import { comparisonOf } from "./viewed";
import { ViewedProgress } from "./ViewedProgress";
import { createLanding } from "./landing";
import { noiseOf, type Grouped } from "./modules";
import { Overview } from "./Overview";
import { createCallPaths } from "./callPaths";
import { reachKey, type Reach } from "./owned";
import type { Changed } from "./looseStore";
import { flowFiles, flowName, groupFlows, type Done, type Read } from "./flows";
import { FlowStates } from "./FlowStates";
import { createReadback, spanOf } from "./readback";
import { createReadbackPad } from "./readbackPad";
import { createExplanations } from "./explain";
import { createFindings } from "./findings";
import { fileRanks, rankWord, withRisks } from "./rank";
import { ItemAccount } from "./ReadbackBlock";
import { ChangedSymbols } from "./ChangedSymbols";
import { createRepeatScan, placeCounts } from "./repeats";
import { createSpots, sourceCounts } from "./spots";
import { RepeatStates, SpotStates } from "./RepeatStates";
import type { OwnedGroupKey } from "@contracts/agent/OwnedGroupKey";
import { createChangedLines } from "./looseStore";
import { createMoves } from "./moveStore";
import { MoveStates } from "./MoveStates";
import type { DiffKeys } from "./DiffReader";
import { createJump } from "./NoteBatch";
import { ChartContext, type ChartView, noChart } from "./chart";
import "./styles.css";

const ModuleScroll = lazy(() => loadReader().then(module => ({ default: module.ModuleScroll })));

/** U7674b: the shown listing's totals; a `null` count adds nothing. */
const totalsOf = (files: readonly ChangedFile[]) => files.reduce((sum, file) => ({ added: sum.added + (file.counts?.added ?? 0), removed: sum.removed + (file.counts?.removed ?? 0) }), { added: 0, removed: 0 });

/** U7675c, U7679c: the row after `gone` in `before` that `list` still holds, else the nearest one before it; a module's is a module or the Overview, never a noise file. */
const neighbourOf = (before: readonly string[], list: readonly string[], gone: string) => {
  const pool = gone.startsWith("n:") ? before : before.filter(each => !each.startsWith("n:"));
  const at = pool.indexOf(gone);

  return pool.slice(at + 1).find(each => list.includes(each)) ?? pool.slice(0, at).reverse().find(each => list.includes(each));
};

/** U7675c, U7679c: the open item that leaves the listing: its name until the reader acts, and `leave` told its neighbour in tree order. */
const createLeaving = (watch: () => { list: string[]; key: string }, open: () => string | undefined, leave: (neighbour: string | undefined) => void) => {
  const [left, setLeft] = createSignal<string>();
  let before: string[] = [];
  let source = "";

  createEffect(watch, ({ list, key }) => {
    const chosen = untrack(open);
    const was = chosen !== undefined && before.includes(chosen) ? chosen : undefined;
    const gone = key === source && was !== undefined && !list.includes(was) ? was : undefined;

    if (gone !== undefined) {
      // The Overview leaves only with the last file: the view's empty state shows, and the view takes focus.
      if (gone !== OVERVIEW) setLeft(gone);
      leave(neighbourOf(before, list, gone));
    } else if (key !== source) setLeft(undefined);

    source = key;
    before = list;
  });

  return [left, setLeft] as const;
};

type KeyActions = { jump: () => void; stop: (direction: 1 | -1) => void; readback: () => void; viewed: () => void; step: (direction: 1 | -1) => void; lens: (step: 1 | -1) => void; find: () => void; enter: () => void; noteRow: () => void; diff: () => DiffKeys | undefined; toggleHelp: () => void; open: (path: string, at: { side: "old" | "new"; line: number }) => void };

const registerChangesKeys = (section: () => HTMLElement | undefined, actions: KeyActions) => registerKeys({ kind: "region", element: section }, [
  { chords: ["j"], when: event => !typing(event), run: event => { event.preventDefault(); actions.step(1); } },
  { chords: ["k"], when: event => !typing(event), run: event => { event.preventDefault(); actions.step(-1); } },
  { chords: ["l"], when: event => !typing(event), run: event => { event.preventDefault(); actions.lens(1); } },
  { chords: ["Shift+l"], when: event => !typing(event), run: event => { event.preventDefault(); actions.lens(-1); } },
  { chords: ["/"], when: event => !typing(event), run: event => { event.preventDefault(); actions.find(); } },
  { chords: ["]"], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.step(1); } },
  { chords: ["["], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.step(-1); } },
  { chords: ["v"], when: event => !typing(event), run: event => { event.preventDefault(); actions.viewed(); } },
  { chords: ["x"], when: event => !typing(event), run: event => { event.preventDefault(); actions.diff()?.reveal(); } },
  { chords: ["n"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.note(); } },
  { chords: ["w"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.explain("words"); } },
  { chords: ["d"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.explain("diagram"); } },
  { chords: ["n"], when: event => inTree(event), run: event => { event.preventDefault(); actions.noteRow(); } },
  { chords: ["e"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.edit(); } },
  { chords: ["Delete", "Backspace"], when: event => inDiff(event), run: event => { event.preventDefault(); actions.diff()?.remove(); } },
  { chords: ["Enter"], when: event => onContent(event), run: event => {
    event.preventDefault();

    const at = actions.diff()?.at();

    if (at) actions.open(at.path, at);
  } },
  { chords: ["g"], when: event => !typing(event), run: event => { event.preventDefault(); actions.jump(); } },
  { chords: ["r"], when: event => !typing(event), run: event => { event.preventDefault(); actions.readback(); } },
  { chords: ["ArrowLeft"], when: event => onDiagram(event), run: event => { event.preventDefault(); actions.stop(-1); } },
  { chords: ["ArrowRight"], when: event => onDiagram(event), run: event => { event.preventDefault(); actions.stop(1); } },
  { chords: ["?", "Shift+?"], when: event => !typing(event), run: event => { event.preventDefault(); actions.toggleHelp(); } },
  { chords: ["Tab"], when: event => event.target instanceof Element && event.target.closest(".changes-tree") !== null, run: event => { event.preventDefault(); actions.enter(); } },
]);

/** The targets a comparison can end on: a Tree and a Branch only for an Agent with a Worktree. */
const segmentsOf = (hasWorktree: boolean): { value: ChangeTarget; label: string }[] => [
  ...hasWorktree ? [{ value: "tree" as const, label: copy.targetTree }, { value: "branch" as const, label: copy.targetBranch }] : [],
  { value: "changes", label: copy.changes },
];

/** A repository's name in the Project: its folder relative to the Project's root, else its own folder name; never an absolute path. */
const nameOf = (repo: string, root: string) => repo.startsWith(`${root}/`) ? repo.slice(root.length + 1) : repo.split("/").filter(Boolean).at(-1) ?? repo;

/** U7676b: N, E and Delete act on the focused diff, never while a field or the editor holds the key. */
const inDiff = (event: KeyboardEvent) => !typing(event) && event.target instanceof Element && event.target.closest(".diff-reader") !== null;

/** U7703c: Left and Right step the diagram only while the figure itself holds focus. */
const onDiagram = (event: KeyboardEvent) => !typing(event) && event.target instanceof Element && event.target.matches(".readback-diagram");

/** U7691a: N on a list row notes its module, flow or file. */
const inTree = (event: KeyboardEvent) => !typing(event) && event.target instanceof Element && event.target.closest(".changes-tree") !== null;

/** U7678c: Enter acts on the diff's own text, never on a field, button or link inside the reader. */
const onContent = (event: KeyboardEvent) => !typing(event) && event.target instanceof Element && event.target.closest(".diff-content") !== null && event.target.closest("button, a") === null;

const typing = (event: KeyboardEvent) => event.target instanceof Element && event.target.closest("input, textarea, [contenteditable]:not([contenteditable=false])") !== null;

type Memory = ReturnType<ReturnType<typeof useConnectedProject>["changePlaces"]["of"]>;

/** U7675f, U7678c, U7679a: each file's place, and each module's scroll, kept in the connection's memory; `at` names a place's key, by lens for a module's and plain for a noise file's. */
const placesOf = (memory: Memory, at: (key: string) => string) => ({
  places: {
    get: (file: string) => memory.places.get(at(file)),
    set: (file: string, place: NonNullable<ReturnType<typeof memory.places.get>>) => { memory.places.set(at(file), place); },
  },
  scroll: (key: string) => ({
    get: () => memory.places.get(at(key))?.scroll,
    set: (top: number) => { memory.places.set(at(key), { revision: "", scroll: top, selection: { side: "new", start: 1, end: 1 } }); },
  }),
});

/** A pane's `lens` is the one its item was opened in, and none for a noise file, the same diff in every lens. The Overview is a pane and holds no scroll. */
/** U8009c: each tab with the items its lens lists, the Overview and the noise rows not counted; the segments stay the same objects and their label follows the count, so a count changing never remounts a tab. */
const lensSegmentsOf = (props: { countOf: (lens: Lens) => number }) => LENSES.map(value => {
  const count = createMemo(() => props.countOf(value));

  return { value, get label() { return copy.tabCount(copy.lenses[value], count()); }, content: <>{copy.lenses[value]}<span class="changes-tab-count">{count()}</span></> };
});

const LensTabs = (props: { countOf: (lens: Lens) => number; lens: Lens; onSwitch: (lens: Lens) => void }) => {
  const segments = lensSegmentsOf(props);

  return <>
    <SegmentGroup label={copy.lens} segments={segments} value={props.lens} onValueChange={props.onSwitch} />
    <p class="changes-lens-line">{copy.lensLines[props.lens]}</p>
  </>;
};

/** U7679a: a place's key in the memory: by lens for a file and a module's scroll, plain for a noise file, the same in every lens. */
const placeAt = (each: Lens) => (key: string) => key.startsWith("n:") || noiseOf(key) !== undefined ? key : `${each}|${key}`;

type Pane = { key: string; lens: Lens | undefined; source: string };

const lensOf = (pane: Pane): Lens => pane.lens ?? "modules";

/** U7674e: the module that was open stays until the next one's first screen has painted. A module of another comparison is another scroll, though it keeps its name. */
const createPanes = (opened: () => string | undefined, lens: () => Lens, source: () => string) => {
  const view = createMemo(() => {
    const key = opened();

    return key === undefined ? undefined : { key, lens: key.startsWith("n:") ? undefined : lens(), source: source() };
  }, { equals: (a, b) => a?.key === b?.key && a?.lens === b?.lens && a?.source === b?.source });

  const [panes, setPanes] = createSignal<Pane[]>([]);

  createEffect(view, next => { if (next) setPanes(list => list.includes(next) ? list : [...list, next]); });

  return { panes, ready: (pane: Pane) => setPanes(list => list.includes(pane) && list.at(-1) !== list[0] ? list.slice(list.indexOf(pane)) : list) };
};

/** Escape closes the keys list first, then the find, else the view unless a note field holds it. */
const escapeKey = (event: KeyboardEvent, help: boolean, setHelp: (on: boolean) => void, finding: boolean, closeFind: () => void, close: (source: ActivationSource) => void) => {
  if (event.key !== "Escape" || event.defaultPrevented || typing(event)) return;

  if (help) setHelp(false); else if (finding) closeFind(); else close("key");
};

/** U7672d: the Agent's Worktree and the compare target its remembered pick names. */
const createTarget = (id: () => string) => {
  const { rail, changeTargets } = useConnectedProject();

  // Read live, not through the keyed Agent: losing or regaining the Worktree must not remount the view and its open note form.
  const worktree = () => {
    const node = rail.nodes.find(candidate => candidate.id === id());

    return node && isDoor(node) ? node.worktree?.path ?? null : null;
  };

  // U7672d: a remembered Tree or Branch for an Agent without a Worktree of its own falls back to Changes.
  const target = (): ChangeTarget => {
    const chosen = changeTargets.read(id());

    return chosen !== "changes" && worktree() === null ? "changes" : chosen;
  };

  const own = (): "tree" | "branch" | null => {
    const chosen = target();

    return chosen === "changes" ? null : chosen;
  };

  return { worktree, target, own };
};

/** U7853a: the Agent's owned groups, the open one, and the open one's identity: stable while a refresh brings the same repository and branch. */
const createOwnedGroup = (id: () => string) => {
  const { owned } = useConnectedProject();

  const groups = () => {
    const read = owned.read(id());

    return read?.failure === null ? read.groups : [];
  };

  const [active, setActive] = createSignal(0);
  const group = () => groups()[active()] ?? groups()[0];

  const groupKey = createMemo(() => { const open = group();

    return open && { repo: open.repo, branch: open.branch }; }, { equals: (a, b) => a?.repo === b?.repo && a?.branch === b?.branch });

  return { groups, active, setActive, group, groupKey };
};

type Analyses = { app: AppSeam; events: Events; id: string; agent: () => string; own: () => "tree" | "branch" | null; files: () => readonly ChangedFile[]; ready: () => boolean; lens: () => Lens; group: () => OwnedGroupKey | undefined; kept: Parameters<typeof createFindings>[0]["kept"]; notes: Notes };

/** U7683b, U7685c, U7685d: what the Daemon reads out of the listing once it is ready: the call paths, which a new `to` asks again; and the repeat scan, which compares the working tree, so only the Tree target asks, after a frame has painted. Each item's repeats come from the lens's own listing, never as a find narrows it. */
const createAnalyses = (input: Analyses) => {
  const at = createMemo((): Reach | null => {
    const own = input.own();
    const group = input.group();

    return own ? { to: own } : group ? { group } : null;
  }, { equals: (a, b) => reachKey(a) === reachKey(b) });

  const calls = createCallPaths({ app: input.app, events: input.events, id: input.id, at, ready: input.ready });
  const readback = createReadback({ app: input.app, events: input.events, id: input.id, at, ready: input.ready });
  const pad = createReadbackPad({ id: input.id, agent: input.agent, readback, at });
  const changed = createChangedLines({ app: input.app, id: input.id, to: () => input.own() ?? "tree", group: input.group, files: () => input.lens() === "flows" && !readback.read() ? flowFiles(input.files(), calls.done()) : [] });
  const lensed = createLensed(input.files, calls.done, readback.read, changed);
  const repeats = createRepeatScan({ app: input.app, events: input.events, id: input.id, on: () => input.own() === "branch" ? null : at(), ready: input.ready });
  const spots = createSpots({ app: input.app, events: input.events, id: input.id, on: () => input.own() === "tree" || input.group() !== undefined, ready: input.ready, group: input.group });
  const spotted = createMemo(() => [...repeats.spots(), ...spots.list()]);
  const gapTotals = createMemo(() => placeCounts(lensed()(input.lens()), readback.placed().map(spanOf)));
  // U7696a: the Logic lens's moves; a repeat whose lines moved is not also counted a repeat (U7696e).
  const moves = createMoves({ app: input.app, id: input.id, to: () => input.own() ?? "tree", group: input.group, on: () => input.lens() === "logic" && input.files().length > 0, symbols: () => calls.done().flatMap(answer => answer.symbols) });
  const repeatTotals = createMemo(() => placeCounts(lensed()(input.lens()), repeats.spots().filter(spot => !moves.covers(spot))));
  const spotTotals = createMemo(() => sourceCounts(lensed()(input.lens()), spots.list()));
  const moveTotals = createMemo(() => placeCounts(lensed()(input.lens()), moves.placed()));
  // U7700a: the defect pass is asked only by the user; its signature is the listing's files and their blob ids (U7700b).
  const findings = createFindings({ app: input.app, id: input.id, at, grouped: () => lensed()(input.lens()), signature: () => input.files().map(file => `${file.path}:${file.blob}`).sort().join("\n"), kept: input.kept, notes: input.notes });

  return { at, calls, lensed, repeats, repeatTotals, spots, spotted, spotTotals, moves, moveTotals, readback, pad, gapTotals, findings, again: () => { calls.reset(); repeats.again(); spots.again(); readback.again(); } };
};

/** U7675a: the comparison's own answer, whichever read made it: the Daemon's changes for a Tree or Branch target, else the Agent's owned changes. */
const createComparison = (id: () => string, own: () => "tree" | "branch" | null, groupFiles: () => readonly ChangedFile[] | undefined) => {
  const { app, owned } = useConnectedProject();

  const [listed] = createSignal<{ failure: string | null; files: ChangedFile[] } | undefined>(async () => {
    const to = own();

    if (!to) return undefined;
    let files: ChangedFile[] = [];
    const failure = await failureOf(async () => { files = (await app.rpc("agent.changedFiles", { id: id(), to })).files; });

    return { failure, files };
  }, { loadingValue: undefined });

  const files = (): readonly ChangedFile[] => own() ? listed()?.files ?? [] : groupFiles() ?? [];
  const pending = () => own() ? listed() === undefined : owned.read(id()) === undefined;
  const failure = () => own() ? listed()?.failure ?? null : owned.read(id())?.failure ?? null;
  const late = createLate(pending);

  // The Daemon names a Worktree whose folder is gone with `worktree_missing` (code NOT_FOUND); any other failure keeps its own cause.
  const missing = () => (failure() ?? "").startsWith("worktree_missing");
  const [checked, setChecked] = createSignal(false);
  let asked = false;

  createEffect(() => own() ? listed() : owned.read(id()), () => {
    if (asked) setChecked(true);
    asked = false;
  });

  const reload = () => own() ? refresh(listed) : owned.refresh(id());

  const retry = () => {
    asked = true;
    void reload();
  };

  return { files, pending, failure, late, missing, checked, retry, reload };
};

/** U7679a, U7679b, U7683c, U7689: each lens's rows, made once for the listing; Flows draws the finished traces and the readback's names and flows. */
const createLensed = (files: () => readonly ChangedFile[], traced: () => readonly Done[], read: () => Read | undefined, changed: () => ReadonlyMap<string, Changed>) => createMemo(() => {
  const all = files();
  const done = traced();
  const readback = read();
  const ranks = fileRanks(readback?.account);
  const lines = changed();
  const made = new Map<Lens, Grouped>();

  return (each: Lens): Grouped => {
    const hit = made.get(each) ?? (each === "flows" ? groupFlows(all, done, readback, lines) : withRisks(groupLens(all, each, ranks), readback?.account, readback?.stale ?? false));

    made.set(each, hit);

    return hit;
  };
});

/** U7675e, U7679e: the keys the view answers to. */
const KeysHelp = () => <section class="changes-keys" aria-label={copy.keys}>
  <ul>
    <For each={copy.keysList}>{what => <li>{what}</li>}</For>
  </ul>
</section>;

// U7697a: the rank word of each file the readback ranked, drawn only where the rank order is in force.
const rankWords = (account: Parameters<typeof fileRanks>[0], listed: readonly ChangedFile[]) => {
  const ranks = fileRanks(account);

  return new Map(listed.flatMap(file => {
    const word = rankWord(ranks, file.path);

    return word ? [[file.path, word] as const] : [];
  }));
};

/** U7186c, U7672c: the centre's diff of what one Agent owns, from the remote's main to the switch's value. */
const Surface = (props: { id: string; name: string }) => {
  const { app, events, hideView, showView, project, drafts, changeTargets, changePlaces } = useConnectedProject();
  const notes = notesFor(app, project.path, drafts);
  const { worktree, target, own } = createTarget(() => props.id);

  const { groups, active, setActive, group, groupKey } = createOwnedGroup(() => props.id);

  // U7675d, U7675f: the open file and each file's place outlive the view for the connection's session.
  const memory = changePlaces.of(untrack(() => props.id));
  const [picked, setPicked] = createSignal<string | undefined>(memory.open);
  const [start, setStart] = createSignal<string>();
  const [lens, setLens] = createSignal<Lens>(memory.lens);

  const { files, pending, failure, late, missing, checked, retry, reload } = createComparison(() => props.id, own, () => group()?.files);

  const { at, calls, lensed, repeats, repeatTotals, spots, spotted, spotTotals, moves, moveTotals, readback, pad, gapTotals, findings, again } = createAnalyses({ app, events, id: untrack(() => props.id), agent: () => props.name, own, files, ready: () => !pending() && failure() === null && files().length > 0, lens, group: () => own() ? undefined : groupKey(), kept: memory.found, notes });

  const explain = createExplanations({ app, id: untrack(() => props.id), at, kept: memory.explained, read: () => readback.account()?.explanations ?? [] });

  const dimmed = createMemo(() => new Set(calls.dim().flatMap(answer => answer.flows.map(flow => moduleKey(flowName(flow.entry))))));

  const listing = () => lensed()(lens());

  // U7678a, U8010b: the rows that open something, in list order: each module, then each noise file; none with no file listed.
  const rowsOf = (each: Grouped) => files().length === 0 ? [] : [...each.modules.map(module => moduleKey(module.name)), ...each.noise.flatMap(noise => noise.files.map(file => noiseKey(file.path)))];

  const rows = () => rowsOf(listing());

  // U7680: the marks the landing and the header read; its callbacks run only after the view has made `opened` and the list.
  const viewed = createViewed({ memory, comparison: () => comparisonOf(target(), own() ? undefined : groupKey()), files, settled: () => !pending() && failure() === null, lensed, lens, opened: () => opened(), open: next => { setLens(next.lens); choosePath(next.key); flush(); focusTree(next.key); } });

  const opened = createLanding({ signature: () => `${target()}|${active()}|${comparisonOf(target(), own() ? undefined : groupKey())}|${lens()}|${rows().join("\0")}`, rows, modules: () => listing().modules, viewedKeys: () => viewed.viewedKeys(), picked, setPicked });

  const { panes, ready } = createPanes(opened, lens, () => `${target()}|${active()}`);

  const itemOf = (key: string, each: Lens) => lensed()(each).modules.find(module => moduleKey(module.name) === key);

  const openFiles = (key: string, each: Lens): readonly ChangedFile[] => key.startsWith("m:") ? itemOf(key, each)?.files ?? [] : files().filter(file => noiseKey(file.path) === key);

  createEffect(opened, file => { memory.open = file; });

  createEffect(lens, each => { memory.lens = each; });

  // U7693c: only the Fetch click lists again and reads the open file again, once, after the list answers.
  let diffKeys: ScrollKeys | undefined;

  const remote = createRemoteMain(app, untrack(() => props.id), () => !pending(), () => {
    void reload().then(() => {
      again();
      diffKeys?.reload();
    });
  });

  const toLabel = () => target() === "tree" ? copy.targetTree : target() === "branch" ? copy.targetBranch : copy.changes;

  const empty = () => !pending() && failure() === null && files().length === 0;

  // U7675c: the open file that leaves says so, and focus moves to its neighbour in tree order, else to the view.
  let section: HTMLElement | undefined;
  let focusTree = (_path: string) => {};

  let treeFocus = (): string | undefined => undefined;

  const [left, setLeft] = createLeaving(() => ({ list: rows(), key: `${target()}|${active()}|${lens()}` }), picked, neighbour => {
    setPicked(neighbour);
    setStart(undefined);
    // The tree's focus choice below reads the open module: settle the write first.
    flush();

    if (neighbour) focusTree(neighbour); else section?.focus();
  });

  // U7683e: Enter on a call opens its section again even when it was the last one opened.
  const openSection = (section: string) => {
    setStart(undefined);
    flush();
    setStart(section);
  };

  const choosePath = (key: string, file?: string) => {
    if (key !== untrack(opened)) setLeft(undefined);
    setPicked(key);
    setStart(file);
  };

  const find = createFind({ files, listing, opened, view: () => section, focusTree: key => focusTree(key), treeFocus: () => treeFocus(), choose: choosePath });

  const totals = () => totalsOf(files());

  // U2539d: a file that still exists opens in the editor at its line, from the checkout the comparison ends on; a failed open shows as one card.
  const openAt = createOpenAt(app, () => own() ? worktree() ?? undefined : group()?.checkout, files);

  // U7675e, U8010c: J and K step the items from anywhere, wrapping, ] and [ step changes, Tab crosses from the list to the diff or the Overview's entries, ? lists them.
  const [help, setHelp] = createSignal(false);

  const step = (direction: 1 | -1) => {
    const order = find.grouped().modules.map(module => moduleKey(module.name));
    const at = order.indexOf(opened() ?? "");
    const next = at !== -1 ? order[(at + direction + order.length) % order.length] : order[direction === 1 ? 0 : order.length - 1];

    if (next === undefined) return;
    choosePath(next);
    focusTree(next);
  };

  // U7679a, U8010a: a lens keeps the open item it lists and else lands on its own.
  const switchLens = (next: Lens) => {
    if (next === lens()) return;

    const inList = document.activeElement?.closest(".changes-tree") != null;
    const chosen = picked();

    if (chosen !== undefined && chosen !== OVERVIEW && !rowsOf(lensed()(next)).includes(chosen)) setPicked(undefined);
    setStart(undefined);
    setLens(next);
    flush();

    if (inList) focusTree(opened() ?? OVERVIEW);
  };

  // U7679c: Tab from the list goes to the Overview's first entry, else to the diff.
  const enter = () => {
    if (opened() === OVERVIEW) section?.querySelector<HTMLElement>(".changes-overview [data-entry]")?.focus(); else diffKeys?.focus();
  };

  // U7690c, U7679b: a note's file opens in its module's scroll, at that file, in the open lens when it lists the file, else in Modules; a noise file opens alone.
  const openPath = (path: string) => {
    const inModule = (each: Lens) => lensed()(each).modules.find(module => module.files.some(file => file.path === path));
    const here = inModule(lens());
    const module = here ?? inModule("modules");
    const key = noiseOf(path) === undefined && module ? moduleKey(module.name) : noiseKey(path);

    if (noiseOf(path) === undefined && !here && module) switchLens("modules");

    if (rowsOf(lensed()(lens())).includes(key)) choosePath(key, path);
  };

  const jump = createJump({ id: untrack(() => props.id), notes, files, keys: () => diffKeys, itemOutdated: note => outdatedItem(note, files(), item => flowListed(item, { traced: calls.done().length > 0, read: readback.read() !== undefined }, () => lensed()("flows").modules)), section: () => section, open: openPath });

  registerChangesKeys(() => section, { jump: jump.open, stop: readback.stepper.go, readback: readback.start, viewed: viewed.markOpen, step, lens: change => switchLens(lensAfter(lens(), change)), find: find.open, enter, noteRow: () => noteOnRow(treeFocus(), listing().modules, opened(), diffKeys), diff: () => diffKeys, toggleHelp: () => setHelp(on => !on), open: openAt });

  // U7675f: closing returns focus to the Rail icon.
  const iconId = untrack(() => props.id);

  const close = (source: ActivationSource = "pointer") => {
    hideView("changes", source);
    returnFocus(focusTarget(`changes.icon.${iconId}`) ?? null);
  };

  const choose = (value: ChangeTarget) => {
    changeTargets.choose(props.id, value);
    setPicked(undefined);
  };

  const onKeyDown = (event: KeyboardEvent) => escapeKey(event, help(), setHelp, find.finding(), find.close, close);

  // Opening moves focus into the view, so Escape reaches its handler before any file does; the tree takes it when it draws.
  const initialFocus = captureFocus();

  onSettled(() => { initialFocus(() => section?.focus()); });

  return <section class="changes-view" aria-label={copy.changes} tabindex="-1" onKeyDown={onKeyDown} ref={element => { section = element; }}>
    <header class="changes-head">
      <span class="changes-name">{props.name}</span>
      <span class="changes-from"><span>{copy.compareFrom}</span> {copy.remoteMain}</span>
      <Show when={remote.chip()}>{chip => <RemoteChip chip={chip()} fetch={remote.fetch} retry={remote.retry} />}</Show>
      <Show when={worktree() !== null} fallback={<span class="changes-to"><span>{copy.compareTo}</span> <span class="changes-to-value">{copy.changes}</span></span>}>
        <SegmentGroup label={copy.compareTo} segments={segmentsOf(worktree() !== null)} value={target()} onValueChange={choose} />
      </Show>
      <span class="changes-totals">{copy.changedFiles(files().length)} {copy.addedLines(totals().added)} {copy.removedLines(totals().removed)}</span>
      <ViewedProgress id={props.id} name={props.name} viewed={viewed.progress().viewed} total={viewed.progress().total} notes={notes} />
      <IconButton aria-label={copy.overview} data-home="true" aria-pressed={opened() === OVERVIEW ? "true" : "false"} onClick={() => { choosePath(OVERVIEW); flush(); section?.querySelector<HTMLElement>(".changes-overview [data-entry]")?.focus(); }}><Icon name="home" /></IconButton>
      <IconButton aria-label={copy.closeChanges} onClick={event => close(activationSource(event))}><Icon name="x" /></IconButton>
    </header>
    <Show when={remote.chip()}>{chip => <Show when={causeOf(chip()) !== ""}><p class="changes-remote-cause">{causeOf(chip())}</p></Show>}</Show>
    <Show when={failure() !== null}>
      <BlockedFailure message={missing() ? copy.folderGone(props.name) : `${copy.compareFailed(copy.remoteMain, toLabel())}: ${failure()}`} recover={{ run: retry }} />
      <StatusNote text={missing() && checked() ? copy.stillMissing : null} />
    </Show>
    <StatusNote text={pending() && late() ? copy.comparing : empty() ? own() === "tree" ? copy.folderMatches(props.name, copy.remoteMain) : copy.noChangesAgainst(copy.remoteMain) : null} />
    <Show when={left()}>{gone => <StatusNote text={copy.fileGone(gone().slice(2), copy.remoteMain)} />}</Show>
    <Show when={help()}><KeysHelp /></Show>
    {jump.list()}
    <div class="changes-body">
      <div class="changes-side">
        <Show when={groups().length > 1 && !own()}>
          <ul class="changes-groups" aria-label={copy.changeGroups}>
            <For each={groups()}>{(each, index) => <li><button type="button" data-button="quiet" aria-pressed={group() === each ? "true" : "false"} onClick={() => { setActive(index()); setPicked(undefined); }}>{copy.groupLabel(nameOf(each.repo, project.path), each.branch)}</button></li>}</For>
          </ul>
        </Show>
        <Show when={files().length > 0}>
          <LensTabs countOf={each => lensed()(each).modules.length} lens={lens()} onSwitch={switchLens} />
          <Show when={lens() === "flows"}><FlowStates calls={calls} readback={readback} /></Show>
          <RepeatStates scan={repeats} notAsked={own() === "branch"} /><SpotStates spots={spots} />
          <Show when={lens() === "logic"}><MoveStates moves={moves} /></Show>
          <FindField find={find} />
          <ChangedTree grouped={find.grouped()} lens={lens()} finding={find.letters() !== ""} itemNotes={itemNotes(notes.all(props.id))} viewed={viewed.viewedKeys()} changed={viewed.changedKeys()} dimmed={lens() === "flows" ? dimmed() : undefined} repeats={repeatTotals()} sources={spotTotals()} gaps={gapTotals()} findings={findings.totals()} moved={lens() === "logic" ? moveTotals() : undefined} readHint={readback.offered()} selected={opened()} controls={controls => { focusTree = controls.focus; treeFocus = controls.focused; }} onChoose={choosePath} onEdit={openAt} />
          <Show when={find.letters() !== "" && find.grouped().modules.length === 0 && find.grouped().noise.length === 0}><p class="changes-nomatch">{copy.noFileMatches(find.letters(), copy.lenses[lens()])}</p></Show>
        </Show>
      </div>
      <For each={panes()}>{pane => {
        const { places, scroll } = placesOf(memory, placeAt(lensOf(pane)));

        return <div class="module-slot" data-pending={panes().length > 1 && panes().at(-1) === pane ? "true" : "false"}>
          <Show when={pane.key === OVERVIEW} fallback={<Loading><ModuleScroll id={props.id} name={props.name} files={openFiles(pane.key, lensOf(pane))} sections={itemOf(pane.key, lensOf(pane))?.sections} above={<Show when={itemOf(pane.key, lensOf(pane))} keyed>{item => <><ItemAccount item={item} lens={lensOf(pane)} readback={readback} open={openSection} /><Show when={lensOf(pane) === "logic"}><ChangedSymbols item={item} calls={calls} moves={moves} aim={jump.aimAt} /></Show></>}</Show>} start={start()} item={paneTarget(itemOf(pane.key, lensOf(pane)), openFiles(pane.key, lensOf(pane))[0])} itemOutdated={jump.itemOutdated} target={jump.aim()} arrived={jump.arrived} scroll={scroll(pane.key)} places={places} keys={api => { if (panes().at(-1) === pane) diffKeys = api; }} onReady={() => ready(pane)} to={own() ?? "tree"} group={own() ? undefined : groupKey()} viewed={viewed.head(pane.key, lensOf(pane))} notes={notes} recover={() => showView("notes")} open={openAt} spots={spotted()} gaps={readback.placed()} explain={explain} findings={findings} ranks={lensOf(pane) === "flows" ? undefined : rankWords(readback.account(), files())} moves={lensOf(pane) === "logic" ? moves : undefined} /></Loading>}>
            <Overview spots={spots.list()} lens={lensOf(pane)} grouped={lensed()(lensOf(pane))} readback={readback} pad={pad} agent={props.name} listed={path => files().some(file => file.path === path)} go={gap => openPath(gap.path)} findings={findings} goFile={openPath} choose={key => { choosePath(key); flush(); focusTree(key); }} back={() => section?.querySelector<HTMLElement>("[data-home]")?.focus()} ready={() => { diffKeys = undefined; ready(pane); }} />
          </Show>
        </div>;
      }}</For>
    </div>
  </section>;
};

/** U7186c: mounted over the centre while the Changes view is open for the selected Agent. */
export const ChangesView = (props: { chart?: ChartView }) => {
  const { rail, hasView } = useConnectedProject();

  const agent = createMemo(() => {
    const node = rail.nodes.find(candidate => candidate.id === rail.selected());

    return node?.kind === "agent" ? { id: node.id, name: node.name } : null;
  }, { equals: (a, b) => a?.id === b?.id && a?.name === b?.name });

  return <ChartContext value={props.chart ?? noChart}>
    <Show when={hasView("changes") ? agent() : null} keyed>{each => <Loading><Surface id={each.id} name={each.name} /></Loading>}</Show>
  </ChartContext>;
};
