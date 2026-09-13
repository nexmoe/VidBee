"use client";

import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useContext,
  createContext,
  forwardRef,
  type ReactNode,
  type HTMLAttributes,
} from "react";
import { motion } from "framer-motion";
import { Collapsible } from "@base-ui/react/collapsible";

// SSR-safe layout effect (client components still server-render in Next).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { cn } from "../../lib/cn";
import { useIcon, type IconName } from "../../lib/icon-context";
import { spring } from "../../lib/springs";
import { fontWeights } from "../../lib/font-weight";
import { useShape } from "../../lib/shape-context";
import { SizeProvider, useSize, type SizeVariant } from "../../lib/size-context";
import { RemoteImage } from "./remote-image";
type BadgeColor = "gray" | "blue" | "green" | "yellow" | "red" | "purple";

function SourceBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground",
        className
      )}
    >
      {children}
    </span>
  );
}

// ─── Shared collapsible parts ───────────────────────────────────────────────
//
// ThinkingSteps and ThinkingStepDetails are both single collapsible sections,
// built directly on Base UI's Collapsible (Root/Trigger/Panel) with the
// library's framer-motion springs layered on top.

/** Open state of the nearest ThinkingSteps root, for the header trigger/panel. */
const ThinkingStepsOpenContext = createContext(false);

/** Width of the icon rail. Header and step icons share it so every glyph — and
 *  the connector line — sits on the same vertical centre. */
const RAIL = "w-4";
/** Gap between the icon rail and the text column, shared by header and steps. */
const RAIL_GAP = "gap-2";

/** Glyph size on the rail, one step down from the control icon size. */
const railIconSize = (compact: boolean): number => (compact ? 12 : 14);

/**
 * Pair type size with line-height on one utility. A separate `leading-*`
 * class loses to `text-[13px]` inside `cn()`.
 */
const railType = (compact: boolean): string =>
  compact ? "text-[12px]/normal" : "text-[13px]/normal";

/**
 * Size a rail glyph to one line of adjacent text and center it in that box.
 */
function RailGlyph({ children }: { children: ReactNode }) {
  return (
    <span className={`${RAIL} flex h-lh shrink-0 items-center justify-center`}>
      {children}
    </span>
  );
}

interface TriggerRowProps extends HTMLAttributes<HTMLButtonElement> {
  open: boolean;
  /** Leading glyph on the icon rail. Omit to start at the text column. */
  icon?: IconName;
  children: ReactNode;
}

/**
 * Trigger row: a plain-text button (no background, no padding) with an
 * optional rail icon, a dual-layer variable-weight label, and a chevron that
 * rotates from right (closed) to down (open).
 */
const TriggerRow = forwardRef<HTMLButtonElement, TriggerRowProps>(
  ({ open, icon, children, className, ...props }, ref) => {
    const ChevronRight = useIcon("chevron-right");
    const LeadingIcon = useIcon(icon ?? "dot");
    const sizeClasses = useSize();
    const compact = sizeClasses.variant === "compact";
    const [isHovered, setIsHovered] = useState(false);
    const highlighted = open || isHovered;

    return (
      <Collapsible.Trigger
        ref={ref}
        {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={cn(
          `flex w-fit items-center ${RAIL_GAP} bg-transparent p-0 text-left`,
          railType(compact),
          "cursor-pointer outline-none select-none",
          "focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)] focus-visible:ring-offset-0",
          className
        )}
      >
        {icon ? (
          <RailGlyph>
            <LeadingIcon
              size={railIconSize(compact)}
              strokeWidth={highlighted ? 2 : 1.5}
              className={cn(
                "block transition-[color,stroke-width] duration-80",
                highlighted ? "text-foreground" : "text-muted-foreground"
              )}
            />
          </RailGlyph>
        ) : null}

        {/* Label with dual-layer text (invisible bold layer reserves width) */}
        <span className="inline-grid text-left">
          <span
            className="col-start-1 row-start-1 invisible"
            style={{ fontVariationSettings: fontWeights.semibold }}
            aria-hidden="true"
          >
            {children}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80",
              highlighted ? "text-foreground" : "text-muted-foreground"
            )}
            style={{
              fontVariationSettings: open
                ? fontWeights.semibold
                : fontWeights.normal,
            }}
          >
            {children}
          </span>
        </span>

        {/* Chevron — right when collapsed, rotates 90° down when expanded */}
        <motion.span
          className="flex h-lh shrink-0 items-center justify-center"
          animate={{ rotate: open ? 90 : 0 }}
          transition={spring.fast}
        >
          <ChevronRight
            size={sizeClasses.icon}
            strokeWidth={highlighted ? 2 : 1.5}
            className={cn(
              "block transition-[color,stroke-width] duration-80",
              highlighted ? "text-foreground" : "text-muted-foreground"
            )}
          />
        </motion.span>
      </Collapsible.Trigger>
    );
  }
);
TriggerRow.displayName = "ThinkingStepsTriggerRow";

interface CollapsePanelProps {
  open: boolean;
  /** Padding of the panel body, so each caller keeps its own text alignment. */
  className?: string;
  children: ReactNode;
}

/**
 * Collapsible panel with a framer-motion height + spring animation.
 *
 * Base UI's Panel would apply `hidden` the moment a controlled collapsible
 * closes (it can't observe the JS-driven exit animation), which is
 * `display: none` and would freeze the exit mid-flight. So we render through
 * `keepMounted` + `render`, strip Base UI's premature `hidden`, and only
 * apply the attribute ourselves once the framer exit has actually completed.
 * The persistent panel element keeps the trigger ↔ panel ARIA contract
 * intact (the trigger's `aria-controls` id lives on it).
 */
function CollapsePanel({ open, className, children }: CollapsePanelProps) {
  const compactStep = useSize().variant === "compact";
  // The open height is animated to a self-measured LAYOUT pixel value, not
  // `height: "auto"`: framer resolves an "auto" target by measuring the
  // element's *visual* (transformed) size, so under a scaled ancestor
  // (e.g. /demo's 1.7x card) the animation overshoots to scale× the real
  // height and snaps back when the final "auto" lands. offsetHeight and
  // ResizeObserver are transform-immune. Same setup as the accordions.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  // Panels open at mount render `initial: "auto"` and receive their first
  // pixel target a commit later; that hand-off must SNAP (duration 0), not
  // spring. Panels that open later spring normally.
  const needsSnap = useRef(open);

  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    innerRef.current = el;
    if (!el) return;
    if (el.offsetHeight > 0) setContentHeight(el.offsetHeight);
    const ro = new ResizeObserver(() => {
      // Ignore the 0 that fires while the panel is display:none.
      if (el.offsetHeight > 0) setContentHeight(el.offsetHeight);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // Re-measure synchronously (pre-paint) when opening, so the spring's
  // target is the fresh layout height from its first frame.
  useIsoLayoutEffect(() => {
    if (open && innerRef.current && innerRef.current.offsetHeight > 0) {
      setContentHeight(innerRef.current.offsetHeight);
    }
  }, [open]);

  useEffect(() => {
    if (contentHeight !== null) needsSnap.current = false;
  }, [contentHeight]);

  const [exitComplete, setExitComplete] = useState(!open);
  if (open && exitComplete) {
    // Reset during render so the panel is un-hidden before the opening
    // animation's first paint.
    setExitComplete(false);
  }

  return (
    <Collapsible.Panel
      keepMounted
      render={(panelProps) => {
        const {
          // Applied too early for our exit animation (see above); we
          // control the attribute ourselves.
          hidden: _baseHidden,
          // Only carries the --collapsible-panel-height/width vars, which
          // stay 'auto' since Base UI never measures JS-driven animations.
          style: _baseStyle,
          ...restPanel
        } = panelProps as React.HTMLAttributes<HTMLDivElement> & {
          hidden?: boolean;
        };
        return (
          <div {...restPanel} hidden={!open && exitComplete}>
            <motion.div
              className="overflow-hidden"
              initial={{ height: open ? "auto" : 0 }}
              animate={{ height: open ? contentHeight ?? 0 : 0 }}
              // bounce: 0 — pure height looks better without overshoot.
              transition={
                needsSnap.current
                  ? { duration: 0 }
                  : { ...spring.moderate, bounce: 0 }
              }
              onAnimationComplete={() => {
                if (!open) setExitComplete(true);
              }}
            >
              <div
                ref={measureRef}
                className={cn(
                  "text-left text-muted-foreground",
                  compactStep ? "text-[12px]" : "text-[13px]",
                  className
                )}
              >
                {children}
              </div>
            </motion.div>
          </div>
        );
      }}
    />
  );
}

// ─── ThinkingSteps (root) ───────────────────────────────────────────────────

/**
 * Read a persisted ThinkingSteps open flag. Missing or unreadable keys
 * return undefined so the caller can fall back to defaultOpen.
 */
function readStoredOpen(storageKey: string | undefined): boolean | undefined {
  if (!storageKey || typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    // Private mode / quota.
  }
  return undefined;
}

/**
 * Persist a ThinkingSteps open flag. No-op when no key is given.
 */
function writeStoredOpen(storageKey: string | undefined, next: boolean): void {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, next ? "1" : "0");
  } catch {
    // Private mode / quota.
  }
}

interface ThinkingStepsProps extends HTMLAttributes<HTMLDivElement> {
  /** Step on the size ladder. Wins over the surrounding SizeProvider and
   *  propagates to every row inside. */
  size?: SizeVariant;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Persist open/collapsed across remounts under this localStorage key. */
  storageKey?: string;
  children: ReactNode;
}

const ThinkingSteps = forwardRef<HTMLDivElement, ThinkingStepsProps>(
  (
    {
      size,
      defaultOpen = true,
      open,
      onOpenChange,
      storageKey,
      children,
      className,
      ...props
    },
    ref
  ) => {
    // Always drive Base UI as controlled so the header/panel can read the
    // open state (chevron rotation, framer enter/exit) from context.
    const [internalOpen, setInternalOpen] = useState(
      () => (open === undefined ? (readStoredOpen(storageKey) ?? defaultOpen) : defaultOpen)
    );
    const isOpen = open ?? internalOpen;

    useEffect(() => {
      if (open !== undefined || !storageKey) return;
      setInternalOpen(readStoredOpen(storageKey) ?? defaultOpen);
    }, [defaultOpen, open, storageKey]);

    const root = (
      <Collapsible.Root
        ref={ref}
        open={isOpen}
        onOpenChange={(next: boolean) => {
          if (open === undefined) {
            setInternalOpen(next);
            writeStoredOpen(storageKey, next);
          }
          onOpenChange?.(next);
        }}
        className={cn("w-80 max-w-full", className)}
        {...props}
      >
        <ThinkingStepsOpenContext.Provider value={isOpen}>
          {children}
        </ThinkingStepsOpenContext.Provider>
      </Collapsible.Root>
    );

    // A size prop pins every row inside to one ladder step.
    return size ? <SizeProvider size={size}>{root}</SizeProvider> : root;
  }
);
ThinkingSteps.displayName = "ThinkingSteps";

// ─── ThinkingStepsHeader ────────────────────────────────────────────────────

interface ThinkingStepsHeaderProps extends HTMLAttributes<HTMLButtonElement> {
  /** Leading glyph, aligned with the step icons below. */
  icon?: IconName;
  children?: ReactNode;
}

const ThinkingStepsHeader = forwardRef<
  HTMLButtonElement,
  ThinkingStepsHeaderProps
>(({ icon = "brain", children = "Thinking", className, ...props }, ref) => {
  const isOpen = useContext(ThinkingStepsOpenContext);
  return (
    <TriggerRow
      ref={ref}
      open={isOpen}
      icon={icon}
      className={className}
      {...props}
    >
      {children}
    </TriggerRow>
  );
});
ThinkingStepsHeader.displayName = "ThinkingStepsHeader";

// ─── ThinkingStepsContent ───────────────────────────────────────────────────

interface ThinkingStepsContentProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepsContent = forwardRef<
  HTMLDivElement,
  ThinkingStepsContentProps
>(({ children, className, ...props }, ref) => {
  const isOpen = useContext(ThinkingStepsOpenContext);
  return (
    <CollapsePanel className="pt-1" open={isOpen}>
      <div
        ref={ref}
        className={cn("flex flex-col text-left", className)}
        {...props}
      >
        {children}
      </div>
    </CollapsePanel>
  );
});
ThinkingStepsContent.displayName = "ThinkingStepsContent";

// ─── ThinkingStep ───────────────────────────────────────────────────────────

type StepStatus = "complete" | "active" | "pending";

interface ThinkingStepProps {
  icon?: IconName;
  showIcon?: boolean;
  label: ReactNode;
  description?: string;
  status?: StepStatus;
  delay?: number;
  isLast?: boolean;
  children?: ReactNode;
  className?: string;
}

/** Measured layout height for a step's opening animation. `height: "auto"`
 *  is resolved by framer from the element's *visual* (transformed) size, so
 *  under a scaled ancestor (the /demo card) every step springs out to scale x
 *  its real height and snaps back when "auto" lands — the whole list visibly
 *  overshoots as it builds. offsetHeight and ResizeObserver are
 *  transform-immune. Same setup as CollapsePanel above. */
function useStepHeight() {
  const roRef = useRef<ResizeObserver | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const sync = () => {
      if (el.offsetHeight > 0) setHeight(el.offsetHeight);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, height] as const;
}

function ThinkingStep({
  icon = "dot",
  showIcon = true,
  label,
  description,
  status = "complete",
  delay = 0.08,
  isLast = false,
  children,
  className,
}: ThinkingStepProps) {
    const Icon = useIcon(icon);
    const sizeClasses = useSize();
    const [stepRef, stepHeight] = useStepHeight();

    if (status === "pending") return null;

    const isActive = status === "active";

    return (
      /* Outer: animates height to create space smoothly */
      <motion.div
        className={cn("relative z-10 overflow-hidden", className)}
        data-slot="thinking-step"
        data-status={status}
        initial={{ height: 0 }}
        animate={{ height: stepHeight ?? 0 }}
        transition={spring.slow}
      >
        {/* Inner: fades content in after space starts opening — and is the
            element measured for the height above. */}
        <motion.div
          ref={stepRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.24, delay, ease: "easeOut" }}
        >
          {/* Content row — shared type size + line-height so the rail glyph
              is a 1lh box centred on the first line of text. Bottom padding
              lives on the text column (not the row) so the rail stretches and
              the connector can run from below the icon to the next node. */}
          <div
            className={cn(
              `flex ${RAIL_GAP}`,
              railType(sizeClasses.variant === "compact")
            )}
          >
            {/* Icon rail — glyph and connector line share one vertical centre.
                The connector is absolutely pinned below the icon (mid-line +
                half a 14px glyph) so a single-line row still shows a stub. */}
            <div className={`relative flex shrink-0 flex-col items-center self-stretch ${RAIL}`}>
              <RailGlyph>
                {showIcon ? (
                  <Icon
                    size={railIconSize(sizeClasses.variant === "compact")}
                    strokeWidth={1.5}
                    className="block text-muted-foreground"
                  />
                ) : (
                  <div className="h-2 w-2 rounded-full bg-muted-foreground/60" />
                )}
              </RailGlyph>
              {!isLast && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute bottom-0.5 left-1/2 top-[calc(0.5lh+8px)] w-px min-h-2 -translate-x-1/2 bg-border/60"
                  data-slot="thinking-step-connector"
                />
              )}
            </div>

            {/* Text content */}
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1 text-left",
                !isLast && "pb-3"
              )}
            >
              <span
                className={cn(
                  "whitespace-pre-wrap break-words text-foreground",
                  isActive && "shimmer-text"
                )}
                data-slot="thinking-step-label"
                style={{ fontVariationSettings: fontWeights.medium }}
              >
                {label}
                {isActive && "…"}
              </span>
              {description && (
                <span className={cn(sizeClasses.text, "text-muted-foreground leading-snug")}>
                  {description}
                </span>
              )}
              {children}
            </div>
          </div>
        </motion.div>
      </motion.div>
    );
}

// ─── ThinkingStepDetails (nested collapsible) ───────────────────────────────

interface ThinkingStepDetailsProps {
  summary: string;
  details?: string[];
  defaultOpen?: boolean;
  children?: ReactNode;
  className?: string;
}

function ThinkingStepDetails({
  summary,
  details,
  defaultOpen = false,
  children,
  className,
}: ThinkingStepDetailsProps) {
  const compactStep = useSize().variant === "compact";
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={cn("mt-1", className)}
    >
      <TriggerRow open={open} className="gap-1.5">
        {summary}
      </TriggerRow>
      <CollapsePanel open={open}>
        <div className="flex flex-col gap-0.5 pt-0.5 text-left">
          {details?.map((item, i) => (
            <span
              key={i}
              className={cn(
                "text-muted-foreground leading-snug",
                compactStep ? "text-[11px]" : "text-[12px]"
              )}
            >
              {item}
            </span>
          ))}
          {children}
        </div>
      </CollapsePanel>
    </Collapsible.Root>
  );
}

// ─── ThinkingStepSources ────────────────────────────────────────────────────

interface ThinkingStepSourcesProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

const ThinkingStepSources = forwardRef<HTMLDivElement, ThinkingStepSourcesProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex flex-wrap gap-1.5 mt-1", className)}
        {...props}
      >
        {children}
      </div>
    );
  }
);
ThinkingStepSources.displayName = "ThinkingStepSources";

// ─── ThinkingStepSource ─────────────────────────────────────────────────────

interface ThinkingStepSourceProps {
  color?: BadgeColor;
  delay?: number;
  children: ReactNode;
  className?: string;
}

function ThinkingStepSource({ color: _color = "gray", delay = 0, children, className }: ThinkingStepSourceProps) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85, filter: "blur(4px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      transition={{
        ...spring.moderate,
        delay,
        filter: { duration: 0.12, delay },
      }}
    >
      <SourceBadge className={className}>
        {children}
      </SourceBadge>
    </motion.span>
  );
}
ThinkingStepSource.displayName = "ThinkingStepSource";

// ─── ThinkingStepImage ──────────────────────────────────────────────────────

interface ThinkingStepImageProps {
  src: string;
  alt?: string;
  caption?: string;
  delay?: number;
  className?: string;
}

/**
 * Illustration inside a thinking step. Remote hosts go through RemoteImage.
 */
function ThinkingStepImage({ src, alt = "", caption, delay = 0, className }: ThinkingStepImageProps) {
  const shape = useShape();
  // The caption role of the type scale — see /docs/sizes.
  const compact = useSize().variant === "compact";
  return (
    <motion.div
      className={cn("mt-1.5", className)}
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{
        opacity: { duration: 0.2, delay, ease: "easeOut" },
        filter: { duration: 0.15, delay },
      }}
    >
      <RemoteImage
        src={src}
        alt={alt}
        className={cn(
          "w-full max-w-[200px] object-cover",
          shape.container
        )}
      />
      {caption && (
        <span
          className={cn(
            compact ? "text-[11px]" : "text-[12px]",
            "text-muted-foreground mt-1 block"
          )}
        >
          {caption}
        </span>
      )}
    </motion.div>
  );
}
ThinkingStepImage.displayName = "ThinkingStepImage";

// ─── Exports ────────────────────────────────────────────────────────────────

export {
  ThinkingSteps,
  ThinkingStepsHeader,
  ThinkingStepsContent,
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingStepSources,
  ThinkingStepSource,
  ThinkingStepImage,
};

export type {
  ThinkingStepsProps,
  ThinkingStepsHeaderProps,
  ThinkingStepsContentProps,
  ThinkingStepProps,
  ThinkingStepDetailsProps,
  ThinkingStepSourcesProps,
  ThinkingStepSourceProps,
  ThinkingStepImageProps,
  StepStatus,
};
