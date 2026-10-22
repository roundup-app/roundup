import { expect, it } from "vitest";
import { browser, read, url, wait } from "../ui/tabsBrowser";

it("u3296b_title_follows_the_layout", async () => {
  await browser("set", "viewport", "1280", "800");
  await browser("open", url("/harness.html?seed=tree-40"));
  await wait(`document.querySelector('.shelf-tabs [role=tab]') && window.__fake`);
  await browser("eval", `[...document.querySelectorAll('.shelf-tabs [role=tab]')].find(t => t.textContent.startsWith('Pads')).click()`);

  const name = `[...document.querySelectorAll('.shelf .shelf-title')].find(t => t.textContent === 'a-pad-with-a-very-long-name-here')`;
  await wait(`Boolean(${name})`);

  const width = (value: string) => browser("eval", `${name}.style.setProperty('max-width', '${value}')`);
  const text = await read<string>(`${name}.textContent`);

  await width("20px");
  await wait(`${name}.getAttribute('title') === ${JSON.stringify(text)}`);

  await width("none");
  await wait(`${name}.getAttribute('title') === null`);

  await width("20px");
  await wait(`${name}.getAttribute('title') === ${JSON.stringify(text)}`);
  expect(await read<string>(`${name}.getAttribute('title')`)).toBe(text);
});
