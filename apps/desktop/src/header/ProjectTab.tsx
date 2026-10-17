import { copy } from "../copy";
import { createMemo, createSignal, onMount, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { createNear } from "../ink/near";
import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { Tabs } from "../ui/Tabs";
import { Tooltip } from "../ui/Tooltip";
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

/** One Project's library-owned tab and context menu, with a sibling close control. */
export const ProjectTab = (props: {
  tab: StripTab;
  selected: boolean;
  closeFocus?: boolean;
  onMark: () => void;
  onRename: (name: string) => void;
  onClose: () => void;
  onModels: () => void;
  ref?: (element: HTMLElement) => void;
}) => {
  const { near, handlers } = createNear();
  const [editing, setEditing] = createSignal<number | null>(null);
  const [menu, setMenu] = createSignal(false);
  let wrap: HTMLDivElement | undefined;
  let button: HTMLButtonElement | undefined;
  let content: HTMLDivElement | undefined;
  let modelsRequested = false;
  const mark = () => markOf(props.tab);
  const parts = createMemo(() => nameParts(props.tab.name));
  const edit = () => setEditing(wrap?.offsetWidth ?? 0);
  registerKeys({ kind: "region", element: () => wrap }, [
    { chords: ["F2"], when: (press) => press.target === button, run: edit },
    { chords: ["Shift+F10", "ContextMenu"], when: (press) => press.target === button, run: () => setMenu(true) },
  ]);
  registerKeys({ kind: "layer", element: () => content, active: menu, modal: false }, []);

  return <Tabs.Context>{(tabs) => <Menu.Root ids={{ contextTrigger: tabs().getTriggerProps({ value: props.tab.path }).id, trigger: tabs().getTriggerProps({ value: props.tab.path }).id }} open={menu()} onOpenChange={({ open }) => setMenu(open)} aria-label={copy.projectActions}
    onSelect={() => { modelsRequested = true; }}
    onExitComplete={() => {
      if (!modelsRequested) return;
      modelsRequested = false;

      if (button?.isConnected) button.focus();
      props.onModels();
    }}>
    <div class="project-tab" data-selected={props.selected} role="presentation" data-path={props.tab.path}
      style={editing() === null ? undefined : { width: `${editing()}px` }}
      ref={(element) => { wrap = element; props.ref?.(element); }}
      onPointerEnter={handlers.onMouseEnter} onPointerLeave={handlers.onMouseLeave}
      onFocusIn={handlers.onFocusIn} onFocusOut={handlers.onFocusOut}>
      <Show when={editing() === null} fallback={<RenameField name={props.tab.name} onDone={(saved, refocus) => {
        setEditing(null);

        if (refocus) button?.focus();

        if (saved !== null) props.onRename(saved);
      }} />}>
        <Tooltip.Root ids={{ trigger: tabs().getTriggerProps({ value: props.tab.path }).id }} closeOnEscape={false} positioning={{ strategy: "fixed" }}>
          <Menu.ContextTrigger asChild={(context) =>
            <Tooltip.Trigger asChild={(tooltip) =>
              <Tabs.Trigger {...context(tooltip({}))} value={props.tab.path} class="tab-name-button"
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
            } />
          } />
          <Portal><Tooltip.Positioner><Tooltip.Content class="tab-tip">
            {props.tab.path}<Show when={mark()}><br />{tipOf(props.tab)}</Show>
          </Tooltip.Content></Tooltip.Positioner></Portal>
        </Tooltip.Root>
        <IconButton class="tab-close" aria-label={copy.closeProject(props.tab.name)} data-visible={near() || props.closeFocus === true} onClick={() => props.onClose()}><Icon name="x" /></IconButton>
      </Show>
    </div>
    <Portal><Menu.Positioner><Menu.Content class="tab-menu" aria-label={copy.projectActions} aria-labelledby="" ref={content}>
      <Menu.Item value="models">{copy.models}</Menu.Item>
    </Menu.Content></Menu.Positioner></Portal>
  </Menu.Root>}</Tabs.Context>;
};
