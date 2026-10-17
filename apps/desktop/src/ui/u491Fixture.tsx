import { render } from "solid-js/web";
import { createEffect, createSignal, onMount, Show } from "solid-js";
import { KindGlyph } from "../ink/KindGlyph";
import { Layout } from "../app/Layout";
import { createWidths } from "../resize/widths";
import { Splitter } from "./Splitter";
import { createToast, ToastProvider } from "./Toast";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

function u491Fixture() {
  const widths = createWidths(() => null);
  const [open, setOpen] = createSignal(true);
  const [activations, setActivations] = createSignal(0);
  const [ends, setEnds] = createSignal(0);
  const toast = createToast({ limit: 3, newestFirst: true, onActivate: () => setActivations((count) => count + 1) });
  Object.assign(window, { __providers: { toast, widths } });
  const side = (value: typeof widths.rail) => ({ ...value, commit: (px: number) => { value.commit(px); setEnds((count) => count + 1); } });
  const [root, setRoot] = createSignal<HTMLElement>();

  onMount(() => {
    const element = document.querySelector<HTMLElement>("[data-layout-root]")!;

    widths.attach(element);
    setRoot(element);
  });
  createEffect(() => {
    const styles = widths.style();

    for (const [name, value] of Object.entries(styles)) root()?.style.setProperty(name, value);
  });

  return <Layout header={<>
    <button data-button="quiet" onClick={() => setOpen(!open())}>Shelf</button>
    <button data-button="quiet" onClick={() => { widths.rail.commit(480); widths.shelf.commit(560); }}>Wide</button>
    <button data-button="quiet" onClick={() => { widths.rail.commit(288); widths.shelf.commit(320); }}>Default</button>
    <button data-button="quiet" onClick={() => toast.show({ id: "agent", glyph: <KindGlyph kind="error" decorative />, name: "Agent with a very long name that remains readable", content: "Could not save the result.\nThe directory is unavailable; choose another directory and try again.", duration: Infinity })}>Notify</button>
    <output aria-label="Activations">{activations()}</output><output aria-label="Ends">{ends()}</output>
  </>}
    rail={<><p>Agents</p><textarea aria-label="Selection" style={{ font: "inherit", border: "0", padding: "var(--space-2)", color: "var(--text)", background: "var(--ground)" }}>Retained selection</textarea><div style={{ display: "contents" }}><Splitter side={side(widths.rail)} class="rail-edge" /></div></>}
    centre={<><textarea aria-label="Draft" style={{ font: "inherit", border: "0", padding: "var(--space-2)", color: "var(--text)", background: "var(--ground)" }}>Retained draft</textarea><div style={{ height: "100%", overflow: "auto" }}><p style={{ height: "2000px" }}>Scrollable result</p></div></>}
    shelf={<><p>Resources</p><Show when={open()}><Splitter side={side(widths.shelf)} class="shelf-edge" /></Show></>}
    shelfPlacement={{ get open() { return open(); }, get rendered() { return open(); }, get shown() { return open(); }, animated: false, onSettle() {} }}
    overlay={<ToastProvider toast={toast} label="Updates" />} />;
}

render(u491Fixture, document.getElementById("root")!);
