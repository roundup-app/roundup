import { createMemo, For, Show } from "solid-js";
import { createTreeCollection } from "@ark-ui/solid/tree-view";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { IconButton } from "../ui/IconButton";
import { TreeView } from "../ui/TreeView";
import { captureActions } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { isWorkstream, layoutRail, resolvedWorkstream } from "./layout";
import { markKind, rowAttention, rowKind, rowUnread } from "./rollup";
import "./strip.css";

/** U6228: the collapsed Rail (its marks carry names for assistive technology only; the peek shows them, so no tooltips): one mark per Workstream, in the Rail's order, each with the state glyph and needs-you count its row rolls up from its Agents. */
export const RailStrip = (props: { expand: () => void }) => {
  const { rail, unseen } = useConnectedProject();
  const dismissed = (node: Parameters<typeof rail.dismissed>[0]) => rail.dismissed(node);

  const marks = createMemo(() => layoutRail(rail.topology(), { collapsed: new Set(), unfolded: new Set(), now: 0 }, "workstreams")
    .flatMap(row => row.kind === "node" && isWorkstream(row.node) ? [row.node] : []));

  const collection = createMemo(() => createTreeCollection({
    nodeToValue: node => node.id, nodeToString: node => node.name,
    rootNode: { id: "", name: "", children: marks().map(node => ({ id: node.id, name: node.name })) },
  }));

  const current = () => resolvedWorkstream(rail.nodes, rail.selected());
  const add = () => captureActions(document.activeElement).find(action => action.name === "workstream.new")?.run();

  return (
    <nav class="rail-strip" aria-label={copy.railStrip}>
      <IconButton bare class="rail-strip-expand" aria-label={copy.expandRail} onClick={props.expand}><Icon name="right" /></IconButton>
      <div class="rail-strip-scroll">
        <TreeView.Root collection={collection()} selectedValue={current() === null ? [] : [current()!]} expandOnClick={false}>
          <TreeView.Tree aria-label={copy.railStrip}>
            <For each={marks()}>{(node, at) => {
              const kind = () => rowKind(rail.topology(), node, dismissed, true);

              const needs = () => {
                const counts = rowAttention(rail.topology(), node, dismissed);

                return counts.needsYou + counts.error;
              };

              const unread = () => rowUnread(rail.topology(), node, id => unseen.of(id), true);

              return (
                <TreeView.NodeProvider node={collection().at([at()])!} indexPath={[at()]}>
                  <TreeView.Item
                    aria-label={copy.markName(node.name, LABELS[markKind(kind())], needs(), unread())}
                    asChild={item => <div {...item({ class: "rail-mark", onClick: () => rail.select(node.id) })} data-id={node.id} data-kind={kind() ?? undefined}>
                      <Icon name={KIND_ICON.workstream} />
                      <span class="rail-mark-state"><KindGlyph kind={markKind(kind())} decorative /></span>
                      <Show when={needs() > 0}><span class="ink-count" data-state="" data-tone="amber" aria-hidden="true">{needs()}</span></Show>
                      <Show when={unread()}><span class="unread-dot" aria-hidden="true" /></Show>
                    </div>}
                  />
                </TreeView.NodeProvider>
              );
            }}</For>
          </TreeView.Tree>
        </TreeView.Root>
      </div>
      <IconButton bare class="rail-strip-add" aria-label={copy.addWorkstreamWord.trim()} onClick={add}><Icon name="plus" /></IconButton>
    </nav>
  );
};
