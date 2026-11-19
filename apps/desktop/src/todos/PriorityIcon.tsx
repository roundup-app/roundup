import type { Todo } from "@contracts/todo/Todo";
import { Icon } from "../ink/Icon";

const icons = {
  unset: "minus", low: "arrow-down", medium: "equal", high: "arrow-up", urgent: "chevrons-up",
} as const;

/** U7639a: a Todo's priority as one icon whose shape names the level and whose Token tone repeats it. */
export const PriorityIcon = (props: { priority: Todo["priority"] }) => {
  const level = () => props.priority ?? "unset";

  return <span class={["priority-icon", `priority-${level()}`]} data-icon={icons[level()]}><Icon name={icons[level()]} /></span>;
};
