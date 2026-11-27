import { Icon } from "../ink/Icon";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import type { Stepper } from "./readback";

/** U7703b: the stepper of a diagram: the stop count and the sentence of the stop lit, with Previous and Next as icons at the trailing edge. A first or last stop leaves its end `aria-disabled`, and a step calls nothing. */
export const DiagramStepper = (props: { stepper: Stepper }) => (
  <div class="readback-stepper" role="group" aria-label={copy.stepDiagram}>
    <p role="status">
      <span class="readback-stop-count">
        {copy.stopCount(props.stepper.at() + 1, props.stepper.stops().length)}
      </span>
      <span>{props.stepper.stops()[props.stepper.at()]?.text}</span>
    </p>
    <span class="readback-stepper-actions">
      <IconButton
        aria-label={copy.previousStop}
        aria-disabled={props.stepper.at() === 0 ? "true" : undefined}
        onClick={() => props.stepper.go(-1)}
      >
        <Icon name="left" />
      </IconButton>
      <IconButton
        aria-label={copy.nextStop}
        aria-disabled={
          props.stepper.at() === props.stepper.stops().length - 1
            ? "true"
            : undefined
        }
        onClick={() => props.stepper.go(1)}
      >
        <Icon name="right" />
      </IconButton>
    </span>
  </div>
);
