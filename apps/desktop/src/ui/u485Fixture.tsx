import { Cursor, Feedback } from "@dnd-kit/dom";
import { DragDropProvider } from "@dnd-kit/solid";
import { isSortable, useSortable } from "@dnd-kit/solid/sortable";
import { createSignal, For } from "solid-js";
import { render } from "solid-js/web";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";
import "./u485.css";

const Row = (props: { id: string; index: number }) => {
  const sortable = useSortable({ id: props.id, get index() { return props.index; } });

  return <div ref={sortable.ref} data-id={props.id} class="u485-row">
    <button ref={sortable.handleRef} data-button="quiet" aria-label={`Move ${props.id}`}>Move {props.id}</button>
    <span>{props.id}</span>
  </div>;
};

const Fixture = () => {
  const [ids, setIds] = createSignal(Array.from({ length: 40 }, (_, index) => String(index + 1)));
  const [commits, setCommits] = createSignal(0);

  return <>
    <DragDropProvider plugins={(defaults) => defaults.filter((plugin) => plugin !== Cursor).map((plugin) => plugin === Feedback ? Feedback.configure({ dropAnimation: null, keyboardTransition: null }) : plugin)} onDragEnd={(event) => {
      const source = event.operation.source;

      if (event.canceled || !isSortable(source) || source.initialIndex === source.index) return;
      const next = [...ids()];
      const [moved] = next.splice(source.initialIndex, 1);

      if (moved === undefined) return;
      next.splice(source.index, 0, moved);
      setIds(next);
      setCommits(commits() + 1);
    }}>
      <div class="u485-fixture" aria-label="Ordered rows"><For each={ids()}>{(id, index) => <Row id={id} index={index()} />}</For></div>
    </DragDropProvider>
    <output aria-label="Committed order">{ids().join(",")}</output>
    <output aria-label="Commits">{commits()}</output>
  </>;
};

render(Fixture, document.getElementById("root")!);
