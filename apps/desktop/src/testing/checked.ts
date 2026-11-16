/** Whether a ui-sdk checkbox or switch is on. It is a button that states its value in `aria-checked`, not an input with a `checked` property. */
export const isChecked = (control: HTMLElement): boolean => control.getAttribute("aria-checked") === "true";
