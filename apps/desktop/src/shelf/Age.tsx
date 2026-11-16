import { copy } from "./copy";
import { elapsed, useDisplayNow } from "../state/clock";
import "./age.css";

export const age = (updatedAt: number, now: number): string => {
  const span = elapsed(updatedAt, now);

  return span.unit === "date" ? span.date : span.unit === "now" ? copy.age.now : copy.age[span.unit](span.value);
};

export const Age = (props: { updatedAt: number }) => {
  const now = useDisplayNow(() => true);

  return <span class="item-age">{age(props.updatedAt, now())}</span>;
};

/** U7205c: a Rail row's age in short units, `<n>s`, `<n>m`, `<n>h` or `<n>d`, on U4709a's boundaries; past 7 days it keeps counting days. */
export const railAge = (since: number, now: number): string => {
  const span = elapsed(since, now);

  if (span.unit === "now") return copy.age.seconds(Math.floor(Math.max(0, now - since) / 1000));

  if (span.unit === "minutes") return copy.age.minutes(span.value);

  if (span.unit === "hours") return copy.age.hours(span.value);

  return copy.age.days(Math.floor(Math.max(0, now - since) / 86_400_000));
};
