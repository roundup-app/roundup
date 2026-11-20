import type { FileComparison } from "@contracts/agent/FileComparison";
import type { FileContent } from "@contracts/agent/FileContent";
import { sizeText } from "../resources/format";
import { copy } from "./copy";

export type Picture = Extract<FileContent, { kind: "image" }>;

export type Side = { side: "old" | "new"; label: string; picture: Picture };

const SIDES = [["old", copy.oldSide], ["new", copy.newSide]] as const;

/** U7694b: the pictures of a comparison whose sides are each absent or an image, with at least one image; else null. */
export const imageSides = (value: FileComparison): Side[] | null => {
  const sides = SIDES.flatMap(([side, label]) => {
    const picture = value[side];

    return picture.kind === "image" ? [{ side, label, picture }] : [];
  });

  return sides.length > 0 && SIDES.every(([side]) => value[side].kind === "image" || value[side].kind === "absent") ? sides : null;
};

/** Both sides of a comparison are text or absent: the only ones Pierre draws as lines. */
export const drawsLines = (value: FileComparison) => [value.old, value.new].every(side => side.kind === "text" || side.kind === "absent");

const MODE = "mode";

/** U7694b: why an image comparison shows no picture: equal bytes on both sides (a rename or a mode change), or a side over the limit; null when it shows or is no image. */
export const imageHidden = (value: FileComparison): "mode" | "large" | null => {
  const sides = imageSides(value) ?? [];
  const [first, second] = sides;

  if (first && second && first.picture.revision === second.picture.revision) return MODE;

  return sides.some(({ picture }) => picture.data === undefined) ? "large" : null;
};

/** One version's words, or "before → after"; equal parts show once when `collapse` is set. */
const pair = (parts: string[], collapse: boolean) => {
  const [before = "", after] = parts;

  return after === undefined || (collapse && before === after) ? before : copy.beforeAfter(before, after);
};

/** The byte sizes of the shown sides: "Old 5.2 MB → New 6.1 MB", or one side's. */
export const imageSizes = (value: FileComparison): string => pair((imageSides(value) ?? []).map(({ label, picture }) => copy.sideSize(label, sizeText(picture.size))), false);

/** U7694b: the size change under the pictures: decoded pixel sizes, once when equal, and file sizes; pixels only once every shown picture decoded. */
export const sizeChange = (files: number[], dimensions: ([number, number] | undefined)[]): string => {
  const decoded = dimensions.flatMap(each => each ? [copy.dimensions(each[0], each[1])] : []);
  const pixels = decoded.length === dimensions.length ? pair(decoded, true) : null;

  return copy.sizeNote(pixels, pair(files.map(sizeText), false));
};
