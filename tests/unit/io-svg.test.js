// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeSvg } from '../../src/io/svg-sanitize.js';

describe('svg sanitizer', () => {
  it('removes scripts, handlers and external references, keeps shapes', () => {
    const src = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10" onload="alert(1)">
      <style>.a { fill: red } @import url(http://x.com/y.css);</style>
      <script>alert(1)</script>
      <foreignObject><div>hi</div></foreignObject>
      <rect class="a" width="5" height="5" onclick="x()"/>
      <image href="http://evil.example/x.png" width="1" height="1"/>
      <use xlink:href="#r"/>
      <circle cx="5" cy="5" r="2" style="stroke: blue; background: url(http://x)"/>
      <a href="javascript:alert(1)"><path d="M0 0L1 1"/></a>
    </svg>`;
    const { svg, width, height } = sanitizeSvg(src);
    expect(width).toBe(10);
    expect(height).toBe(10);
    expect(svg).not.toMatch(/script|onload|onclick|foreignObject|evil|javascript|@import/);
    expect(svg).toMatch(/<rect[^>]*fill="red"/);
    expect(svg).toMatch(/<circle[^>]*stroke="blue"/);
    expect(svg).toMatch(/<path/);
    expect(svg).toMatch(/<use[^>]*href="#r"/);
  });

  it('is idempotent', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><g fill="#123"><rect x="1" y="2" width="3" height="4"/></g></svg>';
    const a = sanitizeSvg(src).svg;
    const b = sanitizeSvg(a).svg;
    expect(b).toBe(a);
  });

  it('rejects entities and svgs without size', () => {
    expect(() => sanitizeSvg('<!DOCTYPE svg [<!ENTITY a "x">]><svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow();
    expect(() => sanitizeSvg('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toThrow(/viewBox/);
  });
});

