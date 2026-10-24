import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements, monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter";
import { attachInstruction, extractInstruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import type { AppSeam, FileDrop } from "../app/seam";
import type { SortableMove } from "../ui/sortable";
import "./nativeDragProbe.css";

type Row = { id: string; parent: string | null };

type Result = { moves: SortableMove[]; cancelled: number; clicks: number; trustedStarts: number };

export type NativeDragReport = Result & { probe: "roundup-native-drag-compatibility"; exit: 2; files: FileDrop[] };

/** U3800: native compatibility only. This probe selects no library and supplies no timing verdict. */
export const NativeDragProbe = (props: { finish?: (result: Result) => void; files?: readonly FileDrop[] } = {}) => {
  const [rows, setRows] = createSignal<Row[]>([{ id: "A", parent: null }, { id: "B", parent: null }, { id: "C", parent: null }]);
  const [moves, setMoves] = createSignal<SortableMove[]>([]);
  const [dragged, setDragged] = createSignal<string | null>(null);
  const [cancelled, setCancelled] = createSignal(0);
  const [clicks, setClicks] = createSignal(0);
  const [starts, setStarts] = createSignal(0);
  const [target, setTarget] = createSignal<string | null>(null);

  onMount(() => {
    onCleanup(monitorForElements({
      canMonitor: ({ source }) => source.data.nativeProbe === true,
      onDragStart: ({ source }) => {
        setDragged(rows().find(row => row.id === source.data.id)?.id ?? null);
      },
      onDropTargetChange: ({ location }) => {
        const next = location.current.dropTargets[0];

        setTarget(rows().find(row => row.id === next?.data.id)?.id ?? null);
      },
      onDrop: ({ source, location }) => {
        const over = location.current.dropTargets[0];
        const instruction = over && extractInstruction(over.data);
        const own = rows().find(row => row.id === source.data.id);
        const anchor = rows().find(row => row.id === over?.data.id);

        setDragged(null);
        setTarget(null);

        if (!own || !anchor || !instruction || instruction.type === "instruction-blocked") {
          setCancelled(count => count + 1);

          return;
        }

        const id = own.id;
        const parent = instruction.type === "make-child" ? anchor.id : anchor.parent;
        const remaining = rows().filter(row => row.id !== id);
        const siblings = remaining.filter(row => row.parent === parent);
        const index = instruction.type === "make-child" ? 0 : siblings.findIndex(row => row.id === anchor.id) + (instruction.type === "reorder-below" ? 1 : 0);
        const before = rows().filter(row => row.parent === own.parent).findIndex(row => row.id === id);

        if (own.parent === parent && before === index) return;

        const insertion = instruction.type === "make-child" ? remaining.indexOf(anchor) + 1
          : instruction.type === "reorder-below" ? remaining.findLastIndex(row => row.id === anchor.id || row.parent === anchor.id) + 1
          : remaining.indexOf(anchor);

        remaining.splice(insertion, 0, { id, parent });
        setRows(remaining);
        setMoves(previous => [...previous, { id, parent, index }]);
      },
    }));
  });

  const row = (element: HTMLDivElement, entry: Row) => {
    const handle = element.querySelector("button");

    if (!handle) throw new Error("the native probe row has no handle");

    onMount(() => {
      const indent = parseFloat(getComputedStyle(element).getPropertyValue("--space-5"));

      onCleanup(combine(
        draggable({
          element, dragHandle: handle,
          canDrag: () => entry.id !== "C",
          getInitialData: () => ({ id: entry.id, nativeProbe: true }),
        }),
        dropTargetForElements({
          element,
          canDrop: ({ source }) => source.data.nativeProbe === true && source.data.id !== entry.id,
          getData: ({ input }) => attachInstruction({ id: entry.id }, {
            element, input, currentLevel: entry.parent === null ? 0 : 1, indentPerLevel: indent, mode: "standard",
            block: entry.id === "C" ? ["reparent"] : ["make-child", "reparent"],
          }),
        }),
      ));
    });
  };

  return <section class="native-drag-probe" aria-label="Native drag probe">
    <h2>Native drag compatibility</h2>
    <p>Pragmatic 4.0.0 · real paths stay enabled</p>
    <p>Drag A below B, then into C. Drag B and press Escape. Move B less than 4 px and release to click. Drop files on the Terminal beside this panel.</p>
    <div class="native-probe-rows" onDragStart={(event) => { if (event.isTrusted) setStarts(count => count + 1); }}>
      <For each={rows()}>{entry => <div ref={element => row(element, entry)} data-probe-id={entry.id}
        data-probe-child={entry.parent !== null ? "" : undefined}
        data-probe-dragging={dragged() === entry.id ? "" : undefined}
        data-probe-target={target() === entry.id ? "" : undefined}>
        <button data-button="quiet" data-reads="text" aria-label={`Probe ${entry.id}`} onClick={() => setClicks(count => count + 1)}>{entry.id === "C" ? "C — accepts children" : entry.id}</button>
      </div>}</For>
    </div>
    <dl>
      <dt>Trusted starts</dt><dd><output aria-label="Native starts">{starts()}</output></dd>
      <dt>Moves</dt><dd><output aria-label="Native moves">{JSON.stringify(moves())}</output></dd>
      <dt>Cancelled</dt><dd><output aria-label="Native cancellations">{cancelled()}</output></dd>
      <dt>Clicks</dt><dd><output aria-label="Native clicks">{clicks()}</output></dd>
    </dl>
    <Show when={props.files}><p>Native file events: <output aria-label="Native files">{JSON.stringify(props.files)}</output></p></Show>
    <Show when={props.finish}><button data-button="quiet" data-reads="text" onClick={() => props.finish?.({ moves: moves(), cancelled: cancelled(), clicks: clicks(), trustedStarts: starts() })}>Finish compatibility probe</button></Show>
    <p>This tests native compatibility only. It is not the finished drop design or the three-library frame comparison.</p>
  </section>;
};

/** Mounted only by the opt-in native frame executable; the Terminal and native file handler remain the real App's. */
export const runNativeDragProbe = async (app: Pick<AppSeam, "onFileDrop">): Promise<NativeDragReport> => {
  const [files, setFiles] = createSignal<FileDrop[]>([]);

  const stop = await app.onFileDrop(drop => {
    if (drop.phase === "drop") setFiles(previous => [...previous.slice(-19), drop]);
  });

  const host = document.createElement("div");

  host.className = "native-drag-probe-host";
  document.body.append(host);

  return new Promise(resolve => {
    const dispose = render(() => <NativeDragProbe files={files()} finish={result => {
      const report: NativeDragReport = { probe: "roundup-native-drag-compatibility", exit: 2, ...result, files: files() };

      stop();
      dispose();
      host.remove();
      resolve(report);
    }} />, host);
  });
};
