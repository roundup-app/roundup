import { describe, expect, it } from "vitest";
import { arabicRuns } from "./emulator";

describe("u4649 Arabic words draw joined", () => {
  it("u4649_an_arabic_sentence_is_one_run", () => {
    const line = "  أنا جاهز. قولّي عايز نشتغل على إيه؟";

    expect(arabicRuns(line)).toEqual([[2, line.length]]);
  });

  it("u4649_text_around_an_arabic_run_keeps_its_cells", () => {
    const line = 'Noted: my Rail name is "عامل-إيه-في". Done.';
    const start = line.indexOf("ع");

    expect(arabicRuns(line)).toEqual([[start, line.indexOf('"', start)]]);
  });

  it("u4679_single_letters_use_the_real_glyph_instead_of_a_joined_cell", () => {
    expect(arabicRuns("$ ع")).toEqual([]);
    expect(arabicRuns("ع ر ب ي")).toEqual([[0, 7]]);
  });

  it("u4649_a_row_without_arabic_has_no_run", () => {
    expect(arabicRuns("● Noted: nothing for you to do.")).toEqual([]);
  });
});
