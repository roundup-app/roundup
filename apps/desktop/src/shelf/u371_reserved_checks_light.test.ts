import { expect, it } from "vitest";
import { shelfBrowser } from "./u371Browser";

const { evaluate, settle, openShelf } = shelfBrowser();

it("u371_failure_text_stays_visible", async () => {
  await openShelf();
  await evaluate(`(() => { window.__fake.failNext(-32001,'Injected completion failure preserves the full explanation'); document.querySelector('.shelf .todo-tick:not(:disabled)').click(); return true; })()`);
  await settle();
  const observation = await evaluate<{text: string; calls: unknown}>("({text:document.querySelector('.shelf').textContent,calls:window.__fake.app.calls.slice(-5)})");
  expect(observation.text, JSON.stringify(observation.calls)).toContain('Injected completion failure preserves the full explanation');
}, 90_000);
