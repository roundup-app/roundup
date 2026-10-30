import { render } from "solid-js/web";
import { createSignal, For } from "solid-js";
import { Sortable, type SortableMove, type TreeRow } from "./sortable";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";
import "./u485.css";

const INDENT = 24;

const NESTS = new Set(["P", "Q"]);

const u535Fixture = () => {
  const [rows] = createSignal<TreeRow[]>([
    { id: "P", parent: null }, { id: "P1", parent: "P" }, { id: "P2", parent: "P" }, { id: "Q", parent: null }, { id: "R", parent: null },
  ]);

  const [moves, move] = createSignal<SortableMove[]>([]);
  const [previews, preview] = createSignal<string[]>([]);
  const [orders, order] = createSignal(0);
  const [clicks, click] = createSignal(0);

  const depth = (id: string): number => {
    const parent = rows().find((row) => row.id === id)?.parent;

    return parent ? depth(parent) + 1 : 0;
  };


  document.addEventListener("click", () => click(clicks() + 1), { capture: true });

  return <>
    <Sortable.Root ids={rows().map((row) => row.id)} aria-label="Tree rows" class="sortable-fixture"
      tree={{
        rows: rows(), indent: INDENT, nests: (id) => NESTS.has(id),
        inset: (element) => Number.parseFloat(getComputedStyle(element).paddingInlineStart),
        onMove: (next) => move([...moves(), next]),
        onPreview: (drop) => preview([...previews(), drop ? `${drop.parent}:${drop.index}:${drop.depth}` : "end"]),
      }}
      onOrderChange={() => order(orders() + 1)}>
      <For each={rows()}>{(row, index) => <Sortable.Item id={row.id} index={index()}>{(parts) =>
        <div ref={parts.ref} data-id={row.id} class="sortable-row" style={{ "padding-left": `${depth(row.id) * INDENT}px` }} data-dragging={parts.isDragging()}>
          <span>{row.id}</span>
          <Sortable.Handle ref={parts.handleRef} label={`Move ${row.id}`} />
        </div>
      }</Sortable.Item>}</For>
    </Sortable.Root>
    <output aria-label="Moves">{JSON.stringify(moves())}</output>
    <output aria-label="Previews">{previews().join(" ")}</output>
    <output aria-label="Order calls">{orders()}</output>
    <output aria-label="Clicks">{clicks()}</output>
  </>;
};

render(u535Fixture, document.getElementById("root")!);
