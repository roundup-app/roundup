import { useDisplayNow } from "../state/clock";
import "./age.css";

/** Last-change time and display time are Unix milliseconds. */
export const age = (updatedAt: number, now: number): string => {
  const seconds = Math.max(0, now - updatedAt) / 1000;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;
  if (seconds < 2419200) return `${Math.floor(seconds / 604800)}w`;
  const date = new Date(updatedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const Age = (props: { updatedAt: number }) => {
  const now = useDisplayNow(() => true);
  return <span class="item-age">{age(props.updatedAt, now())}</span>;
};
