import { copy } from "./copy";
import { useDisplayNow } from "../state/clock";
import "./age.css";

/** Last-change time and display time are Unix milliseconds. */
export const age = (updatedAt: number, now: number): string => {
  const seconds = Math.max(0, now - updatedAt) / 1000;

  if (seconds < 60) return copy.age.now;

  if (seconds < 3600) return copy.age.minutes(Math.floor(seconds / 60));

  if (seconds < 86400) return copy.age.hours(Math.floor(seconds / 3600));

  if (seconds < 604800) return copy.age.days(Math.floor(seconds / 86400));

  if (seconds < 2419200) return copy.age.weeks(Math.floor(seconds / 604800));
  const date = new Date(updatedAt);

  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const Age = (props: { updatedAt: number }) => {
  const now = useDisplayNow(() => true);

  return <span class="item-age">{age(props.updatedAt, now())}</span>;
};
