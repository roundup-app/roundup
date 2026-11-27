import { createEffect } from "solid-js";
import { render } from "@solidjs/web";
import { Icon, type IconName } from "../ink/Icon";
import type { Control, Controls } from "./statechartBlock";
import { statechartMount } from "./visualKinds";
import { IconButton } from "../ui/IconButton";
import { copy } from "./copy";
import "./styles.css";

const GLYPH: Record<Control, IconName> = { back: "left", startOver: "rotate-ccw", walk: "route", details: "info" };

/** U7709: a statechart block as the Pad's viewer draws it, its four actions as icon buttons named by the viewer's words. */
export const IconStatechart = (props: { text: string }) => {
  let host!: HTMLDivElement;

  createEffect(() => props.text, text => {
    const drawn: (() => void)[] = [];

    const controls: Controls = (control, label, run) => {
      const slot = document.createElement("span");

      drawn.push(render(() => <IconButton aria-label={label} onClick={() => { if (slot.querySelector("button")?.getAttribute("aria-disabled") !== "true") run(); }}><Icon name={GLYPH[control]} /></IconButton>, slot));

      const button = slot.querySelector("button");

      if (!button) throw new Error(copy.statechartControlMissing);

      return button;
    };

    const release = statechartMount(controls)(host, { text, readonly: true, replace: () => {} });

    return () => {
      release();

      for (const dispose of drawn) dispose();
    };
  });

  return <div class="icon-statechart" ref={host} />;
};
