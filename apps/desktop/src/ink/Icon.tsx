import Check from "lucide-solid/icons/check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import ChevronRight from "lucide-solid/icons/chevron-right";
import Circle from "lucide-solid/icons/circle";
import Ellipsis from "lucide-solid/icons/ellipsis";
import Eraser from "lucide-solid/icons/eraser";
import FileText from "lucide-solid/icons/file-text";
import Hand from "lucide-solid/icons/hand";
import MessagesSquare from "lucide-solid/icons/messages-square";
import Diamond from "lucide-solid/icons/diamond";
import DiamondPlus from "lucide-solid/icons/diamond-plus";
import Dot from "lucide-solid/icons/dot";
import Pause from "lucide-solid/icons/pause";
import Pencil from "lucide-solid/icons/pencil";
import Plus from "lucide-solid/icons/plus";
import X from "lucide-solid/icons/x";
import { Dynamic } from "solid-js/web";
import "./styles.css";

const icons = { check: Check, down: ChevronDown, left: ChevronLeft, right: ChevronRight, circle: Circle, diamond: Diamond, owned: DiamondPlus, dot: Dot, pause: Pause, plus: Plus, x: X, more: Ellipsis, clear: Eraser, order: FileText, edit: Pencil, takeover: Hand, messages: MessagesSquare };

export const Icon = (props: { name: keyof typeof icons; filled?: boolean }) => (
  <Dynamic component={icons[props.name]} class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} stroke-linecap="round" stroke-linejoin="round" fill={props.filled ? "currentColor" : "none"} />
);
