import ArrowDown from "@lucide/solid/icons/arrow-down";
import Bug from "@lucide/solid/icons/bug";
import ArrowUp from "@lucide/solid/icons/arrow-up";
import ChevronsUp from "@lucide/solid/icons/chevrons-up";
import Equal from "@lucide/solid/icons/equal";
import Bot from "@lucide/solid/icons/bot";
import Workflow from "@lucide/solid/icons/workflow";
import LayoutDashboard from "@lucide/solid/icons/layout-dashboard";
import Code from "@lucide/solid/icons/code";
import FolderOpen from "@lucide/solid/icons/folder-open";
import GitBranch from "@lucide/solid/icons/git-branch";
import Check from "@lucide/solid/icons/check";
import ChevronDown from "@lucide/solid/icons/chevron-down";
import PanelLeftClose from "@lucide/solid/icons/panel-left-close";
import PanelLeftOpen from "@lucide/solid/icons/panel-left-open";
import ChevronLeft from "@lucide/solid/icons/chevron-left";
import ChevronRight from "@lucide/solid/icons/chevron-right";
import Circle from "@lucide/solid/icons/circle";
import Cpu from "@lucide/solid/icons/cpu";
import Diamond from "@lucide/solid/icons/diamond";
import DiamondPlus from "@lucide/solid/icons/diamond-plus";
import Dot from "@lucide/solid/icons/dot";
import Ellipsis from "@lucide/solid/icons/ellipsis";
import Eraser from "@lucide/solid/icons/eraser";
import FileDown from "@lucide/solid/icons/file-down";
import StickyNote from "@lucide/solid/icons/sticky-note";
import FileText from "@lucide/solid/icons/file-text";
import HardDrive from "@lucide/solid/icons/hard-drive";
import MemoryStick from "@lucide/solid/icons/memory-stick";
import MessageSquare from "@lucide/solid/icons/message-square";
import MessagesSquare from "@lucide/solid/icons/messages-square";
import MessageSquarePlus from "@lucide/solid/icons/message-square-plus";
import Minus from "@lucide/solid/icons/minus";
import Pencil from "@lucide/solid/icons/pencil";
import Pause from "@lucide/solid/icons/pause";
import Play from "@lucide/solid/icons/play";
import Plus from "@lucide/solid/icons/plus";
import RotateCw from "@lucide/solid/icons/rotate-cw";
import Trash from "@lucide/solid/icons/trash";
import X from "@lucide/solid/icons/x";
import { Dynamic } from "@solidjs/web";
import Server from "@lucide/solid/icons/server";
import Copy from "@lucide/solid/icons/copy";
import Reply from "@lucide/solid/icons/reply";
import Send from "@lucide/solid/icons/send";
import Unlink from "@lucide/solid/icons/unlink";
import BookOpenText from "@lucide/solid/icons/book-open-text";
import "./styles.css";

const icons = { bug: Bug, bot: Bot, workflow: Workflow, "layout-dashboard": LayoutDashboard, play: Play, "rotate-cw": RotateCw, check: Check, down: ChevronDown, left: ChevronLeft, "panel-left-close": PanelLeftClose, "panel-left-open": PanelLeftOpen, right: ChevronRight, circle: Circle, diamond: Diamond, owned: DiamondPlus, dot: Dot, export: FileDown, talk: MessageSquare, "note-plus": MessageSquarePlus, trash: Trash, pause: Pause, plus: Plus, minus: Minus, x: X, more: Ellipsis, clear: Eraser, order: FileText, "sticky-note": StickyNote, messages: MessagesSquare, folder: FolderOpen, editor: Code, memory: MemoryStick, cpu: Cpu, disk: HardDrive, edit: Pencil, branch: GitBranch, server: Server, copy: Copy, reply: Reply, send: Send, unlink: Unlink, read: BookOpenText, "arrow-down": ArrowDown, equal: Equal, "arrow-up": ArrowUp, "chevrons-up": ChevronsUp };

export type IconName = keyof typeof icons;

export const Icon = (props: { name: IconName; filled?: boolean }) => (
  <Dynamic component={icons[props.name]} class="icon" aria-hidden="true" width={16} height={16} stroke-width={1.75} stroke-linecap="round" stroke-linejoin="round" fill={props.filled ? "currentColor" : "none"} />
);
