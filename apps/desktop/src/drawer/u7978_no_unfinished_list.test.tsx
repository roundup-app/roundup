import { fireEvent, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, expect, it, vi } from "vitest";
import { openDraftProjects } from "../testing/draftProjects";
import { menuProbe } from "../testing/menuProbe";

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

const REMOVED = /unfinished work|recover|draft/i;

it("u7978a_no_surface_lists_counts_or_marks_unfinished_work", async () => {
  const opened = await openDraftProjects();

  try {
    const connected = await opened.select(0);
    const { drafts } = connected;

    // Unsent text, a failed save and a gone original, across the surfaces that keep drafts.
    const surfaces = [["pads", "pad-1"], ["todos", "9"], ["header", connected.project.path], ["ask", "ask-bar"], ["changes", "gone-agent"], ["orders", "gone-agent"]] as const;

    for (const [surface, object] of surfaces) {
      const failed = await drafts.edit({ surface, object, recipient: null }, { text: `failed ${surface}` }, null, "ordinary");
      await failed.retained;
      await drafts.submit(failed.draft.revision);
      await drafts.settle(failed.draft.revision, "failed");
      await (await drafts.edit({ surface, object, recipient: null }, { text: `typed ${surface}` }, null, "ordinary")).retained;
    }

    const before = menuProbe.count;
    fireEvent.contextMenu(document.querySelector(".rail-scroll") ?? document.body, { clientX: 10, clientY: 10 });
    expect(menuProbe.count).toBe(before);

    const tab = within(screen.getByRole("tablist", { name: "Projects" })).getByRole("tab", { selected: true });
    fireEvent.contextMenu(tab, { clientX: 10, clientY: 10 });
    await waitFor(() => expect(menuProbe.count).toBe(before + 1));
    expect((menuProbe.shown ?? []).flatMap(item => [item.label, ...(item.children ?? []).map(child => child.label)]).filter(label => REMOVED.test(label))).toEqual([]);
    menuProbe.answer?.(null);

    expect(document.querySelector(".terminal-recover, .draft-recovery, .rail-recovery, .header-recovery, .bubble-recovery, .todo-draft-recovery")).toBeNull();
    expect(screen.queryAllByText(/unfinished work/i)).toEqual([]);
    expect(document.querySelector("[aria-label*='Unfinished work' i], [aria-description*='Unfinished work' i]")).toBeNull();
  } finally { opened.close(); }
});
