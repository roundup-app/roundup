import { createSignal, For, Show } from "solid-js";
import { render } from "@solidjs/web";
import { TreeGroup, TreeItem, TreeItemLabel, type TreeItemData } from "@ui-sdk/solid/tree";
import { AppTree } from "./TreeView";
import { IconButton } from "./IconButton";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

const items: TreeItemData[] = [
  { value: "Alpha", label: "Alpha", children: [{ value: "Beta", label: "Beta", children: [{ value: "Cedar", label: "Cedar" }] }, { value: "Delta", label: "Delta" }] },
  { value: "Echo", label: "Echo" },
];

const u483Fixture = () => {
  const [expanded, expand] = createSignal<string[]>([]);
  const [selected, select] = createSignal<string | null>(null);

  const node = (item: TreeItemData) => <TreeItem value={item.value} data-id={item.value}>
    <span class="glyph" aria-hidden="true">○</span>
    <TreeItemLabel>{item.label}</TreeItemLabel>
    <IconButton data-reads="text" tabindex={-1} aria-label={`Inspect ${item.label}`} onClick={(event) => event.stopPropagation()}>+</IconButton>
    <Show when={item.children}>{children => <TreeGroup keepMounted><For each={children()}>{node}</For></TreeGroup>}</Show>
  </TreeItem>;

  return <>
    <AppTree aria-label="Project tree" items={items} expanded={expanded()} onExpandedChange={expand} value={selected()} onValueChange={select}>
      <For each={items}>{node}</For>
    </AppTree>
    <button data-button="quiet" onClick={() => { expand(["Alpha", "Beta"]); select("Cedar"); }}>Select Cedar</button>
  </>;
};

render(u483Fixture, document.getElementById("root")!);
