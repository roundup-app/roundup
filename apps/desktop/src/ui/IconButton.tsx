import { mergeProps, splitProps, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
import { Tooltip } from "./Tooltip";

export const IconButton = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { "aria-label": string }) => {
  const [local, rest] = splitProps(props, ["class", "onClick"]);

  const click: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (props["aria-disabled"] === true || props["aria-disabled"] === "true") {
      event.preventDefault();
      event.stopPropagation();

      return;
    }

    const handler = local.onClick;

    if (!handler) return;

    if (0 in handler) handler[0](handler[1], event);
    else handler(event);
  };

  // Escape belongs to the surrounding App surface; blur and pointer leave dismiss the name.
  return <Tooltip.Root closeOnEscape={false} positioning={{ strategy: "fixed" }}>
    <Tooltip.Trigger asChild={(trigger) => <button {...trigger(mergeProps({ type: "button" as const }, rest, { onClick: click }))} data-button="icon" class={`word ${local.class ?? ""}`} />} />
    <Portal><Tooltip.Positioner><Tooltip.Content>{props["aria-label"]}</Tooltip.Content></Tooltip.Positioner></Portal>
  </Tooltip.Root>;
};
