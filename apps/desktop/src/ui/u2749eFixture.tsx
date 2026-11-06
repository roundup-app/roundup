import { createSignal } from "solid-js";
import { IconButton } from "./IconButton";
import "../tokens.css";
import "../styles.css";
import "../buttons.css";

/** An IconButton whose tooltip sits over a second button directly beneath it. */
export const u2749eFixture = () => {
  const [presses, setPresses] = createSignal(0);

  return <div style={{ padding: "40px 200px" }}>
    <IconButton id="tip-owner" aria-label="Open the tooltip over the button below" onClick={() => undefined}>+</IconButton>
    <button id="beneath" type="button" data-button="quiet" style={{ display: "block", "margin-top": "2px" }} onClick={() => setPresses(presses() + 1)}>Beneath</button>
    <output id="presses">{presses()}</output>
  </div>;
};
