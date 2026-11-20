import { expect, it } from "vitest";
import { documentBrowser } from "./u4698dBrowser";

const { browser, evaluate, openDocument } = documentBrowser();

// U7641a: the real editor prevents Escape's default, so only a browser shows that a plain Escape reaches the field and puts the body back.
it(
  "u7641a_esc_in_the_rich_body_puts_back_the_body_the_edit_started_with",
  { retry: 0, timeout: 90_000 },
  async () => {
    const original = "First paragraph of notes.";
    const text = "document.querySelector('.drawer .ProseMirror')?.textContent";

    const sent =
      "window.__fake.app.calls.filter(call => call.method === 'todo.update' && call.params.id === 1).map(call => call.params.body)";

    await openDocument(1280, 820);
    await evaluate(
      `window.__fake.app.rpc('todo.update', { id: 1, body: ${JSON.stringify(original)} }).then(() => true)`,
    );
    await browser("wait", "--fn", `${text} === ${JSON.stringify(original)}`);
    await browser("click", ".drawer .ProseMirror");
    await browser("press", "End");
    await browser("keyboard", "inserttext", " Typed after.");
    await browser(
      "wait",
      "--fn",
      `${sent}.at(-1) === ${JSON.stringify(original + " Typed after.")}`,
    );
    await browser("press", "Escape");
    await browser(
      "wait",
      "--fn",
      `${sent}.at(-1) === ${JSON.stringify(original)} && ${text} === ${JSON.stringify(original)}`,
    );
    expect(await evaluate(`${sent}.at(-1)`)).toBe(original);
  },
);
