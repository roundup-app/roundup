import { render } from "solid-js/web";
import PadRichEditor from "./PadRichEditor";
import "../tokens.css";

const host = document.getElementById("root");

if (!host) throw new Error("Pad observer host missing");

const source = "# Result\n\nReady.\n\n## Verification\n\n<details>\n<summary>Evidence</summary>\n\n<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n[unsafe](javascript:alert(1))\n\n</details>\n\n## Next step\n\nReview.\n\n# Reference\n\n<details>\n<summary>For Agents</summary>\n\nAgent details.\n\n</details>\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth";

let changes = 0;

render(() => <PadRichEditor
  text={new URLSearchParams(location.search).has("unsafe") ? source.replace("<summary>Evidence</summary>", "<summary>Evidence <img src=x onerror=alert(1)><script>alert(1)</script>[unsafe](javascript:alert(1))</summary>") : source}
  readonly={!new URLSearchParams(location.search).has("editable")}
  autofocus={false}
  onChange={() => { host.dataset.changes = String(++changes); }}
  onText={() => {}}
  onBlur={() => {}}
  onReady={() => { host.dataset.changes = String(changes); host.dataset.ready = "true"; }}
/>, host);
