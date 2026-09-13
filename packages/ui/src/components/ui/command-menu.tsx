"use client";

import {
  createContext,
  forwardRef,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { cn } from "../../lib/cn";
import { spring } from "../../lib/springs";
import { useIcon, type IconComponent } from "../../lib/icon-context";
import { shapeMap } from "../../lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "../../lib/size-context";
import { isDisabledRow } from "../../lib/popup";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
  type UseFluidHoverReturn,
} from "../../hooks/use-fluid-hover";
import { ScrollArea } from "./scroll-area";
import {
  FluidHoverHighlight,
  type FluidHoverSource,
} from "./fluid-hover-highlight";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./dialog";
import { TabsSubtle, TabsSubtleItem } from "./tabs-subtle";

// ---------------------------------------------------------------------------
// Command menu
//
// A search field over a list of actions: type to filter, arrows to move the
// highlight, Enter to run. The input keeps DOM focus the whole time and
// points at the highlighted row through aria-activedescendant, so the list
// needs no primitive of its own; the one thing a primitive would add, the
// modal shell, comes from the Dialog this file imports (CommandMenuDialog).
//
// Items are data: pass `items` to the root and the list renders a row per
// match, grouped under their `group` headings. Rows are yours to customize
// through `renderItem`, or through the props on CommandMenuItem. The panel
// is sized by its rows: give the root (or its dialog) a max-height and the
// list scrolls past it.
//
// The highlight is the fluid hover fill and nothing else: the pointer moves
// it through useFluidHover, the keyboard moves it through setActiveIndex,
// and Enter runs whatever it sits on. There is no focus ring in the list,
// like the dropdown and combobox popups.
// ---------------------------------------------------------------------------

export interface CommandMenuItemData {
  /** Unique id. Doubles as the row's key and `aria-activedescendant` target. */
  value: string;
  label: string;
  /** What the footer names Enter while the row is highlighted, e.g. "Open
   *  Showcase" for a row labelled "Showcase". Defaults to the label. */
  action?: string;
  /** Secondary text after the label: the label's size, one contrast step
   *  lower. */
  description?: string;
  icon?: IconComponent;
  /** Keys shown at the row's trailing edge, e.g. `"mod+p"` or `"⌘⇧P"`.
   *  Display only: bind the combo yourself. */
  shortcut?: string;
  /** Extra terms the filter matches besides label and description. */
  keywords?: readonly string[];
  /** Heading the row is listed under. Groups keep the order their first
   *  item appears in; ungrouped items form an unlabelled section. */
  group?: string;
  disabled?: boolean;
  /** Runs when the row is picked, before the root's `onSelect`. */
  onSelect?: () => void;
}

/** Contiguous slice of the visible rows under one heading. */
interface CommandMenuSection {
  id: string;
  heading: string | null;
  items: CommandMenuItemData[];
  /** Flat index of the section's first row. */
  start: number;
}

// The list keeps the smaller "rounded" radii whatever the rest of the UI is
// shaped, like every popup list: pill rows inside a square panel distort the
// concentric fit of the hover fill. The dialog shell follows the global
// shape through DialogContent.
const listShape = shapeMap.rounded;

// ---------------------------------------------------------------------------
// Shortcuts — one string syntax for both the trigger combo and the caps a row
// displays. Tokens join with "+": modifiers first, then one key.
//   "mod+k"        ⌘K on a Mac, Ctrl+K elsewhere
//   "mod+shift+p"  ⌘⇧P / Ctrl+Shift+P
//   "/"            a bare key
// Pre-formatted caps ("⌘K", "⌘⇧P") display as-is, one cap per glyph.
// ---------------------------------------------------------------------------

export interface ParsedShortcut {
  /** ⌘ on a Mac, Ctrl elsewhere. Matches either while listening, so a Ctrl
   *  press on a Mac still opens the menu. */
  mod: boolean;
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** Lowercase `KeyboardEvent.key` ("k", "/", "escape"). */
  key: string;
}

const MODIFIER_TOKENS: Record<string, keyof Omit<ParsedShortcut, "key">> = {
  mod: "mod",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  win: "meta",
  super: "meta",
  ctrl: "ctrl",
  control: "ctrl",
  alt: "alt",
  option: "alt",
  opt: "alt",
  shift: "shift",
};

/** Named keys, as `KeyboardEvent.key` spells them (lowercased). */
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  space: " ",
  spacebar: " ",
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  del: "delete",
  plus: "+",
};

/** Splits a combo on "+", keeping a trailing "+" as the key itself. */
function shortcutTokens(shortcut: string): string[] {
  const trimmed = shortcut.trim();
  if (trimmed === "") return [];
  const tokens = trimmed.split("+").map((t) => t.trim());
  // "mod++" splits into ["mod", "", ""]: the empties were a literal "+".
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === "" && i > 0) {
      if (out[out.length - 1] !== "+") out.push("+");
      continue;
    }
    if (tokens[i] !== "") out.push(tokens[i]);
  }
  return out;
}

export function parseShortcut(shortcut: string): ParsedShortcut {
  const parsed: ParsedShortcut = {
    mod: false,
    meta: false,
    ctrl: false,
    alt: false,
    shift: false,
    key: "",
  };
  for (const token of shortcutTokens(shortcut)) {
    const lower = token.toLowerCase();
    const modifier = MODIFIER_TOKENS[lower];
    if (modifier) parsed[modifier] = true;
    else parsed.key = KEY_ALIASES[lower] ?? lower;
  }
  return parsed;
}

/** Whether a keydown is the parsed combo. The physical key (`code`) stands
 *  in only when `key` is not a Latin letter or digit: ⌥ combos on a Mac
 *  (where `key` becomes a symbol) and non-Latin layouts (Cyrillic, Greek).
 *  A Latin letter is taken at face value, so on Dvorak or AZERTY the key
 *  that types "t" is never read as the physical K. */
export function matchesShortcut(
  e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  parsed: ParsedShortcut
): boolean {
  if (parsed.key === "") return false;
  const key = e.key.toLowerCase();
  const byCode =
    parsed.key.length === 1 &&
    /[a-z0-9]/.test(parsed.key) &&
    (e.altKey || !/^[a-z0-9]$/i.test(e.key)) &&
    e.code.toLowerCase() === (/[a-z]/.test(parsed.key) ? `key${parsed.key}` : `digit${parsed.key}`);
  if (key !== parsed.key && !byCode) return false;
  if (parsed.mod) {
    if (!e.metaKey && !e.ctrlKey) return false;
  } else if (e.metaKey !== parsed.meta || e.ctrlKey !== parsed.ctrl) {
    return false;
  }
  if (e.altKey !== parsed.alt) return false;
  // Shift is implied by an uppercase letter or a shifted symbol, so it is
  // only checked when the combo names it.
  if (parsed.shift && !e.shiftKey) return false;
  return true;
}

/** Whether the parsed combo holds any modifier, i.e. is safe to fire while
 *  typing in a field. A bare key stays out of inputs. */
export function hasModifier(parsed: ParsedShortcut): boolean {
  return parsed.mod || parsed.meta || parsed.ctrl || parsed.alt;
}

const CAP_LABELS: Record<string, { mac: string; other: string }> = {
  mod: { mac: "⌘", other: "Ctrl" },
  meta: { mac: "⌘", other: "Win" },
  ctrl: { mac: "⌃", other: "Ctrl" },
  alt: { mac: "⌥", other: "Alt" },
  shift: { mac: "⇧", other: "Shift" },
  enter: { mac: "↵", other: "Enter" },
  escape: { mac: "Esc", other: "Esc" },
  backspace: { mac: "⌫", other: "Backspace" },
  delete: { mac: "⌦", other: "Del" },
  tab: { mac: "⇥", other: "Tab" },
  " ": { mac: "Space", other: "Space" },
  arrowup: { mac: "↑", other: "↑" },
  arrowdown: { mac: "↓", other: "↓" },
  arrowleft: { mac: "←", other: "←" },
  arrowright: { mac: "→", other: "→" },
};

const PREFORMATTED = /^[⌘⌃⌥⇧↵⌫⌦⇥↑↓←→]+[A-Za-z0-9]?$/;

/** The caps a shortcut displays, in order: modifiers as symbols on a Mac and
 *  words elsewhere, letters upper-cased, named keys spelled out. */
export function formatShortcut(shortcut: string, mac: boolean): string[] {
  const caps: string[] = [];
  for (const token of shortcutTokens(shortcut)) {
    if (PREFORMATTED.test(token)) {
      caps.push(...Array.from(token));
      continue;
    }
    const lower = token.toLowerCase();
    const modifier = MODIFIER_TOKENS[lower];
    const name = modifier ?? (KEY_ALIASES[lower] ?? lower);
    const cap = CAP_LABELS[name];
    if (cap) caps.push(mac ? cap.mac : cap.other);
    else if (name.length === 1) caps.push(name.toUpperCase());
    else caps.push(name.charAt(0).toUpperCase() + name.slice(1));
  }
  return caps;
}

/** Whether the page runs on a Mac — the platform that draws ⌘ and ⌥. */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// The platform never changes, so it is read once and served as a store
// snapshot: the server (and hydration) draw ⌘, other platforms swap to
// words in the render that follows, with no state or effect per cap.
let macPlatform: boolean | null = null;
const readMac = () => (macPlatform ??= isMacPlatform());
const serverMac = () => true;
const subscribeNever = () => () => {};

/** Whether to draw ⌘ and ⌥ rather than Ctrl and Alt. */
export function useIsMac(): boolean {
  return useSyncExternalStore(subscribeNever, readMac, serverMac);
}

// Layout effects have no server counterpart; on the server they are no-ops.
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable
  );
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Every word of the query appears somewhere in the label, description, or
 *  keywords, case-insensitively. Order is kept: rows never re-sort under
 *  the cursor as the query grows. */
export function defaultCommandMenuFilter(
  item: CommandMenuItemData,
  query: string
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [item.label, item.description ?? "", ...(item.keywords ?? [])]
    .join(" ")
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** Groups the visible rows into sections, suggestions first while the query
 *  is empty. Exported for the unit test. */
export function sectionRows(
  visible: readonly CommandMenuItemData[],
  suggestions: readonly string[] | undefined,
  suggestionsLabel: string,
  query: string
): CommandMenuSection[] {
  const sections: CommandMenuSection[] = [];
  const byHeading = new Map<string | null, CommandMenuSection>();
  const suggested = new Set(query === "" ? suggestions ?? [] : []);
  let index = 0;
  const push = (heading: string | null, id: string, item: CommandMenuItemData) => {
    let section = byHeading.get(heading);
    if (!section) {
      section = { id, heading, items: [], start: 0 };
      byHeading.set(heading, section);
      sections.push(section);
    }
    section.items.push(item);
  };
  // Suggested rows lead, in the order `suggestions` lists them, and leave
  // their own group so nothing is listed twice.
  if (suggested.size > 0) {
    const pool = new Map(visible.map((item) => [item.value, item]));
    for (const value of suggestions ?? []) {
      const item = pool.get(value);
      if (item) push(suggestionsLabel, "suggestions", item);
    }
  }
  for (const item of visible) {
    if (suggested.has(item.value)) continue;
    push(item.group ?? null, item.group ? `group:${item.group}` : "ungrouped", item);
  }
  for (const section of sections) {
    section.start = index;
    index += section.items.length;
  }
  return sections;
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

/** The highlighted index as a store: rows and the field subscribe to the
 *  one value they need, so a highlight change re-renders the two rows it
 *  concerns instead of every row in the list. */
interface HighlightStore {
  get: () => number | null;
  subscribe: (listener: () => void) => () => void;
}

interface CommandMenuContextValue {
  query: string;
  setQuery: (query: string) => void;
  sections: CommandMenuSection[];
  /** The visible rows, flat, in list order: the keyboard's index space. */
  rows: CommandMenuItemData[];
  itemsByValue: Map<string, CommandMenuItemData>;
  listId: string;
  listRef: RefObject<HTMLDivElement | null>;
  inputRef: RefObject<HTMLInputElement | null>;
  /** The fluid hover hook's stable parts. The changing parts (the index,
   *  the rects) travel through `highlight` and CommandMenuFillContext so
   *  this value holds still while the pointer moves. */
  registerItem: UseFluidHoverReturn["registerItem"];
  setActiveIndex: Dispatch<SetStateAction<number | null>>;
  listHandlers: UseFluidHoverReturn["handlers"];
  highlight: HighlightStore;
  select: (item: CommandMenuItemData) => void;
  /** Moves the highlight from the keyboard: a step (wrapping), or an end. */
  move: (to: 1 | -1 | "first" | "last") => void;
  /** The mounted CommandMenuTabs, so ← and → in the field switch tabs. */
  tabsRef: RefObject<CommandMenuTabsHandle | null>;
  tabsMounted: boolean;
  setTabsMounted: (mounted: boolean) => void;
}

/** What the list's fill reads: the index and the measured rects. Its own
 *  context, so only the list re-renders as the fill travels. */
const CommandMenuFillContext = createContext<FluidHoverSource | null>(null);

interface CommandMenuTabsHandle {
  tabs: readonly CommandMenuTab[];
  value: string;
  onValueChange: (value: string) => void;
}

const CommandMenuContext = createContext<CommandMenuContextValue | null>(null);

function useCommandMenu(): CommandMenuContextValue {
  const ctx = useContext(CommandMenuContext);
  if (!ctx)
    throw new Error("CommandMenu compound components must be inside <CommandMenu>");
  return ctx;
}

// Each rendered row learns its flat index from the list, so custom rows
// never number themselves.
const CommandMenuIndexContext = createContext<number>(0);

interface CommandMenuDialogContextValue {
  close: () => void;
}

const CommandMenuDialogContext = createContext<CommandMenuDialogContextValue | null>(null);

// ---------------------------------------------------------------------------
// CommandMenu (root)
// ---------------------------------------------------------------------------

export interface CommandMenuProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  /** The actions. Keep the array stable (state, a module constant, or a
   *  memo): the highlight resets to the first row when it changes. */
  items: readonly CommandMenuItemData[];
  /** Runs when a row is picked, after the item's own `onSelect`. */
  onSelect?: (item: CommandMenuItemData) => void;
  /** Match an item against the query. Default: every word of the query
   *  appears in the label, description, or keywords. */
  filter?: (item: CommandMenuItemData, query: string) => boolean;
  /** Controlled query. */
  query?: string;
  defaultQuery?: string;
  onQueryChange?: (query: string) => void;
  /** Values listed first, under `suggestionsLabel`, while nothing is typed.
   *  A suggested row leaves its own group so it is listed once. */
  suggestions?: readonly string[];
  /** @default "Suggestions" */
  suggestionsLabel?: string;
  /** Inside CommandMenuDialog: picking a row closes the dialog.
   *  @default true */
  closeOnSelect?: boolean;
  /** Pins field and rows to one step of the size ladder (default 36px rows,
   *  compact 28px). Omitted, both follow the surrounding SizeProvider. */
  size?: SizeVariant;
  children: ReactNode;
}

const CommandMenu = forwardRef<HTMLDivElement, CommandMenuProps>(
  (
    {
      items,
      onSelect,
      filter = defaultCommandMenuFilter,
      query: queryProp,
      defaultQuery = "",
      onQueryChange,
      suggestions,
      suggestionsLabel = "Suggestions",
      closeOnSelect = true,
      size,
      className,
      children,
      ...props
    },
    ref
  ) => {
    const listId = useId();
    const listRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const dialog = useContext(CommandMenuDialogContext);
    const tabsRef = useRef<CommandMenuTabsHandle | null>(null);
    const [tabsMounted, setTabsMounted] = useState(false);

    const [internalQuery, setInternalQuery] = useState(defaultQuery);
    const query = queryProp ?? internalQuery;
    const setQuery = useCallback(
      (next: string) => {
        if (queryProp === undefined) setInternalQuery(next);
        onQueryChange?.(next);
      },
      [queryProp, onQueryChange]
    );

    const itemsByValue = useMemo(() => {
      const map = new Map<string, CommandMenuItemData>();
      for (const item of items) map.set(item.value, item);
      return map;
    }, [items]);

    const sections = useMemo(() => {
      const visible = query === "" ? items : items.filter((item) => filter(item, query));
      return sectionRows(visible, suggestions, suggestionsLabel, query);
    }, [items, query, filter, suggestions, suggestionsLabel]);
    const rows = useMemo(() => sections.flatMap((s) => s.items), [sections]);
    // What the rows ARE, not the array's identity: an inline `items` literal
    // re-runs the memos every render, and only a real change may reset the
    // highlight.
    // Joined on a NUL so values with spaces cannot collide.
    const rowsKey = rows.map((row) => row.value).join("\u0000");

    // The highlight lives in the fluid hover hook. It is created here, at the
    // root, so the input can drive it; the list attaches `listRef` as its
    // container (the child's effects run before the root's, so the ref is
    // set by the time the hook observes it).
    const hover = useFluidHover(listRef, { isItemDisabled: isDisabledRow });
    const { activeIndex, setActiveIndex, registerItem, itemRects, isMeasured, sessionRef } = hover;
    const { onMouseEnter, onMouseMove, onMouseLeave, onClick } = hover.handlers;
    const listHandlers = useMemo(
      () => ({ onMouseEnter, onMouseMove, onMouseLeave, onClick }),
      [onMouseEnter, onMouseMove, onMouseLeave, onClick]
    );

    // The highlight, published as a store right after each commit: rows and
    // the field subscribe to the one value they need, so a change re-renders
    // the two rows it concerns, not the list.
    const highlightRef = useRef<number | null>(null);
    const listenersRef = useRef(new Set<() => void>());
    const highlight = useMemo<HighlightStore>(
      () => ({
        get: () => highlightRef.current,
        subscribe: (listener) => {
          listenersRef.current.add(listener);
          return () => {
            listenersRef.current.delete(listener);
          };
        },
      }),
      []
    );
    useIsoLayoutEffect(() => {
      highlightRef.current = activeIndex;
      listenersRef.current.forEach((listener) => listener());
    }, [activeIndex]);
    const fill = useMemo<FluidHoverSource>(
      () => ({ activeIndex, itemRects, isMeasured, sessionRef }),
      [activeIndex, itemRects, isMeasured, sessionRef]
    );

    // Scrolling is the root's, done the moment a move is decided rather
    // than in an effect on the index: a move to the row already highlighted
    // (Home at the top, ↓ in a one-row list, a query that keeps row 0) must
    // still scroll, and no flag can be left behind for a pointer move to
    // pick up. A keyboard move keeps its row at the CENTER of the viewport
    // (as far as the ends allow) and the viewport travels there on the same
    // fast spring as the highlight, so row and fill move together; a query
    // reset snaps to the top, heading included. Offsets, not rects: the
    // row's offsetParent is the list, whose offsetParent is the scroll
    // area's root that the viewport fills, so their sum is the row's place
    // in the scroll content whatever transform an ancestor carries. Never
    // scrollIntoView, which also scrolls the page.
    const reduceMotion = useReducedMotion() ?? false;
    const scrollAnimationRef = useRef<{ stop: () => void } | null>(null);
    const scrollToRow = useCallback(
      (index: number, mode: "center" | "top") => {
        const list = listRef.current;
        const viewport = list?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
        if (!list || !viewport) return;
        scrollAnimationRef.current?.stop();
        scrollAnimationRef.current = null;
        if (mode === "top" || index === 0) {
          viewport.scrollTop = 0;
          return;
        }
        const row = list.querySelector<HTMLElement>(`[data-fluid-hover-index="${index}"]`);
        if (!row) return;
        const rowTop = row.offsetTop + list.offsetTop;
        const target = Math.max(
          0,
          Math.min(
            rowTop + row.offsetHeight / 2 - viewport.clientHeight / 2,
            viewport.scrollHeight - viewport.clientHeight
          )
        );
        if (reduceMotion) {
          viewport.scrollTop = target;
          return;
        }
        scrollAnimationRef.current = animate(viewport.scrollTop, target, {
          ...spring.fast,
          onUpdate: (value) => {
            viewport.scrollTop = value;
          },
        });
      },
      [reduceMotion]
    );
    useEffect(() => () => scrollAnimationRef.current?.stop(), []);

    // The first enabled row is highlighted whenever the row set changes, so
    // Enter always has a target and it follows the query as it filters.
    const rowsRef = useRef(rows);
    rowsRef.current = rows;
    useEffect(() => {
      const first = rowsRef.current.findIndex((row) => !row.disabled);
      setActiveIndex(first === -1 ? null : first);
      scrollToRow(0, "top");
    }, [rowsKey, setActiveIndex, scrollToRow]);

    const move = useCallback(
      (to: 1 | -1 | "first" | "last") => {
        const enabled: number[] = [];
        rowsRef.current.forEach((row, i) => {
          if (!row.disabled) enabled.push(i);
        });
        if (enabled.length === 0) return;
        let next: number;
        if (to === "first") next = enabled[0];
        else if (to === "last") next = enabled[enabled.length - 1];
        else {
          const current = highlightRef.current;
          const pos = current === null ? -1 : enabled.indexOf(current);
          // Wraps at both ends: the list is the whole keyboard space, there
          // is no field to stop at.
          if (pos === -1) next = to === 1 ? enabled[0] : enabled[enabled.length - 1];
          else next = enabled[(pos + to + enabled.length) % enabled.length];
        }
        setActiveIndex(next);
        scrollToRow(next, "center");
      },
      [setActiveIndex, scrollToRow]
    );

    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const select = useCallback(
      (item: CommandMenuItemData) => {
        if (item.disabled) return;
        item.onSelect?.();
        onSelectRef.current?.(item);
        if (closeOnSelect) dialog?.close();
      },
      [closeOnSelect, dialog]
    );

    const ctx = useMemo<CommandMenuContextValue>(
      () => ({
        query,
        setQuery,
        sections,
        rows,
        itemsByValue,
        listId,
        listRef,
        inputRef,
        registerItem,
        setActiveIndex,
        listHandlers,
        highlight,
        select,
        move,
        tabsRef,
        tabsMounted,
        setTabsMounted,
      }),
      [
        query,
        setQuery,
        sections,
        rows,
        itemsByValue,
        listId,
        registerItem,
        setActiveIndex,
        listHandlers,
        highlight,
        select,
        move,
        tabsMounted,
      ]
    );

    // The panel follows its rows: the column inside is measured (offsetHeight,
    // transform-immune) and the frame springs to that number on the moderate
    // tier. Never "auto": framer would read the visual size under a scaled
    // ancestor. Reduced motion snaps. max-h inherits down the chain, so a
    // cap on the wrapper (or on this root's className) bounds the column and
    // the list scrolls past it.
    const columnRef = useRef<HTMLDivElement | null>(null);
    const [height, setHeight] = useState<number | null>(null);
    useEffect(() => {
      const el = columnRef.current;
      if (!el || typeof ResizeObserver === "undefined") return;
      const update = () => setHeight(el.offsetHeight);
      update();
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    const root = (
      <CommandMenuContext.Provider value={ctx}>
        <CommandMenuFillContext.Provider value={fill}>
          <div
            ref={ref}
            data-slot="command-menu"
            className={cn("relative w-full max-h-[inherit] overflow-hidden", className)}
            {...props}
          >
            <motion.div
              className="max-h-[inherit] overflow-hidden"
              initial={false}
              animate={height === null ? {} : { height }}
              transition={reduceMotion ? { duration: 0 } : spring.moderate}
            >
              <div ref={columnRef} className="flex max-h-[inherit] min-h-0 flex-col">
                {children}
              </div>
            </motion.div>
          </div>
        </CommandMenuFillContext.Provider>
      </CommandMenuContext.Provider>
    );

    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  }
);

CommandMenu.displayName = "CommandMenu";

// ---------------------------------------------------------------------------
// CommandMenuInput — the search field. Keeps focus; arrows and Enter act on
// the list through aria-activedescendant.
// ---------------------------------------------------------------------------

export interface CommandMenuInputProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "size"
  > {
  placeholder?: string;
  /** Leading icon. @default the search icon */
  icon?: IconComponent | null;
}

const CommandMenuInput = forwardRef<HTMLInputElement, CommandMenuInputProps>(
  (
    { className, placeholder = "Type a command or search…", icon, onKeyDown, ...props },
    ref
  ) => {
    const SearchIcon = useIcon("search");
    const Icon = icon === undefined ? SearchIcon : icon;
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    const { query, setQuery, rows, listId, inputRef, highlight, select, move, tabsRef } =
      useCommandMenu();
    const activeIndex = useSyncExternalStore(highlight.subscribe, highlight.get, () => null);
    const dialog = useContext(CommandMenuDialogContext);

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) return;
      // Keys inside an IME composition belong to the composer: Enter commits
      // a candidate, the arrows pick one. (Safari reports the commit as
      // keyCode 229 after compositionend.)
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      switch (e.key) {
        case "ArrowLeft":
        case "ArrowRight": {
          // With tabs under the field, ← and → switch tabs (wrapping) instead
          // of moving the caret. Modified presses keep their editing meaning.
          const tabs = tabsRef.current;
          if (!tabs || tabs.tabs.length === 0 || e.altKey || e.metaKey || e.ctrlKey) return;
          e.preventDefault();
          const count = tabs.tabs.length;
          const current = tabs.tabs.findIndex((tab) => tab.value === tabs.value);
          const step = e.key === "ArrowRight" ? 1 : -1;
          const next = ((current === -1 ? 0 : current) + step + count) % count;
          tabs.onValueChange(tabs.tabs[next].value);
          return;
        }
        case "ArrowDown":
          e.preventDefault();
          move(1);
          return;
        case "ArrowUp":
          e.preventDefault();
          move(-1);
          return;
        case "Home":
          if (query !== "") return; // the caret's own Home
          e.preventDefault();
          move("first");
          return;
        case "End":
          if (query !== "") return;
          e.preventDefault();
          move("last");
          return;
        case "Enter": {
          e.preventDefault();
          const row = activeIndex === null ? undefined : rows[activeIndex];
          if (row) select(row);
          return;
        }
        case "Escape":
          // In a dialog the shell closes on Escape. Inline, Escape clears
          // what was typed.
          if (dialog || query === "") return;
          e.preventDefault();
          setQuery("");
          return;
        default:
          return;
      }
    };

    return (
      <div
        data-slot="command-menu-input"
        className={cn(
          "group/command-input flex shrink-0 items-center",
          compact ? "h-10 gap-2 px-3" : "h-12 gap-2.5 px-4"
        )}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-focus-within/command-input:text-foreground group-focus-within/command-input:stroke-[2]"
          />
        )}
        <input
          ref={(node) => {
            inputRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          type="text"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex === null ? undefined : `${listId}-${activeIndex}`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          // rounded-none: the base :focus-visible rule hands focused elements
          // the shape radius, and a text input clips its caret to its corners.
          className={cn(
            "min-w-0 flex-1 rounded-none bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-[inherit]",
            // One notch above the rows' body size: the field is the palette's
            // title line. The line box keeps the caret in proportion.
            compact ? "text-[13px] leading-5" : "text-[14px] leading-6",
            className
          )}
          {...props}
        />
      </div>
    );
  }
);

CommandMenuInput.displayName = "CommandMenuInput";

// ---------------------------------------------------------------------------
// CommandMenuTabs — subtle tabs under the field. The tabs are state you own:
// derive `items` from the value so the list follows.
// ---------------------------------------------------------------------------

export interface CommandMenuTab {
  value: string;
  label: string;
  icon?: IconComponent;
}

export interface CommandMenuTabsProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  tabs: readonly CommandMenuTab[];
  value: string;
  onValueChange: (value: string) => void;
  /** Sits at the trailing edge of the tab row, hugging its content: a
   *  CommandMenuFilters, a Button. The tabs take the room that is left. */
  children?: ReactNode;
}

// Tells a CommandMenuFilters it is inside the tab row, where the row owns
// the padding and the bar only hugs its controls.
const TabsRowContext = createContext(false);

const CommandMenuTabs = forwardRef<HTMLDivElement, CommandMenuTabsProps>(
  ({ tabs, value, onValueChange, className, children, ...props }, ref) => {
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    const { tabsRef, setTabsMounted } = useCommandMenu();
    const selectedIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.value === value)
    );

    // The field reads the latest tabs and value from the ref on each ← / →,
    // so nothing re-renders on registration but the footer's hint. A layout
    // effect, not a render-phase write: on a keyed remount the outgoing
    // instance's cleanup runs before the incoming one's effect, so the ref
    // is never left empty while the footer still announces the tabs.
    useIsoLayoutEffect(() => {
      tabsRef.current = { tabs, value, onValueChange };
      return () => {
        tabsRef.current = null;
      };
    }, [tabsRef, tabs, value, onValueChange]);
    useEffect(() => {
      setTabsMounted(true);
      return () => setTabsMounted(false);
    }, [setTabsMounted]);

    return (
      <div
        ref={ref}
        data-slot="command-menu-tabs"
        className={cn(
          "flex shrink-0 items-center",
          compact ? "gap-1 px-2 pb-1.5" : "gap-2 px-2.5 pb-2",
          className
        )}
        {...props}
      >
        <div
          // A pointer pick must not take focus from the field (the tabs are
          // buttons); keyboard users still reach them with Tab. No overflow
          // clip here: TabsSubtle scrolls itself and keeps 4px of room around
          // the tabs for the 2px-outset focus ring, which a second scroll
          // container this tight would crop.
          onMouseDown={(e) => e.preventDefault()}
          className="flex min-w-0 flex-1 items-center"
        >
          <TabsSubtle
            size="compact"
            selectedIndex={selectedIndex}
            onSelect={(index) => {
              const tab = tabs[index];
              if (tab) onValueChange(tab.value);
            }}
            aria-label="Filter results"
          >
            {tabs.map((tab, index) => (
              <TabsSubtleItem key={tab.value} index={index} label={tab.label} icon={tab.icon} />
            ))}
          </TabsSubtle>
        </div>
        {children && (
          <TabsRowContext.Provider value={true}>
            <div className="ml-auto flex shrink-0 items-center">{children}</div>
          </TabsRowContext.Provider>
        )}
      </div>
    );
  }
);

CommandMenuTabs.displayName = "CommandMenuTabs";

// ---------------------------------------------------------------------------
// CommandMenuFilters — a borderless bar under the field for compact controls
// (borderless Selects, ghost Buttons). Nothing frames it: the controls sit
// on the panel's own surface and the list's divider closes the header.
// ---------------------------------------------------------------------------

export type CommandMenuFiltersProps = HTMLAttributes<HTMLDivElement>;

const CommandMenuFilters = forwardRef<HTMLDivElement, CommandMenuFiltersProps>(
  ({ className, children, ...props }, ref) => {
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    // Inside a tab row the bar hugs its controls; on its own it is a row of
    // the header, with the header's inset and wrapping room.
    const inTabsRow = useContext(TabsRowContext);
    return (
      <div
        ref={ref}
        data-slot="command-menu-filters"
        className={cn(
          "flex shrink-0 items-center gap-1",
          // Controls hug their content: a Select trigger drops the field
          // width it keeps in forms.
          "[&_[role=combobox]]:w-auto [&_[role=combobox]]:min-w-0",
          !inTabsRow && "flex-wrap",
          !inTabsRow && (compact ? "px-2 pb-1.5" : "px-2.5 pb-2"),
          className
        )}
        {...props}
      >
        <SizeProvider size="compact">{children}</SizeProvider>
      </div>
    );
  }
);

CommandMenuFilters.displayName = "CommandMenuFilters";

// ---------------------------------------------------------------------------
// CommandMenuList — the scrolling rows under a divider, grouped by heading,
// with the fluid hover fill.
// ---------------------------------------------------------------------------

export interface CommandMenuListProps extends HTMLAttributes<HTMLDivElement> {
  /** Custom rows: return a CommandMenuItem (or anything built on one) per
   *  visible item. Default renders `<CommandMenuItem value={item.value} />`. */
  renderItem?: (item: CommandMenuItemData, index: number) => ReactNode;
  /** Static children of the list, e.g. CommandMenuEmpty. */
  children?: ReactNode;
}

const CommandMenuList = forwardRef<HTMLDivElement, CommandMenuListProps>(
  ({ className, children, renderItem, ...props }, ref) => {
    const { sections, rows, listId, listRef, setActiveIndex, listHandlers } = useCommandMenu();
    const fill = useContext(CommandMenuFillContext);
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    const empty = rows.length === 0;

    // The pointer leaving the list keeps the highlight where it was: Enter
    // still has a target, and the fill stays on the row the field points at.
    const lastActiveRef = useRef<number | null>(null);
    if (fill && fill.activeIndex !== null) lastActiveRef.current = fill.activeIndex;
    const handleMouseLeave = () => {
      listHandlers.onMouseLeave();
      setActiveIndex(lastActiveRef.current);
    };

    return (
      // Not the popup viewport class: a palette is sized by its rows up to
      // its shell's max-height, which leaves every box on the way
      // indefinite, so a percentage height on the viewport never resolves.
      // Flex does what percentages cannot: the area shrinks to what the
      // shell leaves it, and the viewport shrinks with it (min-h-0) and
      // scrolls; short content sizes both to the rows.
      // scroll-divider draws the edges: the top hairline rides the header
      // line (pulled up 1px onto it) and strengthens once rows pass under
      // it; the bottom hairline stands while rows continue below and goes at
      // the end, which is why the footer draws no line of its own.
      <ScrollArea
        className="scroll-divider flex min-h-0 flex-1 flex-col border-t border-border/60 [&::before]:!-top-px"
        viewportClassName="min-h-0 flex-1 [&>div[style]]:!block [&>div[style]]:!min-w-0 [--scroll-fade-size:32px] scroll-fade"
      >
        <div
          ref={(node) => {
            listRef.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          id={listId}
          role="listbox"
          tabIndex={-1}
          data-slot="command-menu-list"
          data-empty={empty || undefined}
          onMouseEnter={listHandlers.onMouseEnter}
          onMouseMove={listHandlers.onMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={listHandlers.onClick}
          // A row click must not blur the field: the palette is driven from
          // the keyboard, and the click already picked.
          onMouseDown={(e) => e.preventDefault()}
          className={cn(
            // The list is the fill's offsetParent, so rows and fill scroll
            // together inside the viewport. Padding collapses when empty.
            "relative flex flex-col gap-1 p-1 outline-none data-[empty]:p-0",
            className
          )}
          {...props}
        >
          {fill && <FluidHoverHighlight hover={fill} className={listShape.bg} />}
          {children}
          {sections.map((section, sectionIndex) => {
            // Ids from the section's position, never its heading text: a
            // heading with a space ("Go to") would split aria-labelledby
            // into two ids that exist nowhere.
            const headingId = section.heading ? `${listId}-group-${sectionIndex}` : undefined;
            return (
              <div
                key={section.id}
                role="group"
                aria-labelledby={headingId}
                className="flex flex-col"
              >
                {section.heading && (
                  <div
                    id={headingId}
                    role="presentation"
                    className={cn(
                      "flex shrink-0 items-center text-caption text-muted-foreground",
                      compact ? "h-6 px-1.5" : "h-7 px-2"
                    )}
                  >
                    {section.heading}
                  </div>
                )}
                {section.items.map((item, i) => {
                  const index = section.start + i;
                  return (
                    <CommandMenuIndexContext.Provider key={item.value} value={index}>
                      {renderItem ? renderItem(item, index) : <CommandMenuItem value={item.value} />}
                    </CommandMenuIndexContext.Provider>
                  );
                })}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    );
  }
);

CommandMenuList.displayName = "CommandMenuList";

// ---------------------------------------------------------------------------
// CommandMenuEmpty — shown in place of the rows when nothing matches.
// ---------------------------------------------------------------------------

export type CommandMenuEmptyProps = HTMLAttributes<HTMLDivElement>;

const CommandMenuEmpty = forwardRef<HTMLDivElement, CommandMenuEmptyProps>(
  ({ className, ...props }, ref) => {
    const { rows } = useCommandMenu();
    const sizeClasses = useSize();
    if (rows.length > 0) return null;
    return (
      <div
        ref={ref}
        role="status"
        aria-live="polite"
        data-slot="command-menu-empty"
        className={cn(
          "px-3 py-6 text-center text-muted-foreground",
          sizeClasses.text,
          className
        )}
        {...props}
      />
    );
  }
);

CommandMenuEmpty.displayName = "CommandMenuEmpty";

// ---------------------------------------------------------------------------
// CommandMenuShortcut — the caps at a row's trailing edge.
// ---------------------------------------------------------------------------

export interface CommandMenuShortcutProps extends HTMLAttributes<HTMLElement> {
  /** The combo, in the trigger syntax (`"mod+p"`) or pre-formatted (`"⌘P"`).
   *  A list draws each entry as its own cap: `["up", "down"]`. */
  keys: string | readonly string[];
}

const CommandMenuShortcut = forwardRef<HTMLElement, CommandMenuShortcutProps>(
  ({ keys, className, ...props }, ref) => {
    const mac = useIsMac();
    const compact = useSize().variant === "compact";
    const caps = (typeof keys === "string" ? [keys] : keys).flatMap((k) =>
      formatShortcut(k, mac)
    );
    return (
      <kbd
        ref={ref}
        data-slot="command-menu-shortcut"
        className={cn("ml-auto inline-flex shrink-0 items-center gap-0.5 align-middle font-sans", className)}
        {...props}
      >
        {caps.map((cap, i) => (
          <span
            key={`${cap}-${i}`}
            className={cn(
              "flex items-center justify-center rounded-[5px] bg-hover text-muted-foreground",
              compact ? "h-4 min-w-4 px-1 text-[10px]" : "h-5 min-w-5 px-1 text-[11px]"
            )}
          >
            {cap}
          </span>
        ))}
      </kbd>
    );
  }
);

CommandMenuShortcut.displayName = "CommandMenuShortcut";

// ---------------------------------------------------------------------------
// CommandMenuItem — one row. Reads its data from the root by `value`; any
// prop set here overrides it.
// ---------------------------------------------------------------------------

export interface CommandMenuItemProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "onSelect"> {
  value: string;
  label?: string;
  description?: string;
  icon?: IconComponent;
  shortcut?: string;
  disabled?: boolean;
  onSelect?: () => void;
}

// Memoized: the list re-renders as the fill travels, and a row whose props
// did not change (the default row has only `value`) must not follow it.
const CommandMenuItem = memo(forwardRef<HTMLDivElement, CommandMenuItemProps>(
  (
    {
      value,
      label,
      description,
      icon,
      shortcut,
      disabled,
      onSelect,
      className,
      onClick,
      children,
      ...props
    },
    ref
  ) => {
    const { itemsByValue, listId, registerItem, highlight, select } = useCommandMenu();
    const index = useContext(CommandMenuIndexContext);
    const internalRef = useRef<HTMLDivElement | null>(null);
    const sizeClasses = useSize();
    // One boolean per row: a highlight change re-renders the row it left
    // and the row it reached, and no other.
    const isActive = useSyncExternalStore(
      highlight.subscribe,
      () => highlight.get() === index,
      () => false
    );

    const data = itemsByValue.get(value);
    const item: CommandMenuItemData = {
      ...(data ?? { value, label: value }),
      ...(label !== undefined && { label }),
      ...(description !== undefined && { description }),
      ...(icon !== undefined && { icon }),
      ...(shortcut !== undefined && { shortcut }),
      ...(disabled !== undefined && { disabled }),
      ...(onSelect !== undefined && { onSelect }),
    };
    const Icon = item.icon;

    useRegisterFluidHoverItem(registerItem, index, internalRef);

    return (
      <div
        ref={(node) => {
          internalRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        id={`${listId}-${index}`}
        role="option"
        aria-selected={isActive}
        aria-disabled={item.disabled || undefined}
        data-fluid-hover-index={index}
        data-value={value}
        data-slot="command-menu-item"
        onClick={(e) => {
          onClick?.(e);
          if (!e.defaultPrevented) select(item);
        }}
        className={cn(
          // Fixed height so the text-box trim on the label doesn't shrink
          // the row; shrink-0 because the list is a flex column.
          "relative z-10 flex shrink-0 items-center cursor-pointer select-none outline-none",
          sizeClasses.control,
          sizeClasses.gap,
          sizeClasses.itemPx,
          sizeClasses.text,
          listShape.item,
          "transition-[color] duration-80",
          isActive ? "text-foreground" : "text-muted-foreground",
          item.disabled && "opacity-50 pointer-events-none",
          className
        )}
        {...props}
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive ? 2 : 1.5}
            className="shrink-0 transition-[color,stroke-width] duration-80"
          />
        )}
        {children ?? (
          // py-1/-my-1 keeps truncate's overflow:hidden from clipping
          // ascenders and descenders outside the trimmed box.
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1">
              {item.label}
            </span>
            {/* The description shares the label's size and sits one
                contrast step below it, on both states of the row. */}
            {item.description && (
              <span
                className={cn(
                  "min-w-0 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1 transition-[color] duration-80",
                  isActive ? "text-muted-foreground" : "text-muted-foreground/60"
                )}
              >
                {item.description}
              </span>
            )}
          </span>
        )}
        {item.shortcut && <CommandMenuShortcut keys={item.shortcut} />}
      </div>
    );
  }
));

CommandMenuItem.displayName = "CommandMenuItem";

// ---------------------------------------------------------------------------
// CommandMenuFooter — the hint strip under the list: what the keys do here.
// The default hints follow the menu (tabs add ← →, a dialog adds Esc).
// ---------------------------------------------------------------------------

export interface CommandMenuHint {
  label: string;
  /** A combo, or a list of separate caps. */
  keys: string | readonly string[];
}

export interface CommandMenuFooterProps extends HTMLAttributes<HTMLDivElement> {
  /** Replaces the default hints. */
  hints?: readonly CommandMenuHint[];
  /** Replaces the hints entirely with your own content. */
  children?: ReactNode;
}

const CommandMenuFooter = forwardRef<HTMLDivElement, CommandMenuFooterProps>(
  ({ hints, className, children, ...props }, ref) => {
    const { rows, highlight, tabsMounted } = useCommandMenu();
    const dialog = useContext(CommandMenuDialogContext);
    const compact = useSize().variant === "compact";
    // The Enter hint names the highlighted row, so it reads as the thing
    // Enter does ("Open Showcase") rather than a generic "Run". It rides
    // the highlight store like a row does, and sits at the trailing edge so
    // its changing width never moves the other hints. No row, no hint.
    const activeIndex = useSyncExternalStore(highlight.subscribe, highlight.get, () => null);
    const row = activeIndex === null ? undefined : rows[activeIndex];
    const action = hints ? null : row ? (row.action ?? row.label) : null;
    const resolved: readonly CommandMenuHint[] = hints ?? [
      { label: "Select", keys: ["up", "down"] },
      ...(tabsMounted ? [{ label: "Tabs", keys: ["left", "right"] }] : []),
      ...(dialog ? [{ label: "Close", keys: "esc" }] : []),
    ];
    return (
      <div
        ref={ref}
        data-slot="command-menu-footer"
        className={cn(
          "flex shrink-0 items-center overflow-hidden text-muted-foreground",
          compact ? "h-8 gap-3 px-3 text-[11px]" : "h-10 gap-4 px-4 text-[12px]",
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            {resolved.map((hint) => (
              <span key={hint.label} className="flex shrink-0 items-center gap-1.5">
                <span>{hint.label}</span>
                <CommandMenuShortcut keys={hint.keys} className="ml-0" />
              </span>
            ))}
            {action !== null && (
              <span
                data-slot="command-menu-footer-action"
                className="ml-auto flex min-w-0 items-center gap-1.5 text-foreground"
              >
                <span className="truncate">{action}</span>
                <CommandMenuShortcut keys="enter" className="ml-0" />
              </span>
            )}
          </>
        )}
      </div>
    );
  }
);

CommandMenuFooter.displayName = "CommandMenuFooter";

// ---------------------------------------------------------------------------
// CommandMenuDialog — the modal shell, opened by a global shortcut.
// ---------------------------------------------------------------------------

// Every mounted dialog listens for its own combo; one of them answers a
// press. An open dialog answers first (the press closes it). Otherwise the
// most recently mounted one with that combo whose scope holds the focus
// does: a dialog without a scope is in scope everywhere, so an app-wide
// palette keeps its key, and a scoped one (a docs demo, a pane) takes it
// only while focus is inside its element. Peers are matched on the parsed
// combo, so "mod+k", "cmd+k" and "Mod+K" are one key.
const mountedDialogs: {
  combo: string;
  isOpen: () => boolean;
  inScope: () => boolean;
}[] = [];

function comboKey(parsed: ParsedShortcut): string {
  return [
    parsed.mod && "mod",
    parsed.meta && "meta",
    parsed.ctrl && "ctrl",
    parsed.alt && "alt",
    parsed.shift && "shift",
    parsed.key,
  ]
    .filter(Boolean)
    .join("+");
}

export interface CommandMenuDialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The combo that toggles the dialog from anywhere on the page, in the
   *  shortcut syntax. `null` binds nothing. @default "mod+k" */
  shortcut?: string | null;
  /** Focus must be inside this element for the combo to open the dialog:
   *  for a demo or a pane that must not take an app-wide combo from the
   *  palette mounted at the root. Closing on the combo works from anywhere. */
  shortcutScope?: RefObject<HTMLElement | null>;
  /** Read to screen readers as the dialog's name. @default "Command menu" */
  title?: string;
  /** @default "Search for a command to run." */
  description?: string;
  /** Traps focus and locks page scroll while open. @default true */
  modal?: boolean;
  /** Portal target, for scoping the dialog to a region (see Dialog). */
  container?: HTMLElement | null;
  /** Merged onto the dialog panel. */
  className?: string;
  children: ReactNode;
}

function CommandMenuDialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  shortcut = "mod+k",
  shortcutScope,
  title = "Command menu",
  description = "Search for a command to run.",
  modal,
  container,
  className,
  children,
}: CommandMenuDialogProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = openProp ?? internalOpen;
  const openRef = useRef(open);
  openRef.current = open;
  const scopeRef = useRef(shortcutScope);
  scopeRef.current = shortcutScope;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  // Read through refs so `setOpen` keeps one identity for the dialog's
  // life: the listener below depends on it, and re-registering on every
  // toggle would move the dialog to the end of the peer list, changing
  // which dialog answers a shared combo with each click.
  const controlledRef = useRef(openProp !== undefined);
  controlledRef.current = openProp !== undefined;

  const setOpen = useCallback((next: boolean) => {
    if (!controlledRef.current) setInternalOpen(next);
    onOpenChangeRef.current?.(next);
  }, []);

  useEffect(() => {
    if (!shortcut) return;
    const parsed = parseShortcut(shortcut);
    if (parsed.key === "") return;
    const combo = comboKey(parsed);
    const entry = {
      combo,
      isOpen: () => openRef.current,
      inScope: () => {
        const scope = scopeRef.current?.current;
        return !scope || scope.contains(document.activeElement);
      },
    };
    mountedDialogs.push(entry);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.defaultPrevented) return;
      if (!matchesShortcut(e, parsed)) return;
      // A bare key stays out of fields; a modifier combo fires anywhere.
      if (!hasModifier(parsed) && isEditable(e.target)) return;
      const peers = mountedDialogs.filter((d) => d.combo === combo);
      const answers =
        peers.find((d) => d.isOpen()) ?? peers.slice().reverse().find((d) => d.inScope());
      if (answers !== entry) return;
      e.preventDefault();
      setOpen(!openRef.current);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const i = mountedDialogs.indexOf(entry);
      if (i !== -1) mountedDialogs.splice(i, 1);
    };
  }, [shortcut, setOpen]);

  const dialogCtx = useMemo(() => ({ close: () => setOpen(false) }), [setOpen]);

  return (
    <Dialog open={open} onOpenChange={setOpen} modal={modal}>
      <DialogContent
        size="lg"
        container={container}
        showCloseButton={false}
        // Opens centered at its cap and keeps that top edge: the top is where
        // a panel at the cap height, min(440px, 76dvh), sits centered, so
        // the field stays put while the rows under it filter down. Below
        // 580px of height the cap is 76dvh and the top lands on 12dvh.
        position="top"
        className={cn(
          "top-[max(12dvh,calc(50dvh-220px))] flex max-h-[min(440px,76dvh)] flex-col overflow-hidden p-0",
          className
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <CommandMenuDialogContext.Provider value={dialogCtx}>
          {children}
        </CommandMenuDialogContext.Provider>
      </DialogContent>
    </Dialog>
  );
}

CommandMenuDialog.displayName = "CommandMenuDialog";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  CommandMenu,
  CommandMenuDialog,
  CommandMenuInput,
  CommandMenuTabs,
  CommandMenuFilters,
  CommandMenuList,
  CommandMenuEmpty,
  CommandMenuItem,
  CommandMenuShortcut,
  CommandMenuFooter,
};
