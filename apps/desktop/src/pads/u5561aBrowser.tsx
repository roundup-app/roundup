import { render } from "solid-js/web";
import PadRichEditor from "./PadRichEditor";
import "../tokens.css";

const host = document.getElementById("root");

if (!host) throw new Error("Pad observer host missing");

const source = "Ready.\n\n<details>\n<summary>For Agents</summary>\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n</details>";

let changes = 0;

render(() => <PadRichEditor
  text={source}
  readonly={true}
  autofocus={false}
  onChange={() => { host.dataset.changes = String(++changes); }}
  onText={() => {}}
  onBlur={() => {}}
  onReady={() => { host.dataset.changes = String(changes); host.dataset.ready = "true"; }}
/>, host);
