import * as v from "valibot";
import { storageSchema, storedValue } from "../state/storage";

const grid = v.pipe(v.number(), v.integer(), v.minValue(1));
const schema = storageSchema("roundup:terminal-scrollback", v.strictObject({
  cols: grid,
  rows: grid,
  after: v.pipe(v.number(), v.integer(), v.minValue(0)),
  data: v.pipe(v.string(), v.maxLength(10 * 1024 * 1024)),
}));

/** Output belongs to one original Terminal, never a later program reusing its id. */
export const scrollbackStorage = (project: string, incarnation: string) =>
  storedValue(`roundup:terminal-scrollback:${project}:${incarnation}`, schema);
