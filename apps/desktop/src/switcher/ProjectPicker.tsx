import { createSignal, Show } from "solid-js";
import { returnFocus } from "../keys/focus";
import { registerKeys } from "../keys/registry";
import { LEADER } from "../keys/chords";
import type { ProjectsState } from "../state/projects";
import { Combobox } from "../ui/Combobox";
import { copy } from "./copy";
import "./styles.css";

/** The leader `P` picker: a filter field over the open Projects; choosing one selects it. */
export const ProjectPicker = (props: { projects: Pick<ProjectsState, "tabs" | "select"> }) => {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  const [highlight, setHighlight] = createSignal<string | null>(null);
  let panel: HTMLElement | undefined;
  let opener: Element | null = null;

  /** Esc or a dismissal returns focus to where it was before the picker opened; choosing a Project moves focus itself. */
  const dismiss = () => {
    setOpen(false);
    returnFocus(opener);
  };

  const matches = () => props.projects.tabs().filter(tab => tab.project.name.toLowerCase().includes(query().toLowerCase())).map(tab => ({ value: tab.project.path, label: tab.project.name }));

  const highlighted = () => matches().some(item => item.value === highlight()) ? highlight() : matches()[0]?.value ?? null;

  registerKeys({ kind: "leader" }, [{ action: LEADER["leader.project"], capture: () => ({ available: () => props.projects.tabs().length > 1, invoke: () => { opener = document.activeElement; setQuery(""); setOpen(true); } }) }]);
  registerKeys({ kind: "layer", element: () => panel, active: open, modal: true }, [{ chords: ["Escape"], run: dismiss }]);

  return (
    <Show when={open()}><section class="switcher" ref={element => { panel = element; }}>
      <Combobox.Root items={matches()} inputValue={query()} onInput={setQuery} highlightedValue={highlighted()} onHighlightChange={setHighlight} label={copy.switchProject} placeholder={copy.switcherPlaceholder} empty={copy.noMatch} row={item => item.label} focusScope={() => panel} onDismiss={dismiss} onSelect={path => { setOpen(false); props.projects.select(path); }} />
    </section></Show>
  );
};
