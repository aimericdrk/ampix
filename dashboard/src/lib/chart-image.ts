/**
 * Chart PNG export. Charts render as SVG (Recharts) with colors driven entirely by CSS custom
 * properties (`var(--series-1)`, `var(--chart-surface)`, etc. — see `src/index.css`). A detached,
 * serialized SVG cannot resolve `var()` (there is no cascade to look them up in), so naively
 * serializing + rasterizing an SVG produces a blank/black image. `svgToPngBlob` works around this
 * by cloning the SVG and inlining every color/font property as a concrete, computed value on the
 * clone *before* serializing it — mirrors `csv.ts`'s split between a pure, testable transform
 * (`inlineComputedStyles`) and the DOM/canvas side effect (`svgToPngBlob`/`downloadPng`).
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Style properties resolved from the live cascade and inlined onto the detached clone. */
const STYLE_PROPS = [
  'fill',
  'stroke',
  'color',
  'stop-color',
  'font-family',
  'font-size',
  'font-weight',
] as const;

/**
 * Walks `source` and `clone` in tandem — `clone` must be a deep clone of `source`, so both trees
 * have identical shape — and, for every element, resolves each of `STYLE_PROPS` via
 * `getComputedStyle(source)` and writes the concrete resolved value onto the corresponding `clone`
 * element (as an inline style, plus the `stop-color` attribute for gradient `<stop>`s, since some
 * SVG renderers prefer the presentation attribute over CSS for stops). This turns
 * `fill: var(--series-1)` into `fill: rgb(42, 120, 214)` (or whatever the live cascade resolves
 * it to), so the clone renders correctly once detached from the document. Exported standalone so
 * it's unit-testable without a canvas.
 */
export function inlineComputedStyles(source: Element, clone: Element): void {
  if (typeof getComputedStyle !== 'function') return;

  const computed = getComputedStyle(source);
  const style = (clone as unknown as { style?: CSSStyleDeclaration }).style;
  for (const prop of STYLE_PROPS) {
    const value = computed.getPropertyValue(prop);
    if (!value) continue;
    style?.setProperty(prop, value);
    if (prop === 'stop-color') {
      clone.setAttribute('stop-color', value);
    }
  }

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  sourceChildren.forEach((sourceChild, i) => {
    const cloneChild = cloneChildren[i];
    if (cloneChild) inlineComputedStyles(sourceChild, cloneChild);
  });
}

/** Resolves a chart's numeric width/height, preferring the SVG's own viewBox over layout size
 * (layout size is 0 in environments without real rendering, e.g. jsdom). */
function resolveSize(svg: SVGSVGElement): { width: number; height: number } {
  const viewBox = svg.viewBox?.baseVal;
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) {
    return { width: viewBox.width, height: viewBox.height };
  }
  const rect = svg.getBoundingClientRect();
  return {
    width: rect.width || svg.clientWidth || 400,
    height: rect.height || svg.clientHeight || 300,
  };
}

/**
 * Clones `svg`, inlines its computed colors/fonts (see `inlineComputedStyles`), stamps a
 * `--chart-surface`-colored background rect behind everything (SVGs are transparent by default,
 * which would otherwise bake as black/transparent in the PNG), serializes it, and rasterizes it
 * onto a canvas at `scale`x (2x by default) for a crisp export. Resolves the canvas's PNG `Blob`.
 * Rejects (rather than throwing synchronously) when the environment can't rasterize — no browser
 * `Image`/canvas, or a 2D context is unavailable — so callers can catch it like any async failure.
 */
export function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined' || typeof Image === 'undefined') {
      reject(new Error('svgToPngBlob requires a browser environment'));
      return;
    }

    const { width, height } = resolveSize(svg);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(svg, clone);

    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));

    const surface = getComputedStyle(svg).getPropertyValue('--chart-surface').trim() || '#ffffff';
    const background = document.createElementNS(SVG_NS, 'rect');
    background.setAttribute('x', '0');
    background.setAttribute('y', '0');
    background.setAttribute('width', String(width));
    background.setAttribute('height', String(height));
    background.setAttribute('fill', surface);
    clone.insertBefore(background, clone.firstChild);

    const serialized = new XMLSerializer().serializeToString(clone);
    const dataUrl = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(serialized)))}`;

    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('2D canvas context is unavailable'));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas failed to produce a PNG blob'));
      }, 'image/png');
    };
    image.onerror = () => reject(new Error('Failed to load the serialized SVG for rasterization'));
    image.src = dataUrl;
  });
}

/**
 * Triggers a browser download of `blob` as `filename` (a `.png` suffix is appended if missing) via
 * a temporary object URL. Mirrors `downloadCsv`; no-ops outside a DOM environment so callers don't
 * need to guard every call site.
 */
export function downloadPng(filename: string, blob: Blob): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return;

  const name = filename.endsWith('.png') ? filename : `${filename}.png`;
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
