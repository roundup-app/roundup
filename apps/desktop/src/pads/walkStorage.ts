import * as v from "valibot";
import { storageSchema, storedValue } from "../state/storage";

const schema = storageSchema("roundup:walk", v.record(v.string(), v.number()));

/** PW4: each Pad's step (1-based) in a Project's walks, over the App's one persisted-state store. */
export const walkStorage = (path: string) => storedValue(`roundup:walk:${path}`, schema);
