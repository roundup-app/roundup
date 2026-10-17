import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { info, terminal } from "../testing/nodes";
import { mountPane } from "./paneHarness";

const WEBKIT = "The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.";

const clipboard = (read?: () => Promise<{ types: string[] }[]>) => {
  const readText = vi.fn(async () => "");
  const writeText = vi.fn(async (_value: string) => {});

  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { readText, writeText, read } });

  return { readText, writeText };
};

const refusal = () => Object.assign(new Error(WEBKIT), { name: "NotAllowedError" });

const press = (target: Element, key: string) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, metaKey: true }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("u349 a clipboard failure says what failed and what to do", () => {
  it("u349_a_refused_paste_names_the_paste_and_the_next_step", async () => {
    const clip = clipboard();
    const { connected, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");

    clip.readText.mockRejectedValueOnce(refusal());
    press(container.querySelector("[data-terminal]")!, "v");

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toBe("Paste failed: The system clipboard refused it. Press ⌘V again, or drop a file on the pane.");
    expect(alert.textContent).not.toContain(WEBKIT);
  });

  it("u349_a_refused_copy_names_the_copy_and_the_next_step", async () => {
    const clip = clipboard();
    const { connected, container, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");

    emulators.get("t-a")!.selectedText = "x";
    clip.writeText.mockRejectedValueOnce(refusal());
    press(container.querySelector("[data-terminal]")!, "c");

    expect((await screen.findByRole("alert")).textContent).toBe("Copy failed: The system clipboard refused it. Press ⌘C again.");
  });

  it("u349_another_clipboard_failure_keeps_its_message_after_the_verb", async () => {
    const clip = clipboard();
    const { connected, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");

    clip.readText.mockRejectedValueOnce(new Error("disk on fire"));
    press(container.querySelector("[data-terminal]")!, "v");

    expect((await screen.findByRole("alert")).textContent).toBe("Paste failed: disk on fire");
  });

  it("u349_an_image_on_the_clipboard_names_why_it_cannot_paste", async () => {
    clipboard(async () => [{ types: ["image/bmp"] }]);

    const { connected, container, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");

    press(container.querySelector("[data-terminal]")!, "v");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Paste failed: The clipboard holds an image, which a Terminal cannot take as text. Save it as a file and drop the file on the pane.",
    );
    expect(emulators.get("t-a")!.pasted).toEqual([]);
  });

  it("u349_a_refused_read_of_an_empty_clipboard_stays_silent", async () => {
    clipboard(async () => { throw refusal(); });

    const { connected, container } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");
    const target = container.querySelector("[data-terminal]")!;

    press(target, "v");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("u349_the_clipboard_failure_clears_on_the_next_successful_copy_or_paste", async () => {
    const clip = clipboard();
    const { connected, container, emulators } = await mountPane([terminal("a")], [info("t-a")]);

    connected.rail.select("a");

    const target = container.querySelector("[data-terminal]")!;

    clip.readText.mockRejectedValueOnce(refusal());
    press(target, "v");
    await screen.findByRole("alert");

    clip.readText.mockResolvedValueOnce("ok");
    press(target, "v");
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());

    emulators.get("t-a")!.selectedText = "x";
    clip.writeText.mockRejectedValueOnce(refusal());
    press(target, "c");
    await screen.findByRole("alert");

    press(target, "c");
    await vi.waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});
