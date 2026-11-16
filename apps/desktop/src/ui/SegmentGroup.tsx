import "./SegmentGroup.css";
import { SegmentedControl, SegmentedControlItem } from "@ui-sdk/solid/segmented-control";
import { createMemo, createUniqueId, For, Show } from "solid-js";
import type { JSX } from "@solidjs/web";

export type Segment<V extends string> = { value: V; label: string; content?: JSX.Element };

/** A labelled one-of-many control of side-by-side segments over ui-sdk's SegmentedControl; the caller owns the value. */
export const SegmentGroup = <V extends string>(props: {
  label: string;
  description?: string;
  disabled?: boolean;
  segments: readonly Segment<V>[];
  value: V;
  onValueChange: (value: V) => void;
}): JSX.Element => {
  const label = createUniqueId();
  const hint = createUniqueId();
  // The segments' content is JSX: made once here, not again for each pick.
  const segments = createMemo(() => props.segments);

  return (
  <SegmentedControl class="app-segments" aria-labelledby={label} aria-describedby={props.description ? hint : undefined} value={props.value} disabled={props.disabled ?? false} onValueChange={(value) => props.onValueChange(segments().find((segment) => segment.value === value)?.value ?? props.value)}>
    <span id={label} class="app-segments-label">{props.label}</span>
    <div class="app-segments-track">
      <For each={segments()}>{(segment) => (
        <SegmentedControlItem aria-label={segment.label} value={segment.value} class="app-segment">{segment.content ?? segment.label}</SegmentedControlItem>
      )}</For>
    </div>
    <Show when={props.description}><span id={hint} class="settings-hint">{props.description}</span></Show>
  </SegmentedControl>
  );
};
