/** Minimal inline SVG line-icons for empty states. Plain geometric paths
 * (not a third-party icon set) — monochrome, sized via currentColor so they
 * pick up whatever text color the container sets. */

const NS = "http://www.w3.org/2000/svg";

function svg(paths: string[], size: number): SVGSVGElement {
  const el = document.createElementNS(NS, "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("fill", "none");
  el.setAttribute("stroke", "currentColor");
  el.setAttribute("stroke-width", "1.5");
  el.setAttribute("stroke-linecap", "round");
  el.setAttribute("stroke-linejoin", "round");
  for (const d of paths) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    el.append(path);
  }
  return el;
}

export function folderIcon(size = 32): SVGSVGElement {
  return svg(["M3 7h5l2 2h11v10H3V7z"], size);
}

export function fileIcon(size = 32): SVGSVGElement {
  return svg(["M6 2h9l5 5v15H6V2z", "M15 2v5h5"], size);
}

export function packageIcon(size = 32): SVGSVGElement {
  return svg(["M12 3l9 5v8l-9 5-9-5V8l9-5z", "M3 8l9 5 9-5", "M12 13v8"], size);
}

export function chatIcon(size = 32): SVGSVGElement {
  return svg(["M4 4h16v12H8l-4 4V4z"], size);
}
