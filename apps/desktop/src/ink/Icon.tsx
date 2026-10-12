import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Circle from "lucide-solid/icons/circle";
import CodeXml from "lucide-solid/icons/code-xml";
import Diamond from "lucide-solid/icons/diamond";
import DiamondPlus from "lucide-solid/icons/diamond-plus";
import Dot from "lucide-solid/icons/dot";
import Eraser from "lucide-solid/icons/eraser";
import FolderOpen from "lucide-solid/icons/folder-open";
import Pause from "lucide-solid/icons/pause";
import Plus from "lucide-solid/icons/plus";
import Square from "lucide-solid/icons/square";
import X from "lucide-solid/icons/x";
import { Dynamic } from "solid-js/web";
import "./styles.css";

const icons = { check: Check, down: ChevronDown, left: ChevronLeft, right: ChevronRight, circle: Circle, diamond: Diamond, owned: DiamondPlus, dot: Dot, eraser: Eraser, editor: CodeXml, folder: FolderOpen, pause: Pause, plus: Plus, stop: Square, x: X };

export type IconName = keyof typeof icons;

export const Icon = (props: { name: IconName; filled?: boolean }) => (
  <Dynamic component={icons[props.name]} class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} stroke-linecap="round" stroke-linejoin="round" fill={props.filled ? "currentColor" : "none"} />
);
