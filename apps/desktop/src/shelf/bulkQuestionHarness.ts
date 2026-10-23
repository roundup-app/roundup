import { questionProbe } from "../testing/menuProbe";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, expect, vi } from "vitest";

/** U3512a: native confirmations are observed at the App seam, never as a web question. */
export const questionDialog = async () => {
  await waitFor(() => expect(questionProbe.shown).not.toBeNull());

  return questionProbe.shown!;
};

export const askToDelete = async (count: number) => {
  fireEvent.click(screen.getByRole("button", { name: `Delete ${count}` }));

  return questionDialog();
};

export const answerQuestion = async (accepted: boolean): Promise<void> => {
  questionProbe.answer?.(accepted);
  await Promise.resolve();
};

export const confirmDeletion = async () => { await questionDialog(); await answerQuestion(true); };

export const questionClosed = (): Promise<void> => waitFor(() => { expect(questionProbe.shown).toBeNull(); expect(document.querySelector('[data-deletion-pending="true"]')).toBeNull(); });

beforeEach(() => { questionProbe.shown = null; questionProbe.answer = null; questionProbe.count = 0; });

/** jsdom has no layout, so Ark's focus trap finds nothing visible to focus; give every element a height for the test. Call once at the top of a test file. */
export const stubDialogLayout = (): void => {
  beforeEach(() => { vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(20); });
  afterEach(() => { vi.restoreAllMocks(); });
};
