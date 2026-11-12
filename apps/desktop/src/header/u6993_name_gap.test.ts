import { it } from "vitest";
import { browser, read, wait, url } from "../ui/tabsBrowser";
import { captureDir } from "../testing/captures";

const rendered = captureDir("U6993") ? it : it.skip;

for (const name of ["freelance", "illicitly"]) {
  rendered(`u6993_a_short_head_touches_its_tail_${name}`, async () => {
    await browser("open", url("/harness.html?seed=tabs-8"));
    await wait(`document.querySelectorAll('.tab-name').length > 0`);

    // A Check, not an assertion: the page throws when the gap is 1px or more, and the browser call fails the test.
    await read<number>(`(() => {
      const name = document.querySelector('.tab-name');
      const [head, tail] = [name.querySelector('.tab-head'), name.querySelector('.tab-tail')];
      head.textContent = ${JSON.stringify(name.slice(0, -3))};
      tail.textContent = ${JSON.stringify(name.slice(-3))};
      const text = document.createRange();
      text.selectNodeContents(head);
      const gap = tail.getBoundingClientRect().left - text.getBoundingClientRect().right;
      if (Math.abs(gap) >= 1) throw new Error('gap ' + gap);
      return gap;
    })()`);
  }, 60_000);
}

rendered("u6993_a_clipped_head_keeps_five_characters", async () => {
  await browser("open", url("/harness.html?seed=tabs-8"));
  await wait(`document.querySelectorAll('.tab-name').length > 0`);

  // A Check: the head of the longest name, clipped by the strip, keeps the 5ch floor U382 sets.
  await read<number>(`(() => {
    const heads = [...document.querySelectorAll('.tab-head')];
    const clipped = heads.filter(head => head.scrollWidth > head.clientWidth);
    if (clipped.length === 0) throw new Error('no clipped head in seed');
    const floor = parseFloat(getComputedStyle(clipped[0]).fontSize) * 0.5 * 5;
    const narrow = clipped.find(head => head.clientWidth < floor);
    if (narrow) throw new Error('clipped head ' + narrow.clientWidth + ' < ' + floor);
    return clipped.length;
  })()`);
}, 60_000);
