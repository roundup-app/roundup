import "./Progress.css";
import { Progress as UiProgress } from "@ui-sdk/solid/progress";
import type { JSX } from "@solidjs/web";

/** U3768: a linear bar over ui-sdk's Progress; the track is the `progressbar`, and the fill is drawn with `scaleX`, never a width. `motion` marks a fill that is moving (U3770); `onMotionEnd` fires when its transition ends. */
export const Progress = (props: { label: string; value: number; max: number; motion?: boolean; onMotionEnd?: () => void; children?: JSX.Element }): JSX.Element => (
  <div class="app-progress" data-motion={props.motion ? "play" : undefined} onTransitionEnd={(event) => { if (event.propertyName === "transform") props.onMotionEnd?.(); }}>
    <UiProgress class="app-progress-track" min={0} max={props.max} value={props.value} aria-label={props.label}>
      <div class="app-progress-fill" style={{ "--progress-ratio": props.max === 0 ? 0 : props.value / props.max }} />
    </UiProgress>
    {props.children}
  </div>
);
