"use client";

import type React from "react";
import {
  forwardRef,
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  createContext,
  useContext,
  type ReactNode,
  type HTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cva, type VariantProps } from "class-variance-authority";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { useIcon, type IconComponent } from "../../lib/icon-context";
import { cn } from "../../lib/cn";
import { spring, exitFallbackMs } from "../../lib/springs";
import { useFluidHover, useRegisterFluidHoverItem } from "../../hooks/use-fluid-hover";
import {
  useMergeSplitBlocks,
  useSelectionRuns,
  SelectionBackgrounds,
} from "../../hooks/use-merge-split";
import { useShape, shapeMap } from "../../lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "../../lib/size-context";
import { Elevated } from "../../lib/elevated";
import {
  popupMotionClass,
  popupScrollAreaClass,
  popupViewportClass,
  isDisabledRow,
} from "../../lib/popup";
import { ScrollArea } from "./scroll-area";
import { FluidHoverHighlight } from "./fluid-hover-highlight";

// ---------------------------------------------------------------------------
// Combobox
//
// A text field that filters a list as you type. Built on Base UI's Combobox
// primitive, which owns the filtering, the combobox/listbox ARIA wiring
// (aria-activedescendant — the input keeps focus while arrows move a
// highlight through the rows), positioning, dismissal, and the hidden form
// input. This layer keeps the fluid-hover overlays, the spring open/
// close animation (via actionsRef deferred unmount), and the animated
// checkmark — the same visuals as Select.
//
// Items are data: pass `items` to the root and render rows from the
// ComboboxList function child. String items are their own value and label;
// object items carry `{ value, label }` plus anything else you need.
// ---------------------------------------------------------------------------

type ComboboxItemData = string | { value: string; label: string };

function itemValue(item: ComboboxItemData): string {
  return typeof item === "string" ? item : item.value;
}

function itemLabel(item: ComboboxItemData): string {
  return typeof item === "string" ? item : item.label;
}

// The create row is one more item in the list the primitive filters and
// highlights, so Enter and the arrows reach it like any row. Its value can't
// collide with a consumer's; its label is the query it would create.
const CREATE_VALUE = "\u0000create";

function isCreateItem(item: ComboboxItemData): boolean {
  return itemValue(item) === CREATE_VALUE;
}

function defaultCreateLabel(query: string): ReactNode {
  return `Create “${query}”`;
}

type ComboboxValue<Multiple extends boolean> = Multiple extends true
  ? string[]
  : string;

interface ComboboxContextValue {
  /** Selected values — one entry in single mode, any number in multiple. */
  values: string[];
  multiple: boolean;
  inputValue: string;
  open: boolean;
  actionsRef: React.RefObject<{ unmount: () => void } | null>;
  /** The field (input group or chips container) the popup anchors to. */
  anchorRef: React.RefObject<HTMLDivElement | null>;
  disabled: boolean;
  itemsByValue: Map<string, ComboboxItemData>;
  /** The create row's label for the current query; null while no row is
   *  offered. */
  createRow: ReactNode | null;
  /** `hideSelected` has emptied the list with nothing typed: every item is
   *  a chip already. */
  allSelected: boolean;
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null);

/** Highlighted row (the primitive's active index over the rendered rows)
 *  and whether a keyboard/auto highlight put it there — pointer highlights
 *  are left to fluid hover. Its own context so a per-pointer highlight
 *  re-renders the list, not the field and every row. */
interface Highlight {
  index: number;
  keyboard: boolean;
}
const ComboboxHighlightContext = createContext<Highlight | null>(null);

function useComboboxContext() {
  const ctx = useContext(ComboboxContext);
  if (!ctx)
    throw new Error("Combobox compound components must be inside <Combobox>");
  return ctx;
}

// Content context for fluid hover
interface ComboboxContentContextValue {
  registerItem: (index: number, element: HTMLElement | null) => void;
  activeIndex: number | null;
}

const ComboboxContentContext =
  createContext<ComboboxContentContextValue | null>(null);

// Each rendered row learns its index from the list, so consumers never
// number rows by hand.
const ComboboxItemIndexContext = createContext<number>(0);

// ---------------------------------------------------------------------------
// Combobox (root)
// ---------------------------------------------------------------------------

interface ComboboxProps<
  T extends ComboboxItemData = ComboboxItemData,
  Multiple extends boolean = false,
> {
  children: ReactNode;
  /** The options. Strings, or `{ value, label, … }` objects. */
  items: readonly T[];
  /** Select any number of items; pair with ComboboxChips for the field.
   *  Values become `string[]`. @default false */
  multiple?: Multiple;
  /** Selected value(s): a string ("" = none), or an array when `multiple`. */
  value?: ComboboxValue<Multiple>;
  defaultValue?: ComboboxValue<Multiple>;
  onValueChange?: (value: ComboboxValue<Multiple>) => void;
  /** Match an item against the typed query. Defaults to a case-insensitive
   *  "contains" on the label. */
  filter?: (item: T, query: string) => boolean;
  /** Offer a last row that creates what was typed, whenever the query
   *  matches no item's label exactly. Called with the trimmed query. Add the
   *  new item to `items` and return it to select it. */
  onCreate?: (query: string) => T | void;
  /** The create row's label. @default (query) => `Create “${query}”` */
  createLabel?: (query: string) => ReactNode;
  /** Multiple only: selected items leave the list, so it reads as what is
   *  left to add. The chips are then the only way to deselect.
   *  @default false */
  hideSelected?: boolean;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  /** Pins field and popup to one step of the size ladder (default 36px,
   *  compact 28px — see /docs/sizes). Omitted, both follow the surrounding
   *  SizeProvider. */
  size?: SizeVariant;
}

function toValues(v: string | readonly string[] | undefined): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v as string[];
  return v === "" ? [] : [v as string];
}

function Combobox<
  T extends ComboboxItemData = ComboboxItemData,
  Multiple extends boolean = false,
>({
  children,
  items,
  multiple,
  value,
  defaultValue,
  onValueChange,
  filter,
  onCreate,
  createLabel = defaultCreateLabel,
  hideSelected = false,
  disabled = false,
  name,
  required,
  size,
}: ComboboxProps<T, Multiple>) {
  const isMultiple = !!multiple;
  const [internalValues, setInternalValues] = useState<string[]>(() =>
    toValues(defaultValue)
  );
  const [inputValue, setInputValue] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const actionsRef = useRef<{ unmount: () => void } | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  // Memoized on the prop identity: a string value is stable by nature and a
  // consumer's array is state, so the derived array (and everything keyed on
  // it) only changes when the selection does.
  const controlledValues = useMemo(() => toValues(value), [value]);
  const values = value !== undefined ? controlledValues : internalValues;

  // The query the primitive filters on: the trimmed input. In single mode
  // the field shows the selected label on open, which is an exact match, so
  // no create row appears until the user types past it.
  const query = inputValue.trim();
  const createItem = useMemo<ComboboxItemData | null>(() => {
    if (!onCreate || query === "") return null;
    const lower = query.toLocaleLowerCase();
    const exists = items.some((item) => itemLabel(item).toLocaleLowerCase() === lower);
    return exists ? null : { value: CREATE_VALUE, label: query };
  }, [onCreate, query, items]);

  const itemsByValue = useMemo(() => {
    const map = new Map<string, ComboboxItemData>();
    for (const item of items) map.set(itemValue(item), item);
    // Rows hand the primitive the item they were rendered from; the create
    // row's carries the query it stands for.
    if (createItem) map.set(CREATE_VALUE, createItem);
    return map;
  }, [items, createItem]);
  const selectedItems = useMemo(
    () => values.map((v) => itemsByValue.get(v)).filter(Boolean) as T[],
    [values, itemsByValue]
  );

  // What the list shows: the items less the chips when `hideSelected`, plus
  // the create row last, so Enter picks a real match while one exists and
  // only creates once nothing matches.
  const hideChecked = hideSelected && isMultiple;
  const listItems = useMemo<readonly ComboboxItemData[]>(() => {
    const visible = hideChecked ? items.filter((item) => !values.includes(itemValue(item))) : items;
    return createItem ? [...visible, createItem] : visible;
  }, [items, hideChecked, values, createItem]);
  const allSelected = hideChecked && query === "" && items.length > 0 && listItems.length === 0;

  // Base UI hands back the item(s); the public API speaks in values. A pick
  // on the create row is not a selection: it asks the consumer for the item,
  // and selects whatever comes back.
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const handleValueChange = useCallback(
    (next: T[] | T | null) => {
      const picked = Array.isArray(next) ? next : next == null ? [] : [next];
      const created = picked.find(isCreateItem);
      let nextValues = picked.filter((item) => !isCreateItem(item)).map(itemValue);
      if (created) {
        const made = onCreateRef.current?.(itemLabel(created));
        if (made == null) {
          // Nothing to select: a single field keeps its pick.
          if (!isMultiple) return;
        } else {
          nextValues = [...nextValues, itemValue(made)];
        }
      }
      if (value === undefined) setInternalValues(nextValues);
      onValueChange?.(
        (isMultiple ? nextValues : (nextValues[0] ?? "")) as ComboboxValue<Multiple>
      );
    },
    [value, onValueChange, isMultiple]
  );

  // The create row must survive the filter that hides every other miss.
  // Without a consumer filter the primitive's own collator match is kept.
  const { contains } = ComboboxPrimitive.useFilter();
  const filterFn = useMemo(() => {
    if (!filter && !createItem) return undefined;
    const match = filter
      ? (item: ComboboxItemData, q: string) => filter(item as T, q)
      : (item: ComboboxItemData, q: string) => contains(item, q, itemLabel);
    return (item: ComboboxItemData, q: string) => isCreateItem(item) || match(item, q);
  }, [filter, createItem, contains]);

  const createRow = createItem ? createLabel(query) : null;
  const ctx = useMemo(
    () => ({
      values,
      multiple: isMultiple,
      inputValue,
      open,
      actionsRef,
      anchorRef,
      disabled,
      itemsByValue,
      createRow,
      allSelected,
    }),
    [values, isMultiple, inputValue, open, disabled, itemsByValue, createRow, allSelected]
  );

  // A size prop pins the whole compound (field + portalled popup — React
  // context crosses portals) to one step of the ladder.
  const root = (
    <ComboboxContext.Provider value={ctx}>
    <ComboboxHighlightContext.Provider value={highlight}>
      <ComboboxPrimitive.Root
        items={listItems}
        multiple={isMultiple}
        // Always controlled; "" (no selection) maps to Base UI's null. The
        // value shape follows `multiple`, which the primitive's generics
        // can't express from a boolean prop — hence the cast.
        value={(isMultiple ? selectedItems : (selectedItems[0] ?? null)) as never}
        onValueChange={handleValueChange as never}
        isItemEqualToValue={(a: T, b: T) => itemValue(a) === itemValue(b)}
        itemToStringLabel={itemLabel}
        itemToStringValue={itemValue}
        filter={filterFn}
        open={open}
        onOpenChange={(next) => setOpen(next)}
        onInputValueChange={(next) => setInputValue(next)}
        actionsRef={actionsRef}
        autoHighlight={ALWAYS_HIGHLIGHT}
        onItemHighlighted={(item, details) =>
          setHighlight(
            item === undefined
              ? null
              : { index: details.index, keyboard: details.reason !== "pointer" }
          )
        }
        disabled={disabled}
        name={name}
        required={required}
        // Non-modal: the page keeps scrolling and the Positioner tracks the
        // anchor, so the popup follows its field instead of detaching.
        modal={false}
      >
        {children}
      </ComboboxPrimitive.Root>
    </ComboboxHighlightContext.Provider>
    </ComboboxContext.Provider>
  );

  return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
}

Combobox.displayName = "Combobox";

// ---------------------------------------------------------------------------
// ComboboxInput — the field: leading icon, text input, clear ✕, chevron.
// ---------------------------------------------------------------------------

// The field follows the global pill/rounded shape; the popup does not. Like
// Dropdown, the list keeps the smaller "rounded" radii whatever the rest of
// the UI is shaped: pill corners on a popover distort its padding and break
// the concentric fit of the rows' hover and selection backgrounds inside it.
const popupShape = shapeMap.rounded;

// The first row is highlighted the moment the list opens and follows the
// query as it filters, so Enter always has a target. AriaCombobox accepts
// "always" for this; ComboboxRoot's prop type still says boolean.
const ALWAYS_HIGHLIGHT = "always" as unknown as boolean;

const fieldVariants = cva(
  [
    "group flex items-center ring-1 cursor-text",
    "transition-all duration-80",
    "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        // Framed at rest; the fills step up on hover and focus like an
        // input field.
        bordered:
          "ring-border bg-transparent hover:bg-muted/50 focus-within:bg-card",
        // Invisible at rest — the InputGroup field ladder: muted fill +
        // ring on hover, card fill when focused.
        borderless:
          "ring-transparent bg-transparent hover:bg-muted/50 hover:ring-border focus-within:bg-card focus-within:ring-border",
      },
    },
    defaultVariants: {
      variant: "bordered",
    },
  }
);

// The clear and chevron buttons share one quiet style; they sit inside the
// field's ring so they need no frame of their own.
const fieldButtonClass =
  "flex shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors duration-80 hover:text-foreground focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] data-[disabled]:pointer-events-none";
// The clear ✕ is a real icon button: the hover fill says "press me", where
// the chevron beside it only decorates the field it belongs to.
const clearButtonClass = cn(
  fieldButtonClass,
  "hover:bg-hover active:bg-active transition-[color,background-color]"
);
// A chip's ✕ sits on the chip's own hover-tinted fill, so it steps up a notch.
const chipRemoveClass = cn(fieldButtonClass, "rounded hover:bg-active");

interface ComboboxFieldProps
  extends Omit<
      InputHTMLAttributes<HTMLInputElement>,
      "size" | "value" | "defaultValue" | "onChange"
    >,
    VariantProps<typeof fieldVariants> {
  icon?: IconComponent;
  placeholder?: string;
  error?: string;
  /** Render a ✕ that clears the selection and query. Its slot is always
   *  reserved so the field never changes width. @default false */
  clearable?: boolean;
  /** Size override for the field alone. Prefer the `size` prop on <Combobox>
   *  (or a surrounding SizeProvider) so the popup matches. */
  size?: SizeVariant;
}

type ComboboxInputProps = ComboboxFieldProps;

/** The trailing clear ✕ and chevron, shared by both fields. */
function FieldControls({
  clearable,
  compact,
  iconSize,
}: {
  clearable: boolean;
  compact: boolean;
  iconSize: number;
}) {
  const XIcon = useIcon("x");
  const pill = useShape().variant === "pill";
  return (
    <>
      {clearable && (
        // The primitive hides the button while there is nothing to clear; a
        // fixed slot keeps the field's width steady either way.
        <span className={cn("flex shrink-0 items-center justify-center", compact ? "size-5" : "size-6")}>
          <ComboboxPrimitive.Clear
            aria-label="Clear"
            className={cn(clearButtonClass, pill && "rounded-full", compact ? "size-5" : "size-6")}
          >
            <XIcon size={iconSize} strokeWidth={1.5} />
          </ComboboxPrimitive.Clear>
        </span>
      )}
      {/* Not a tab stop: the field itself opens on ArrowDown or typing. */}
      <ComboboxPrimitive.Trigger
        aria-label="Open"
        tabIndex={-1}
        className={cn(fieldButtonClass, compact ? "size-5" : "size-6")}
      >
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-colors duration-80"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </ComboboxPrimitive.Trigger>
    </>
  );
}

const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(
  (
    {
      className,
      variant,
      icon: Icon,
      placeholder = "Search…",
      error,
      clearable = false,
      size,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    const sizeClasses = useSize(size);
    const compact = sizeClasses.variant === "compact";
    const { anchorRef } = useComboboxContext();

    return (
      <div className="flex flex-col gap-1">
        {/* The group is the popup's anchor, so the list spans the whole
            field (icon to chevron), not just the text input. */}
        <ComboboxPrimitive.InputGroup
          ref={anchorRef}
          className={cn(
            fieldVariants({ variant }),
            sizeClasses.control,
            sizeClasses.gap,
            compact ? "px-2" : "px-2.5",
            compact ? "min-w-[128px]" : "min-w-[160px]",
            shape.input,
            error && "ring-destructive/50 hover:ring-destructive/50 focus-within:ring-destructive/50",
            className
          )}
        >
          {Icon && (
            <Icon
              size={sizeClasses.icon}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-focus-within:text-foreground group-focus-within:stroke-[2]"
            />
          )}
          <ComboboxPrimitive.Input
            ref={ref}
            placeholder={placeholder}
            aria-invalid={!!error || undefined}
            className={cn(
              "min-w-0 flex-1 rounded-none bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-[inherit]",
              sizeClasses.text,
              // The caret is as tall as the line box (Chrome, Safari); the
              // ladder's leading keeps it in proportion to the field.
              compact ? "leading-5" : "leading-6"
            )}
            {...props}
          />
          <FieldControls clearable={clearable} compact={compact} iconSize={sizeClasses.icon} />
        </ComboboxPrimitive.InputGroup>
        {error && (
          <span className="text-[12px] text-destructive pl-3">{error}</span>
        )}
      </div>
    );
  }
);

ComboboxInput.displayName = "ComboboxInput";

// ---------------------------------------------------------------------------
// ComboboxChips — the multiple-selection field: one chip per selected item
// ahead of the text input, wrapping onto new lines as they accumulate.
// Backspace in an empty input removes the last chip; ArrowLeft walks into
// the chips, where Backspace/Delete removes the focused one.
// ---------------------------------------------------------------------------

type ComboboxChipsProps = ComboboxFieldProps;

const ComboboxChips = forwardRef<HTMLInputElement, ComboboxChipsProps>(
  (
    {
      className,
      variant,
      icon: Icon,
      placeholder = "Search…",
      error,
      clearable = false,
      size,
      ...props
    },
    ref
  ) => {
    const XIcon = useIcon("x");
    const shape = useShape();
    const sizeClasses = useSize(size);
    const compact = sizeClasses.variant === "compact";
    const { anchorRef, open, disabled, inputValue } = useComboboxContext();

    return (
      <div className="flex flex-col gap-1">
        <ComboboxPrimitive.Chips
          ref={anchorRef}
          // Chips stamps no state attributes of its own (InputGroup does);
          // the field ladder and the chevron read these.
          data-disabled={disabled || undefined}
          data-popup-open={open || undefined}
          className={cn(
            fieldVariants({ variant }),
            // Grows with its chips. Rows top-align (`items-start`) so the
            // icon and controls hold the first line while chips wrap; the
            // vertical padding is exactly what centers one 24px (20px
            // compact) row inside the ladder height.
            "!items-start",
            compact ? "min-h-7 py-1" : "min-h-9 py-1.5",
            sizeClasses.gap,
            compact ? "px-2" : "px-2.5",
            compact ? "min-w-[128px]" : "min-w-[160px]",
            shape.input,
            error && "ring-destructive/50 hover:ring-destructive/50 focus-within:ring-destructive/50",
            className
          )}
        >
          {Icon && (
            // A row-height box keeps the icon centered on the first line.
            <span className={cn("flex shrink-0 items-center", compact ? "h-5" : "h-6")}>
              <Icon
                size={sizeClasses.icon}
                strokeWidth={1.5}
                className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-focus-within:text-foreground group-focus-within:stroke-[2]"
              />
            </span>
          )}
          <div className="relative flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <ComboboxPrimitive.Value>
              {(selected: ComboboxItemData[] | null) => (
                <>
                  {/* Chips pop in and out on the fast tier and slide into
                      their new slots; an exiting chip is inert while it
                      fades, since the primitive has already dropped it.
                      popLayout lifts the exiting chip out of the flow at
                      once, so the field reflows immediately rather than
                      after the fade. */}
                  <AnimatePresence initial={false} mode="popLayout">
                    {(selected ?? []).map((item) => {
                      const label = itemLabel(item);
                      return (
                        <motion.span
                          key={itemValue(item)}
                          layout
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9, pointerEvents: "none", transition: spring.fast.exit }}
                          transition={spring.fast}
                          className="inline-flex max-w-full shrink-0"
                        >
                          <ComboboxPrimitive.Chip
                            aria-label={label}
                            className={cn(
                              "inline-flex max-w-full shrink-0 items-center gap-0.5 bg-hover pl-2 pr-0.5 text-foreground outline-none",
                              shape.variant === "pill" ? "rounded-full" : "rounded-md",
                              "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
                              compact ? "h-5 text-[11px]" : "h-6 text-[12px]"
                            )}
                          >
                            <span className="truncate">{label}</span>
                            <ComboboxPrimitive.ChipRemove
                              aria-label={`Remove ${label}`}
                              className={cn(chipRemoveClass, shape.variant === "pill" && "rounded-full", compact ? "size-4" : "size-5")}
                            >
                              <XIcon size={compact ? 10 : 12} strokeWidth={2} />
                            </ComboboxPrimitive.ChipRemove>
                          </ComboboxPrimitive.Chip>
                        </motion.span>
                      );
                    })}
                  </AnimatePresence>
                  {/* The field sizes to what is typed (`size` is the
                      intrinsic width; flex-auto grows it across the rest
                      of its row) so it stays beside the chips while it
                      fits and wraps only once the text no longer does.
                      It never animates: chips slide, the field snaps.
                      Animating it read as the placeholder sliding in from
                      the right when the last chip went. */}
                  <span className="flex min-w-6 flex-auto">
                    <ComboboxPrimitive.Input
                      ref={ref}
                      size={Math.max(1, inputValue.length + 1)}
                      placeholder={selected?.length ? undefined : placeholder}
                      aria-invalid={!!error || undefined}
                      className={cn(
                        "w-full min-w-0 rounded-none bg-transparent text-foreground placeholder:text-muted-foreground outline-none font-[inherit]",
                        // Line box = row height, so the caret spans the chip row.
                        compact ? "h-5 leading-5" : "h-6 leading-6",
                        sizeClasses.text
                      )}
                      {...props}
                    />
                  </span>
                </>
              )}
            </ComboboxPrimitive.Value>
          </div>
          <FieldControls clearable={clearable} compact={compact} iconSize={sizeClasses.icon} />
        </ComboboxPrimitive.Chips>
        {error && (
          <span className="text-[12px] text-destructive pl-3">{error}</span>
        )}
      </div>
    );
  }
);

ComboboxChips.displayName = "ComboboxChips";

// ---------------------------------------------------------------------------
// ComboboxContent — the popup surface. Holds ComboboxEmpty and ComboboxList.
// ---------------------------------------------------------------------------

type PositionerProps = React.ComponentProps<typeof ComboboxPrimitive.Positioner>;

interface ComboboxContentProps {
  className?: string;
  children: ReactNode;
  side?: PositionerProps["side"];
  align?: PositionerProps["align"];
  sideOffset?: number;
}

const ComboboxContent = forwardRef<HTMLDivElement, ComboboxContentProps>(
  ({ className, children, side = "bottom", align = "start", sideOffset = 6 }, ref) => {
    const { open, actionsRef, anchorRef } = useComboboxContext();
    const shape = popupShape;

    // Release Base UI's deferred unmount once the exit tween has played.
    // onAnimationComplete on the motion.div is the primary signal; this
    // timeout is a fallback for throttled/background tabs where rAF-driven
    // animation callbacks can stall. The popup exits with spring.fast, so the
    // fallback tracks that tier's exit duration plus a safety buffer.
    useEffect(() => {
      if (open) return;
      const id = setTimeout(
        () => actionsRef.current?.unmount(),
        exitFallbackMs(spring.fast)
      );
      return () => clearTimeout(id);
    }, [open, actionsRef]);

    return (
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          // The whole field (input group or chips container) is the anchor,
          // so the list spans it edge to edge.
          anchor={anchorRef}
          side={side}
          align={align}
          sideOffset={sideOffset}
          className="z-[100] pointer-events-auto outline-none"
          data-slot="combobox-popup"
        >
          <motion.div
            className={popupMotionClass}
            initial={{ opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }}
            animate={
              open
                ? { opacity: 1, y: 0, scaleY: 1 }
                : { opacity: 0, y: "var(--popup-enter-y)", scaleY: 0.96 }
            }
            transition={open ? spring.fast : spring.fast.exit}
            // Base UI defers unmount while actionsRef is set; release it once
            // the exit spring has finished so the close animation fully plays.
            onAnimationComplete={() => {
              if (!open) actionsRef.current?.unmount();
            }}
          >
            <ComboboxPrimitive.Popup
              render={<Elevated offset={2} shadowLevel={3} ref={ref} />}
              className={cn(
                // min-w tracks the field via the Positioner's --anchor-width
                // var; the list inside owns padding and scrolling.
                `pointer-events-auto flex flex-col min-w-[var(--anchor-width)] max-h-[min(300px,var(--available-height))] overflow-hidden ${shape.container} select-none outline-none`,
                className
              )}
            >
              {children}
            </ComboboxPrimitive.Popup>
          </motion.div>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    );
  }
);

ComboboxContent.displayName = "ComboboxContent";

// ---------------------------------------------------------------------------
// ComboboxList — renders a row per matching item, carrying the fluid hover
// hover overlays and the animated selected background / focus ring.
// ---------------------------------------------------------------------------

interface ComboboxListProps {
  className?: string;
  /** Render one row per matching item: `(item, index) => <ComboboxItem …/>`. */
  children: (item: ComboboxItemData, index: number) => ReactNode;
}

const ComboboxList = forwardRef<HTMLDivElement, ComboboxListProps>(
  ({ className, children }, ref) => {
    const { open, values, multiple, inputValue, createRow } = useComboboxContext();
    const highlight = useContext(ComboboxHighlightContext);
    const PlusIcon = useIcon("plus");
    const shape = popupShape;
    const containerRef = useRef<HTMLDivElement>(null);

    const hover = useFluidHover(containerRef, { isItemDisabled: isDisabledRow });
    const {
      activeIndex,
      setActiveIndex,
      itemRects,
      isMeasured,
      handlers,
      registerItem,
      remeasure,
    } = hover;

    // Checked rows by index — one in single mode, any number in multiple.
    const [checkedIndices, setCheckedIndices] = useState<number[]>([]);

    // Fresh rects once per open — the popup keeps its rows registered while
    // it sits hidden between opens, so registration alone never triggers a
    // pass on reopen. Filtering re-registers rows, which the hook coalesces
    // into its own measurement.
    useEffect(() => {
      if (!open) return;
      remeasure();
    }, [open, remeasure]);

    // Detect the checked rows. Their indices shift as the query filters the
    // list, so the typed value is a dependency too.
    useEffect(() => {
      if (!open) return;
      // Double rAF: first waits for React commit, second for layout
      let inner: number;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => {
          const container = containerRef.current;
          if (container) {
            const rows = Array.from(
              container.querySelectorAll("[data-fluid-hover-index]")
            ) as HTMLElement[];
            const next: number[] = [];
            rows.forEach((el, i) => {
              if (values.includes(el.getAttribute("data-value") ?? "")) next.push(i);
            });
            setCheckedIndices(next);
          }
        });
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }, [open, values, inputValue]);

    // A keyboard (or auto) highlight drives the hover background — the only
    // indicator: the row Enter would pick reads like the row the pointer
    // would pick, with no ring.
    useEffect(() => {
      // A dropped highlight (the input is the stop again) takes the hover
      // background with it — otherwise it would linger on the last row.
      if (!highlight) setActiveIndex(null);
      else if (highlight.keyboard) setActiveIndex(highlight.index);
    }, [highlight, setActiveIndex]);

    // Reset every overlay index as the close begins, so the reopen doesn't
    // spring an overlay from a stale row.
    useEffect(() => {
      if (open) return;
      setCheckedIndices([]);
      setActiveIndex(null);
    }, [open, setActiveIndex]);

    // Overlays read rects only once the hook reports the row set fully
    // measured — positioning one from an incomplete pass mounts it at the
    // wrong row, and the correcting pass then springs it across the list.
    // Single mode glides ONE marker between rows (a value change springs it
    // to the picked row). Multiple mode paints one block per contiguous run
    // of checked rows — merging and splitting like CheckboxGroup as picks
    // bridge or break a run.
    const checkedRect =
      isMeasured && !multiple && checkedIndices.length > 0
        ? itemRects[checkedIndices[0]]
        : null;
    const runs = useSelectionRuns(multiple ? checkedIndices : []);
    const blocks = useMergeSplitBlocks(
      runs,
      isMeasured && open ? itemRects : [],
      shape.bgRadius
    );

    const contentCtx = useMemo(
      () => ({ registerItem, activeIndex }),
      [registerItem, activeIndex]
    );

    return (
      <ComboboxContentContext.Provider value={contentCtx}>
        <ScrollArea className={popupScrollAreaClass} viewportClassName={cn(popupViewportClass, "scroll-fade")}>
        <ComboboxPrimitive.List
          ref={(node: HTMLDivElement | null) => {
            (containerRef as React.MutableRefObject<HTMLDivElement | null>).current =
              node;
            if (typeof ref === "function") ref(node);
            else if (ref)
              (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }}
          onMouseEnter={handlers.onMouseEnter}
          onMouseMove={handlers.onMouseMove}
          onMouseLeave={handlers.onMouseLeave}
          onClick={handlers.onClick}
          className={cn(
            // The list is the overlays' offsetParent, so rows and overlays
            // scroll together inside the ScrollArea. Padding collapses when
            // the list is empty (ComboboxEmpty takes over).
            "relative flex flex-col gap-0.5 p-1 outline-none data-[empty]:p-0",
            className
          )}
        >
          {/* The three overlays are torn down as the close begins rather
              than exit-animated: an overlay still mounted when the popup
              reopens is one AnimatePresence re-adopts under its old key and
              animates from the row it had before. */}
          {/* Selected background */}
          {open && multiple && <SelectionBackgrounds blocks={blocks} />}
          {open && !multiple && (
            <AnimatePresence>
              {checkedRect && (
                <motion.div
                  key="checked"
                  aria-hidden
                  className={`absolute ${shape.bg} bg-active pointer-events-none`}
                  initial={false}
                  animate={{
                    top: checkedRect.top,
                    left: checkedRect.left,
                    width: checkedRect.width,
                    height: checkedRect.height,
                    opacity: 1,
                  }}
                  exit={{ opacity: 0, transition: spring.moderate.exit }}
                  transition={{
                    ...spring.moderate,
                    opacity: { duration: 0.08 },
                  }}
                />
              )}
            </AnimatePresence>
          )}

          {/* Hover background */}
          {open && (
            <FluidHoverHighlight
              hover={hover}
              className={shape.bg}
            />
          )}

          {/* The overlays above are plain children, so the rows come from
              an explicit Collection (a function child on List would have
              to be its only child). */}
          <ComboboxPrimitive.Collection>
            {(item: ComboboxItemData, index: number) => (
              <ComboboxItemIndexContext.Provider key={itemValue(item)} value={index}>
                {/* The create row is the list's, not the consumer's: it
                    reads the label from the root and picks like any row. */}
                {isCreateItem(item) ? (
                  <ComboboxItem value={CREATE_VALUE} icon={PlusIcon}>
                    {createRow}
                  </ComboboxItem>
                ) : (
                  children(item, index)
                )}
              </ComboboxItemIndexContext.Provider>
            )}
          </ComboboxPrimitive.Collection>
        </ComboboxPrimitive.List>
        </ScrollArea>
      </ComboboxContentContext.Provider>
    );
  }
);

ComboboxList.displayName = "ComboboxList";

// ---------------------------------------------------------------------------
// ComboboxItem
// ---------------------------------------------------------------------------

interface ComboboxItemProps extends HTMLAttributes<HTMLDivElement> {
  icon?: IconComponent;
  /** The item's value — a string item itself, or an object item's `value`. */
  value: string;
  disabled?: boolean;
}

const ComboboxItem = forwardRef<HTMLDivElement, ComboboxItemProps>(
  ({ className, children, icon: Icon, value, disabled = false, ...props }, ref) => {
    const comboboxCtx = useComboboxContext();
    const contentCtx = useContext(ComboboxContentContext);
    const index = useContext(ComboboxItemIndexContext);
    const internalRef = useRef<HTMLDivElement>(null);
    const shape = popupShape;
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    const hasMounted = useRef(false);

    useEffect(() => {
      hasMounted.current = true;
    }, []);

    // Register with fluid hover. Depends on the (stable) registerItem
    // rather than the content context, which is rebuilt on every activeIndex
    // change.
    const registerItem = contentCtx?.registerItem;
    useRegisterFluidHoverItem(registerItem, index, internalRef);

    const isActive = contentCtx?.activeIndex === index;
    const isChecked = comboboxCtx.values.includes(value);
    const skipAnimation = !hasMounted.current;
    // Base UI matches rows to `items` by value, so the row hands back the
    // item it was rendered from.
    const item = comboboxCtx.itemsByValue.get(value) ?? value;

    return (
      <ComboboxPrimitive.Item
        value={item}
        index={index}
        disabled={disabled}
        render={
          <div
            ref={(node: HTMLDivElement | null) => {
              (internalRef as React.MutableRefObject<HTMLDivElement | null>).current =
                node;
              if (typeof ref === "function") ref(node);
              else if (ref)
                (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
            }}
            data-fluid-hover-index={index}
            data-value={value}
            className={cn(
              // Fixed height so the text-box trim on the label doesn't
              // shrink the row; shrink-0 because the list is a max-height
              // flex column.
              `relative z-10 flex ${sizeClasses.control} shrink-0 items-center ${sizeClasses.gap} ${shape.item} ${sizeClasses.itemPx} ${sizeClasses.text} cursor-pointer outline-none select-none`,
              "transition-[color] duration-80",
              isActive || isChecked ? "text-foreground" : "text-muted-foreground",
              disabled && "opacity-50 pointer-events-none",
              className
            )}
            {...props}
          />
        }
      >
        {Icon && (
          <Icon
            size={sizeClasses.icon}
            strokeWidth={isActive || isChecked ? 2 : 1.5}
            className="shrink-0 transition-[color,stroke-width] duration-80"
          />
        )}

        {/* py-1/-my-1 keeps truncate's overflow:hidden from clipping
            ascenders/descenders outside the trimmed box. */}
        <span className="flex-1 min-w-0 truncate [text-box:trim-both_cap_alphabetic] py-1 -my-1">
          {children}
        </span>

        {/* Always-rendered fixed slot so the check appearing/disappearing
            never changes the row's intrinsic width. */}
        <span
          aria-hidden
          className={cn("shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")}
        >
          <AnimatePresence>
            {isChecked && (
              <motion.svg
                key="check"
                width={sizeClasses.icon}
                height={sizeClasses.icon}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-foreground"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 1 }}
              >
                <motion.path
                  d="M4 12L9 17L20 6"
                  initial={{ pathLength: skipAnimation ? 1 : 0 }}
                  animate={{
                    pathLength: 1,
                    transition: { duration: 0.08, ease: "easeOut" },
                  }}
                  exit={{
                    pathLength: 0,
                    transition: { duration: 0.04, ease: "easeIn" },
                  }}
                />
              </motion.svg>
            )}
          </AnimatePresence>
        </span>
      </ComboboxPrimitive.Item>
    );
  }
);

ComboboxItem.displayName = "ComboboxItem";

// ---------------------------------------------------------------------------
// ComboboxEmpty — shown in place of the list when nothing matches.
// ---------------------------------------------------------------------------

interface ComboboxEmptyProps extends HTMLAttributes<HTMLDivElement> {
  /** Shown instead of the children when `hideSelected` has emptied the
   *  list with nothing typed: every item is a chip already. */
  allSelected?: ReactNode;
}

const ComboboxEmpty = forwardRef<HTMLDivElement, ComboboxEmptyProps>(
  ({ className, children, allSelected, ...props }, ref) => {
    const sizeClasses = useSize();
    const ctx = useComboboxContext();
    return (
      // Base UI keeps this element mounted (it is a live region) and only
      // renders the children while the list is empty — so the padding is
      // gated on having content.
      <ComboboxPrimitive.Empty
        ref={ref}
        className={cn(
          "px-3 text-center text-muted-foreground [&:not(:empty)]:py-6",
          sizeClasses.text,
          className
        )}
        {...props}
      >
        {ctx.allSelected && allSelected !== undefined ? allSelected : children}
      </ComboboxPrimitive.Empty>
    );
  }
);

ComboboxEmpty.displayName = "ComboboxEmpty";

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export {
  Combobox,
  ComboboxInput,
  ComboboxChips,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
  fieldVariants as comboboxFieldVariants,
};

export type {
  ComboboxItemData,
  ComboboxValue,
  ComboboxProps,
  ComboboxInputProps,
  ComboboxChipsProps,
  ComboboxContentProps,
  ComboboxListProps,
  ComboboxItemProps,
  ComboboxEmptyProps,
};
