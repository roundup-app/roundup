import { copy } from "./copy";
import { elapsed } from "../state/elapsed";
import { useDisplayNow } from "../state/clock";
import "./age.css";

export const age = (updatedAt: number, now: number): string => {
  const span = elapsed(updatedAt, now);

  return span.unit === "date" ? span.date : span.unit === "now" ? copy.age.now : copy.age[span.unit](span.value);
};

export const Age = (props: { updatedAt: number }) => {
  const now = useDisplayNow(() => true);

  return <span class="item-age">{age(props.updatedAt, now())}</span>;
};
