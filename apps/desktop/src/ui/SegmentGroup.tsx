import "./SegmentGroup.css";
import { SegmentGroup as ArkSegmentGroup } from "@ark-ui/solid/segment-group";
import { For, type JSX } from "solid-js";

export type Segment<V extends string> = { value: V; label: string };

/** A labelled one-of-many control of side-by-side segments over Ark's SegmentGroup; the caller owns the value. */
export const SegmentGroup = <V extends string>(props: {
  label: string;
  segments: readonly Segment<V>[];
  value: V;
  onValueChange: (value: V) => void;
}): JSX.Element => (
  <ArkSegmentGroup.Root class="app-segments" value={props.value} onValueChange={(details) => props.onValueChange(props.segments.find((segment) => segment.value === details.value)?.value ?? props.value)}>
    <ArkSegmentGroup.Label class="app-segments-label">{props.label}</ArkSegmentGroup.Label>
    <div class="app-segments-track">
      <For each={props.segments}>{(segment) => (
        <ArkSegmentGroup.Item value={segment.value} class="app-segment">
          <ArkSegmentGroup.ItemText>{segment.label}</ArkSegmentGroup.ItemText>
          <ArkSegmentGroup.ItemControl />
          <ArkSegmentGroup.ItemHiddenInput />
        </ArkSegmentGroup.Item>
      )}</For>
    </div>
  </ArkSegmentGroup.Root>
);
