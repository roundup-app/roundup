import { answerOf, type App, type NativeQuestion } from "../app/seam";
import { copy } from "./copy";
import { appSettings, saveAppSettings, type QuestionKey } from "./preferences";

/** U7157c: whether the user ticked "Don't ask again" on this question and confirmed. */
export const isSuppressed = (key: QuestionKey): boolean => appSettings().suppressed.includes(key);

export const suppressQuestion = (key: QuestionKey): Promise<string | null> =>
  isSuppressed(key) ? Promise.resolve(null) : saveAppSettings({ suppressed: [...appSettings().suppressed, key] });

/** U7157d: every question asks again. */
export const resetWarnings = (): Promise<string | null> => saveAppSettings({ suppressed: [] });

/** The native question with its "Don't ask again" choice; a suppressed question answers yes without showing. Cancelling records nothing. */
export const askOnce = async (app: Pick<App, "ask">, key: QuestionKey, question: Omit<NativeQuestion, "suppressible">): Promise<boolean> => {
  if (isSuppressed(key)) return true;
  const { accepted, suppressed } = answerOf(await app.ask({ ...question, suppressible: copy.dontAskAgain }));

  if (accepted && suppressed) await suppressQuestion(key);

  return accepted;
};
