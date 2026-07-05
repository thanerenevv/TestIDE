export function makeResizerV(
  target: HTMLElement,
  handle: HTMLElement,
  min: number,
  max: number,
  onResize?: () => void,
) {
  handle.addEventListener("mousedown", (e) => {
    const startX = e.clientX;
    const startWidth = target.getBoundingClientRect().width;
    handle.classList.add("active");

    const onMove = (ev: MouseEvent) => {
      const w = Math.min(max, Math.max(min, startWidth + (ev.clientX - startX)));
      target.style.width = `${w}px`;
      onResize?.();
    };
    const onUp = () => {
      handle.classList.remove("active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}

export function makeResizerH(
  target: HTMLElement,
  handle: HTMLElement,
  min: number,
  max: number,
  onResize?: () => void,
) {
  handle.addEventListener("mousedown", (e) => {
    const startY = e.clientY;
    const startHeight = target.getBoundingClientRect().height;
    handle.classList.add("active");

    const onMove = (ev: MouseEvent) => {
      const h = Math.min(max, Math.max(min, startHeight - (ev.clientY - startY)));
      target.style.height = `${h}px`;
      onResize?.();
    };
    const onUp = () => {
      handle.classList.remove("active");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    e.preventDefault();
  });
}
