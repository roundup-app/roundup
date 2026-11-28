import { For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";
import { copy } from "./copy";
import { moduleKey } from "./ChangedTree";
import type { ModuleGroup } from "./modules";

/** U8012a: the change's shape, one block per item sized by its changed lines; a block is a pointer target, the list keeps the keys. */
export const ChangeMap = (props: { items: readonly ModuleGroup[]; viewed: ReadonlySet<string>; open: string | undefined; onOpen: (key: string) => void; children: JSX.Element }) => {
  const lines = (item: ModuleGroup) => item.counted ? item.added + item.removed : 0;

  const size = (item: ModuleGroup) => item.counted ? `${copy.addedLines(item.added)} ${copy.removedLines(item.removed)}` : "";

  return <div class="changes-listing">{props.children}<Show when={props.items.length > 0}><div class="change-map" role="group" aria-label={copy.changeMap}>
    <For each={props.items} keyed={item => item.name}>{item => {
      const key = () => moduleKey(item().name);

      return <button type="button" tabindex="-1" class="change-map-block" style={{ "flex-grow": lines(item()) }} data-viewed={props.viewed.has(key()) ? "" : undefined} data-open={props.open === key() ? "" : undefined} aria-current={props.open === key() ? "true" : undefined} aria-label={copy.mapBlock(item().label ?? item().name, size(item()), props.viewed.has(key()))} onClick={() => { if (props.open !== key()) props.onOpen(key()); }} />;
    }}</For>
  </div></Show></div>;
};
