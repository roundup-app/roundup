import { copy } from "./copy";
import { useDisplayNow } from "../state/clock";
import "./age.css";

export type Elapsed = { unit: "now" | "minutes" | "hours" | "days" | "weeks"; value: number } | { unit: "date"; date: string };

/** Last-change time and display time are Unix milliseconds. U4709a's whole-unit boundaries, shared by every age. */
export const elapsed = (updatedAt: number, now: number): Elapsed => {
  const seconds = Math.max(0, now - updatedAt) / 1000;

  if (seconds < 60) return { unit: "now", value: 0 };

  if (seconds < 3600) return { unit: "minutes", value: Math.floor(seconds / 60) };

  if (seconds < 86400) return { unit: "hours", value: Math.floor(seconds / 3600) };

  if (seconds < 604800) return { unit: "days", value: Math.floor(seconds / 86400) };

  if (seconds < 2419200) return { unit: "weeks", value: Math.floor(seconds / 604800) };
  const date = new Date(updatedAt);

  return { unit: "date", date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` };
};

export const age = (updatedAt: number, now: number): string => {
  const span = elapsed(updatedAt, now);

  return span.unit === "date" ? span.date : span.unit === "now" ? copy.age.now : copy.age[span.unit](span.value);
};

export const Age = (props: { updatedAt: number }) => {
  const now = useDisplayNow(() => true);

  return <span class="item-age">{age(props.updatedAt, now())}</span>;
};
