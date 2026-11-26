import { languageForPath, semanticDiffFile } from "@plannotator/sem-jiff";
import { movedOf, readable } from "./moves";
import type { Moved, MoveRequest } from "./moves";

/** U7696d: one file's moved and renamed code, read on the real engine; a file in a language not read, or over the library's cap, has none. */
export const movedIn = async (request: MoveRequest): Promise<Moved[]> => {
  const language = languageForPath(request.path);

  if (!readable(language, request.old, request.new)) return [];

  const { semanticOperations } = await semanticDiffFile(language, request.old, request.new, request.path);

  return movedOf(semanticOperations, language, request);
};
