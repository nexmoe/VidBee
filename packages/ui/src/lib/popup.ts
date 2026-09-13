export const popupMotionClass =
  "origin-top [--popup-enter-y:-4px] " +
  "data-[side=top]:origin-bottom data-[side=top]:[--popup-enter-y:4px] " +
  "[[data-side=top]_&]:origin-bottom [[data-side=top]_&]:[--popup-enter-y:4px] " +
  "data-[side=left]:origin-right data-[side=left]:[--popup-enter-y:0px] " +
  "[[data-side=left]_&]:origin-right [[data-side=left]_&]:[--popup-enter-y:0px] " +
  "data-[side=right]:origin-left data-[side=right]:[--popup-enter-y:0px] " +
  "[[data-side=right]_&]:origin-left [[data-side=right]_&]:[--popup-enter-y:0px]";

/**
 * Popup lists scroll inside ScrollArea: the hover-revealed thumb instead of
 * the platform scrollbar, and a scroll-aware fade on the viewport. The popup
 * is only max-height constrained, so the viewport's percentage height can't
 * resolve — it inherits the max-height instead (the ScrollArea root inherits
 * it from the popup) and sizes to its rows up to that. The scroll primitive's
 * inline-styled sizer is forced back to a plain block so rows can shrink and
 * truncate; the `[style]` qualifier keeps that off the rows' own wrapper on
 * touch devices, where ScrollArea renders no sizer.
 */
export const popupScrollAreaClass = "min-h-0 flex-1 max-h-[inherit]";
export const popupViewportClass =
  "!h-auto max-h-[inherit] [&>div[style]]:!block [&>div[style]]:!min-w-0 [--scroll-fade-size:32px]";

/** Keys that count as keyboard navigation inside a popup (earn the ring). */
export const POPUP_NAV_KEYS = [
  "ArrowDown",
  "ArrowUp",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Tab",
];

/**
 * Rows the fluid hover must skip: a disabled row is neither a target
 * nor a hover stop, whichever attribute the primitive marks it with.
 */
export function isDisabledRow(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");
}
