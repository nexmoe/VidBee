/**
 * Distance from the scroll viewport's content start to the virtual list.
 * Includes content above the list, such as the cookies tip.
 */
export const readDownloadListScrollMargin = (list: HTMLElement, viewport: HTMLElement): number => {
  const listTop = list.getBoundingClientRect().top
  const viewportTop = viewport.getBoundingClientRect().top
  return listTop - viewportTop + viewport.scrollTop
}
