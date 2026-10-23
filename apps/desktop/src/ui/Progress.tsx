import "./Progress.css";
import { Progress as ArkProgress } from "@ark-ui/solid/progress";
import type { JSX } from "solid-js";

/** U3768: a linear bar over Ark's Progress; the track is the `progressbar`, and the fill is drawn with `scaleX`, never a width. `motion` marks a fill that is moving (U3770); `onMotionEnd` fires when its transition ends. */
export const Progress = (props: { label: string; value: number; max: number; motion?: boolean; onMotionEnd?: () => void; children?: JSX.Element }): JSX.Element => (
  <ArkProgress.Root class="app-progress" min={0} max={props.max} value={props.value} data-state="" data-motion={props.motion ? "play" : undefined} onTransitionEnd={(event) => { if (event.propertyName === "transform") props.onMotionEnd?.(); }}>
    <ArkProgress.Track data-state="" class="app-progress-track" aria-label={props.label}>
      <ArkProgress.Range data-state="" class="app-progress-fill" style={{ width: "100%", "--fill": props.max === 0 ? 0 : props.value / props.max }} />
    </ArkProgress.Track>
    {props.children}
  </ArkProgress.Root>
);
