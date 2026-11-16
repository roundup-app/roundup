import { createMemo, For, Show } from "solid-js";
import { TreeItem } from "@ui-sdk/solid/tree";
import { KindGlyph, LABELS } from "../ink/KindGlyph";
import { Icon } from "../ink/Icon";
import { KIND_ICON } from "../ink/kindIcon";
import { IconButton } from "../ui/IconButton";
import { AppTree } from "../ui/TreeView";
import { captureActions } from "../keys/registry";
import { useConnectedProject } from "../state/connectedProject";
import { copy } from "./copy";
import { layoutRail } from "./layout";
import { isWorkstream, resolvedWorkstream } from "../state/railTopology";
import { markKind, rowAttention, rowKind, rowUnread } from "./rollup";
import "./strip.css";

/** U6228: the collapsed Rail (its marks carry names for assistive technology only; the peek shows them, so no tooltips): one mark per Workstream, in the Rail's order, each with the state glyph and needs-you count its row rolls up from its Agents. */
export const RailStrip = () => {
  const { rail, unseen } = useConnectedProject();
  const dismissed = (node: Parameters<typeof rail.dismissed>[0]) => rail.dismissed(node);

  const marks = createMemo(() => layoutRail(rail.topology(), { collapsed: new Set(), unfolded: new Set(), now: 0 }, "workstreams")
    .flatMap(row => row.kind === "node" && isWorkstream(row.node) ? [row.node] : []));

  const items = createMemo(() => marks().map(node => ({ value: node.id, label: node.name })));

  const current = () => resolvedWorkstream(rail.nodes, rail.selected());
  const add = () => captureActions(document.activeElement).find(action => action.name === "workstream.new")?.run();

  return (
    <nav class="rail-strip" aria-label={copy.railStrip}>
      <div class="rail-strip-scroll">
        <AppTree aria-label={copy.railStrip} items={items()} value={current()} expandOnPress={false}>
            <For each={marks()}>{node => {
              const kind = () => rowKind(rail.topology(), node, dismissed, true);

              const needs = () => {
                const counts = rowAttention(rail.topology(), node, dismissed);

                return counts.needsYou + counts.error;
              };

              const unread = () => rowUnread(rail.topology(), node, id => unseen.of(id), true);

              return (
                <TreeItem value={node.id} class="rail-mark" data-id={node.id} data-kind={kind() ?? undefined}
                  aria-label={copy.markName(node.name, LABELS[markKind(kind())], needs(), unread())}
                  onClick={() => rail.select(node.id)}>
                  <Icon name={KIND_ICON.workstream} />
                  <span class="rail-mark-state"><KindGlyph kind={markKind(kind())} decorative /></span>
                  <Show when={needs() > 0}><span class="ink-count" data-state="" data-tone="amber" aria-hidden="true">{needs()}</span></Show>
                  <Show when={unread()}><span class="unread-dot" aria-hidden="true" /></Show>
                </TreeItem>
              );
            }}</For>
        </AppTree>
      </div>
      <IconButton bare class="rail-strip-add" aria-label={copy.addWorkstreamWord.trim()} onClick={add}><Icon name="plus" /></IconButton>
    </nav>
  );
};
