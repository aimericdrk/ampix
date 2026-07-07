import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadPng, inlineComputedStyles, svgToPngBlob } from './chart-image';

const SVG_NS = 'http://www.w3.org/2000/svg';

describe('inlineComputedStyles', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('replaces a var(--x) fill with the resolved computed value on the clone', () => {
    // Hand-built tree: <svg><rect fill="var(--series-1)"/><circle/></svg>. jsdom doesn't resolve
    // CSS custom properties through getComputedStyle, so we mock it to simulate what a real
    // browser cascade would resolve `var(--series-1)` to.
    const svg = document.createElementNS(SVG_NS, 'svg');
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('fill', 'var(--series-1)');
    const circle = document.createElementNS(SVG_NS, 'circle');
    svg.append(rect, circle);

    const clone = svg.cloneNode(true) as SVGSVGElement;
    const [cloneRect, cloneCircle] = Array.from(clone.children);

    const resolved: Record<string, string> = { fill: 'rgb(42, 120, 214)' };
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const overrides = el === rect ? resolved : {};
      return {
        getPropertyValue: (prop: string) => overrides[prop] ?? '',
      } as CSSStyleDeclaration;
    });

    inlineComputedStyles(svg, clone);

    expect((cloneRect as SVGElement).style.fill).toBe('rgb(42, 120, 214)');
    // Elements with no resolved value are left untouched.
    expect((cloneCircle as SVGElement).style.fill).toBe('');
  });

  it('sets both the inline style and the stop-color attribute for gradient stops', () => {
    const stop = document.createElementNS(SVG_NS, 'stop');
    const clone = stop.cloneNode(true) as SVGElement;

    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: (prop: string) => (prop === 'stop-color' ? 'rgb(1, 2, 3)' : ''),
    } as CSSStyleDeclaration);

    inlineComputedStyles(stop, clone);

    expect(clone.style.getPropertyValue('stop-color')).toBe('rgb(1, 2, 3)');
    expect(clone.getAttribute('stop-color')).toBe('rgb(1, 2, 3)');
  });

  it('does nothing when getComputedStyle is unavailable (no-DOM guard)', () => {
    const svg = document.createElementNS(SVG_NS, 'svg');
    const clone = svg.cloneNode(true) as SVGElement;
    vi.stubGlobal('getComputedStyle', undefined);

    expect(() => inlineComputedStyles(svg, clone)).not.toThrow();

    vi.unstubAllGlobals();
  });
});

describe('svgToPngBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** jsdom implements `Image` but never fires load/error for data URLs, so we stub it to
   * synchronously invoke `onload` — this test is about our pipeline wiring (inline -> serialize ->
   * draw -> toBlob), not actual browser image decoding, which jsdom can't do anyway. */
  function stubImageAutoLoad() {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal('Image', FakeImage);
  }

  it('rasterizes the inlined clone onto a canvas and resolves the PNG blob', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 100 50');
    document.body.appendChild(svg);

    stubImageAutoLoad();
    const drawImage = vi.fn();
    const fakeBlob = new Blob(['fake-png'], { type: 'image/png' });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(fakeBlob);
    });

    const blob = await svgToPngBlob(svg);

    expect(blob).toBe(fakeBlob);
    expect(drawImage).toHaveBeenCalledTimes(1);

    document.body.removeChild(svg);
  });

  it('rejects when a 2D canvas context is unavailable', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 100 50');

    stubImageAutoLoad();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    await expect(svgToPngBlob(svg)).rejects.toThrow('2D canvas context is unavailable');
  });

  it('rejects instead of throwing when there is no browser Image constructor', async () => {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    vi.stubGlobal('Image', undefined);

    await expect(svgToPngBlob(svg)).rejects.toThrow('requires a browser environment');
  });
});

describe('downloadPng', () => {
  it('creates an object URL, an anchor, clicks it, then revokes the URL', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadPng('chart', new Blob(['fake-png'], { type: 'image/png' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    clickSpy.mockRestore();
  });

  it('appends a .png suffix when the filename lacks one', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createElementSpy = vi.spyOn(document, 'createElement');

    downloadPng('active-users', new Blob(['fake-png'], { type: 'image/png' }));

    const anchor = createElementSpy.mock.results.find(
      (r) => r.value instanceof HTMLAnchorElement,
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe('active-users.png');

    clickSpy.mockRestore();
    createElementSpy.mockRestore();
  });
});
