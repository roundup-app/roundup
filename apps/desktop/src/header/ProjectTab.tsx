import type { ProjectsState } from "../state/projects";
import { copy } from "../copy";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { createNear } from "../ink/near";
import { Icon } from "../ink/Icon";
import { FlatTab } from "../ui/FlatTab";
import { IconButton } from "../ui/IconButton";
import { Tabs } from "../ui/Tabs";
import { Tip } from "../ui/Tip";
import { registerKeys } from "../keys/registry";
import { MARKS, markOf, nameParts, tipOf } from "./tab";
import type { StripTab } from "./tab";

/** Rename keeps authored keystrokes out of Project shortcuts while leaving native text editing intact. */
const RenameField = (props: { name: string; onDone: (saved: string | null, refocus: boolean) => void }) => {
  let field: HTMLInputElement | undefined;
  let finished = false;

  const finish = (saved: string | null, refocus: boolean) => {
    if (finished) return;
    finished = true;
    props.onDone(saved, refocus);
  };

  registerKeys({ kind: "layer", element: () => field, active: () => !finished, modal: true }, [
    { chords: ["Enter"], when: (press) => !press.isComposing, run: () => finish(field?.value ?? "", true) },
    { chords: ["Escape"], when: (press) => !press.isComposing, run: () => finish(null, true) },
  ]);
  onMount(() => { field?.focus(); field?.select(); });

  return <input class="tab-rename" aria-label={copy.projectName} value={props.name} ref={field}
    onBlur={() => finish(field?.value ?? "", false)} />;
};

/** One Project's library-owned tab, with a sibling close control. */
export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  closeFocus?: boolean;
  onMark: () => void;
  onRename: (name: string, base?: string) => ReturnType<ProjectsState["rename"]>;
  onClose: () => void;
  ref?: (element: HTMLElement) => void;
}) => {
  const { near, handlers } = createNear();
  const [editing, setEditing] = createSignal<number | null>(null);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  const mark = () => markOf(props.tab);
  const parts = createMemo(() => nameParts(props.tab.name));
  const edit = () => setEditing(wrap?.offsetWidth ?? 0);
  registerKeys({ kind: "region", element: () => wrap }, [
    { chords: ["F2"], when: (press) => press.target === button, run: edit },
  ]);

  return <Tabs.Context>{(tabs) => <>
    <FlatTab class="project-tab" selected={props.selected} role="presentation" data-path={props.tab.path}
      style={editing() === null ? undefined : { width: `${editing()}px` }}
      ref={(element) => { wrap = element; props.ref?.(element); }}
      onPointerEnter={handlers.onMouseEnter} onPointerLeave={handlers.onMouseLeave}
      onFocusIn={handlers.onFocusIn} onFocusOut={handlers.onFocusOut}>
      <Show when={editing() === null} fallback={<RenameField name={props.tab.name} onDone={(saved, refocus) => {
        setEditing(null);

        if (refocus) button?.focus();

        if (saved !== null) props.onRename(saved);
      }} />}>
        <Tip ids={{ trigger: tabs().getTriggerProps({ value: props.tab.path }).id }} class="tab-tip" content={<>{props.tab.path}<Show when={mark()}><br />{tipOf(props.tab)}</Show></>}>
          {(tooltip) =>
              <Tabs.Trigger {...tooltip({})} value={props.tab.path} class="tab-name-button"
                data-selected={props.selected ? "true" : undefined} aria-busy={props.tab.busy} ref={(element) => (button = element)}
                onClick={(click) => {
                  if (click.target instanceof Element && click.target.closest('.tab-mark')) {
                    click.preventDefault();
                    props.onMark();
                  }
                }}>
                <span class="tab-name" onDblClick={edit}><span class="tab-head">{parts()[0]}</span><span class="tab-tail">{parts()[1]}</span></span>
                <Show when={mark()}>{(shown) => <span class="tab-mark ink" data-tone={MARKS[shown()].tone} data-kind={shown()} role="img" aria-label={MARKS[shown()].label} />}</Show>
              </Tabs.Trigger>
          }
        </Tip>
        <IconButton class="tab-close" aria-label={copy.closeProject(props.tab.name)} data-visible={near() || props.closeFocus === true} onClick={() => props.onClose()}><Icon name="x" /></IconButton>
      </Show>
    </FlatTab>
  </>}</Tabs.Context>;
};
