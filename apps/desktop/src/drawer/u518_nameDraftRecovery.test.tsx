import { describe, expect, it } from "vitest";
import { recoveryOrder } from "./NameDraftRecovery";

describe("U511a: the revisions of an unfinished name", () => {
  it("lists the current draft first, then the other revisions newest first", () => {
    const records = [{ revision: "a" }, { revision: "b" }, { revision: "c" }];

    expect(recoveryOrder(records, records[1]).map(draft => draft.revision)).toEqual(["b", "c", "a"]);
  });
});
