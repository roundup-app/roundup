import "./SegmentGroup.css";
import { SegmentGroup as ArkSegmentGroup } from "@ark-ui/solid/segment-group";
import { createUniqueId, For, type JSX } from "solid-js";

export type Segment<V extends string> = { value: V; label: string; content?: JSX.Element };

/** A labelled one-of-many control of side-by-side segments over Ark's SegmentGroup; the caller owns the value. */
export const SegmentGroup = <V extends string>(props: {
  label: string;
  description?: string;
  segments: readonly Segment<V>[];
  value: V;
  onValueChange: (value: V) => void;
}): JSX.Element => {
  const hint = createUniqueId();

  return (
  <ArkSegmentGroup.Root class="app-segments" aria-describedby={props.description ? hint : undefined} value={props.value} onValueChange={(details) => props.onValueChange(props.segments.find((segment) => segment.value === details.value)?.value ?? props.value)}>
    <ArkSegmentGroup.Label class="app-segments-label">{props.label}</ArkSegmentGroup.Label>
    <div class="app-segments-track">
      <For each={props.segments}>{(segment) => (
        <ArkSegmentGroup.Item aria-label={segment.label} value={segment.value} class="app-segment">
          <ArkSegmentGroup.ItemText aria-label={segment.label}>{segment.content ?? segment.label}</ArkSegmentGroup.ItemText>
          <ArkSegmentGroup.ItemControl />
          <ArkSegmentGroup.ItemHiddenInput asChild={(input) => <input {...input()} style="" />} />
        </ArkSegmentGroup.Item>
      )}</For>
    </div>
    {props.description && <span id={hint} class="settings-hint">{props.description}</span>}
  </ArkSegmentGroup.Root>
  );
};
