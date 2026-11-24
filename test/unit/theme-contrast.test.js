import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Parses the colour tokens in ui/styles/tokens.css and checks WCAG contrast so palette edits cannot regress.
const css = readFileSync(new URL('../../ui/styles/tokens.css', import.meta.url), 'utf8');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
const dark = tokens(css.slice(css.indexOf(':root, [data-theme="dark"] {'), css.indexOf('@media (prefers-color-scheme')));
const lightStart = css.indexOf('[data-theme="light"] {');
const neutralStart = css.indexOf('[data-theme="neutral"] {');
const light = tokens(css.slice(lightStart, neutralStart));
const neutralLightStart = css.indexOf('[data-theme="neutral-light"] {');
const neutral = tokens(css.slice(neutralStart, neutralLightStart));
const neutralLight = tokens(css.slice(neutralLightStart));
const lightMedia = tokens(css.slice(css.indexOf('@media (prefers-color-scheme: light)'), lightStart));

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mixSoft = (fg, bg, alpha) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));

const themes = { dark, light, neutral, 'neutral-light': neutralLight };

test('light theme tokens match in the media query and the data-theme rule', () => {
  for (const k of Object.keys(light)) if (k in lightMedia) assert.equal(lightMedia[k], light[k], k);
});

for (const [name, t] of Object.entries(themes)) {
  const c = (k) => rgb(t[k]);
  test(`${name}: text tokens reach 4.5:1 on bg, surface and raised`, () => {
    for (const k of ['text', 'muted', 'faint', 'accent-text', 'good', 'warn', 'bad']) {
      for (const bg of ['bg', 'surface', 'raised']) {
        const r = ratio(c(k), c(bg));
        assert.ok(r >= 4.5, `${k} on ${bg} is ${r.toFixed(2)}`);
      }
    }
  });
  test(`${name}: accent text stays readable on accent-soft chips`, () => {
    const a = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(t['accent-soft']);
    const soft = (bg) => mixSoft([+a[1], +a[2], +a[3]], c(bg), +a[4]);
    for (const bg of ['bg', 'surface']) assert.ok(ratio(c('accent-text'), soft(bg)) >= 4.5, `accent-text on soft/${bg}`);
  });
  test(`${name}: muted stays stronger than faint`, () => {
    assert.ok(ratio(c('muted'), c('bg')) > ratio(c('faint'), c('bg')) + 0.4);
  });
  test(`${name}: --accent-ink on --accent and --on-bad on --bad reach 4.5:1`, () => {
    assert.ok(ratio(c('accent-ink'), c('accent')) >= 4.5);
    assert.ok(ratio(c('on-bad'), c('bad')) >= 4.5);
  });
  test(`${name}: control borders reach 3:1 on bg and raised, focus ring on bg`, () => {
    assert.ok(ratio(c('control-border'), c('bg')) >= 3);
    assert.ok(ratio(c('control-border'), c('raised')) >= 3);
    const ring = t.focus && t.focus.startsWith('#') ? rgb(t.focus) : c('accent'); // --focus is deeper than --accent in light
    assert.ok(ratio(ring, c('bg')) >= 3, 'focus ring');
    const star = t.star && t.star.startsWith('#') ? rgb(t.star) : c('accent');
    assert.ok(ratio(star, c('surface')) >= 3, 'star colour on surface');
  });
}

// The feel palette's deeper edge variants (borders and bars) must show on the page in every theme.
for (const [name, t] of Object.entries(themes)) {
  test(`${name}: feel palette edges reach 2:1 on bg`, () => {
    for (const f of ['red', 'yellow', 'green', 'blue', 'purple']) {
      const edge = t[`feel-${f}-edge`] || dark[`feel-${f}-edge`];
      assert.ok(ratio(rgb(edge), rgb(t.bg)) >= 2, `${f} edge on ${name}`);
    }
  });
}
