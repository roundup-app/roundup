import { createSignal, onMount, onCleanup } from "solid-js";
import { Tabs } from "./Tabs";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

export const u498Fixture = () => {
  const content = new URLSearchParams(location.search).has("content");
  const controlled = new URLSearchParams(location.search).has("controlled");
  const [value, setValue] = createSignal("todos");
  const [requested, setRequested] = createSignal("");
  const [requests, setRequests] = createSignal(0);
  const mounts = { Todos: 0, Pads: 0 };
  let root!: HTMLDivElement;
  let commit = 0;
  const acknowledge = () => requestAnimationFrame(() => { root.dataset.commit = String(++commit); });

  onMount(() => {
    for (const event of ["click", "keydown", "input", "pointerover", "pointermove"]) document.addEventListener(event, acknowledge);
    acknowledge();
  });
  onCleanup(() => {
    for (const event of ["click", "keydown", "input", "pointerover", "pointermove"]) document.removeEventListener(event, acknowledge);
  });

  const Draft = (props: { name: "Todos" | "Pads" }) => {
    const [count, setCount] = createSignal(0);
    const mount = ++mounts[props.name];

    return <div data-mount={mount} data-draft={props.name}>
      <label>{props.name} draft<input aria-label={`${props.name} draft`} /></label>
      <button type="button" data-button="quiet" onClick={() => setCount(count() + 1)}>Increment {props.name}</button>
      <output aria-label={`${props.name} count`}>{count()}</output>
    </div>;
  };

  return <div ref={(element) => { root = element; }} data-fixture="tabs">
    <button type="button" data-button="quiet">Before</button>
    <Tabs.Root defaultValue="todos" activationMode="automatic" {...(controlled ? {
      get value() { return value(); },
      onValueChange: (details: { value: string }) => { setRequested(details.value); setRequests(requests() + 1); },
    } : {})}>
      <Tabs.List aria-label="Shelf views" data-caller="list" class="caller-list">
        <Tabs.Trigger value="todos" data-caller="trigger" class="caller-trigger" ref={(element) => { element.dataset.ref = "connected"; }}>Todos<span aria-hidden="true"> ·</span></Tabs.Trigger>
        <Tabs.Trigger value="pads">Pads<span aria-hidden="true"> ·</span></Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="todos" data-caller="panel" class="caller-panel">{content ? <Draft name="Todos" /> : "Todo content"}</Tabs.Content>
      <Tabs.Content value="pads">{content ? <Draft name="Pads" /> : "Pad content"}</Tabs.Content>
    </Tabs.Root>
    <button type="button" data-button="quiet">After</button>
    {controlled && <>
      <button type="button" data-button="quiet" onClick={() => setValue(requested())}>Accept</button>
      <button type="button" data-button="quiet" onClick={() => setValue("todos")}>External Todos</button>
      <output aria-label="Requests">{requests()}:{requested()}</output>
    </>}
  </div>;
};
