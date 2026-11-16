// U7283a: the one list of stylesheets, in load order. `main.tsx` and the U26 harness import it, so a sheet added here reaches the App, the Captures and the Checks together. ui-sdk's sheet loads first.
import "@ui-sdk/core/web.css";
import "./tokens.css";
import "./styles.css";
import "./scrollbar.css";
// U4709d: a surface's look at rest never waits on another surface's chunk, so these load after every other sheet, the order they land in today.
import "./fork/fork.css";
import "./importer/import.css";
import "./pads/editor.css";
import "./pads/styles.css";
import "./plain/styles.css";
import "./todos/blockerMenu.styles.css";
import "./todos/drawer.styles.css";
import "./todos/rowButton.styles.css";
import "./ui/Progress.css";
import "./ui/RadioGroup.css";
import "./ui/SegmentGroup.css";
import "./ui/reading.styles.css";
