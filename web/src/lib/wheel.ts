// Scrolls a sideways strip with an ordinary mouse wheel: up scrolls left, down scrolls right, anywhere over
// the node. At either end the wheel goes back to scrolling the page. target: the element that scrolls,
// when it is a child of the area that listens.
export function wheelScroll(node: HTMLElement, target?: string) {
  const onwheel = (e: WheelEvent) => {
    const el = target ? node.querySelector<HTMLElement>(target) : node;
    if (!el || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0 || (e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max - 1)) return;
    e.preventDefault();
    el.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 32 : 1);
  };
  node.addEventListener("wheel", onwheel, { passive: false });
  return { destroy: () => node.removeEventListener("wheel", onwheel) };
}
