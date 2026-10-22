import "./Progress.css";
import { Progress as ArkProgress } from "@ark-ui/solid/progress";
import type { JSX } from "solid-js";

/** U3768: a linear bar over Ark's Progress; the track is the `progressbar`, and the fill is drawn with `scaleX`, never a width. `motion` marks a fill that is moving (U3770). */
export const Progress = (props: { label: string; value: number; max: number; motion?: boolean; onSettled?: () => void; children?: JSX.Element }): JSX.Element => (
  <ArkProgress.Root class="app-progress" min={0} max={props.max} value={props.value} data-motion={props.motion ? "play" : undefined}>
    <ArkProgress.Track class="app-progress-track" aria-label={props.label}>
      <ArkProgress.Range class="app-progress-fill" style={{ width: "100%", "--fill": props.max === 0 ? 0 : props.value / props.max }} onTransitionEnd={() => props.onSettled?.()} />
    </ArkProgress.Track>
    {props.children}
  </ArkProgress.Root>
);
