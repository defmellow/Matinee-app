import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Guards the motion rules: tokens for durations, no layout animation, reduced-motion kept, keyframes exist.
const root = new URL('../../ui/', import.meta.url).pathname;
function walk(d) {
  return readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
  });
}
const files = walk(root).filter((p) => !p.endsWith('tokens.css')).map((p) => ({ p: p.slice(root.length), css: readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const all = files.map((f) => f.css).join('\n');
const decls = (prop) => files.flatMap(({ p, css }) => [...css.matchAll(new RegExp(`(?:^|[;{\\s])${prop}\\s*:\\s*([^;}]+)`, 'g'))].map((m) => ({ p, v: m[1].trim() })));

// Layout properties may only be transitioned here: thin progress bars (width) and nothing else.
const LAYOUT = /\b(width|height|top|left|right|bottom|margin[a-z-]*|padding[a-z-]*|grid-template[a-z-]*|inset|max-height|min-height)\b/;
const LAYOUT_OK = [{ file: 'styles/base.css', prop: 'width' }, { file: 'screens/person.css', prop: 'width' }];
// Durations that may stay literal: infinite loops, not transitions.
const LITERAL_OK = [/^spin \.8s linear infinite$/, /^mt-pulse 1\.4s ease-in-out infinite$/];

test('no `transition: all`', () => {
  assert.ok(!/transition\s*:[^;}]*\ball\b/.test(all));
  assert.ok(!/transition-property\s*:\s*all/.test(all));
});

test('transitions only touch layout properties on the allow-list', () => {
  for (const { p, v } of decls('transition')) {
    for (const part of v.split(/,(?![^(]*\))/)) {
      const prop = part.trim().split(/\s+/)[0];
      if (LAYOUT.test(prop)) assert.ok(LAYOUT_OK.some((o) => o.file === p && o.prop === prop), `${p}: transition of ${prop}`);
    }
  }
});

test('keyframes only animate transform, opacity and friends', () => {
  for (const m of all.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
    for (const d of m[2].matchAll(/([\w-]+)\s*:/g)) {
      if (['from', 'to'].includes(d[1])) continue;
      assert.ok(['transform', 'opacity', 'filter', 'color', 'background-color'].includes(d[1]), `${m[1]} animates ${d[1]}`);
    }
  }
});

test('the global reduced-motion rule is still in base.css', () => {
  const base = readFileSync(join(root, 'styles/base.css'), 'utf8');
  assert.match(base, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ animation: none !important; transition: none !important; \} \}/);
});

test('every referenced @keyframes exists', () => {
  const defined = new Set([...all.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));
  for (const { p, v } of decls('animation')) {
    const name = v.split(/\s+/).find((w) => /^[a-z][\w-]*$/.test(w) && !/^(linear|ease|ease-in|ease-out|ease-in-out|infinite|both|backwards|forwards|none|alternate)$/.test(w) && !/^\d/.test(w));
    if (name) assert.ok(defined.has(name), `${p}: ${name} is not defined`);
  }
});

test('durations come from --dur-* tokens', () => {
  for (const prop of ['transition', 'animation']) {
    for (const { p, v } of decls(prop)) {
      if (/^(none|inherit|unset)( !important)?$/.test(v)) continue;
      if (LITERAL_OK.some((re) => re.test(v))) continue;
      assert.ok(!/(?<![\w-])\d*\.?\d+m?s\b/.test(v.replace(/var\([^)]*\)/g, '')), `${p}: literal duration in ${prop}: ${v}`);
      assert.match(v, /var\(--dur-\d\)/, `${p}: ${prop}: ${v}`);
    }
  }
});

test('no animation delay or smooth scrolling that would hold up interaction', () => {
  assert.ok(!/\.main\s*\{[^}]*scroll-behavior\s*:\s*smooth/.test(all));
  assert.ok(!/will-change/.test(all));
});
