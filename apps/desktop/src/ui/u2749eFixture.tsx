import { createSignal } from "solid-js";
import { IconButton } from "./IconButton";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

/** An IconButton whose tooltip, opening to its right (U6640c), sits over a second button beneath it. */
export const u2749eFixture = () => {
  const [presses, setPresses] = createSignal(0);

  return <div style={{ display: "flex", "align-items": "flex-start", gap: "12px", padding: "40px 200px" }}>
    <IconButton id="tip-owner" aria-label="Open the tooltip over the button beside it" onClick={() => undefined}>+</IconButton>
    <button id="beneath" type="button" data-button="quiet" onClick={() => setPresses(presses() + 1)}>Beneath</button>
    <output id="presses">{presses()}</output>
  </div>;
};
