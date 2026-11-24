// Draws Matinee's one logo, the same everywhere and in every theme (20 Nov: standardise the Matinee logo everywhere,
// no more colour changes", and a dark logo for light mode): a charcoal cinema ticket with a cream edge and a big M in slanted stripes of
// the five feel colours. It is drawn afresh at every size rather than shrunk from one big picture.
//   build/icon.ico (+ icon.png)          the .exe / installer / shortcut / pinned taskbar icon
//   electron/icons/matinee.ico (+ .png)  the running window's icon (taskbar button, Alt+Tab)
//   build/icon-mac.png                   the Mac app and Dock icon: a full charcoal tile in Apple's icon grid with the striped M and
//                                        a feel-coloured tear line (macSvg below)
//   ui/assets/logo.png                   the logo at the top of the side menu: the same charcoal ticket since 22 Nov ("not a
//                                        fan of white matinee logo on dark mode, lets try the dark one"). railSvg, the earlier white ticket
//                                        (20 Nov, "in app use the old design"), is kept below in case it is wanted back.
//   node build/make-icon.mjs      (needs Playwright's Chromium; PW=<playwright dir> to override)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = createRequire(import.meta.url)(process.env.PW || '/opt/node22/lib/node_modules/playwright');
const fontFile = path.join(here, '..', 'node_modules/@fontsource-variable/big-shoulders-display/files/big-shoulders-display-latin-wght-normal.woff2');
const font = 'data:font/woff2;base64,' + fs.readFileSync(fontFile).toString('base64');

// How it got here (20 Nov): the white ticket with pastel stripes and a dotted tear line read as a blur on a dark taskbar (pastel on white is
// 1.6-2.3:1 contrast, the stripes and dashes were 1-3 pixels wide at 32 px, and the charcoal edge vanished on a dark taskbar). From
// mock-ups dropped into a real taskbar screenshot this one was picked: taller ticket filling more of the square, cream edge that shows
// on a dark taskbar, charcoal body that shows on a light one, a bolder M, and stronger versions of the feel colours (the Map's pastels,
// ui/screens/map/model.js FEELING_COLOURS, are too pale at icon size). No tear line: too fine to survive at taskbar size.
const BOLD = ['#e8735d', '#e5b54f', '#5fbf7a', '#5f93d9', '#9b7be0']; // red, yellow, green, blue, purple (stronger)
// a ticket: rounded rectangle with a half-circle notch cut into each side at mid height
const ticketPath = (x, y, w, h, r, n) => { const my = y + h / 2; return `M${x + r},${y} H${x + w - r} A${r},${r} 0 0 1 ${x + w},${y + r} V${my - n} A${n},${n} 0 0 0 ${x + w},${my + n} V${y + h - r} A${r},${r} 0 0 1 ${x + w - r},${y + h} H${x + r} A${r},${r} 0 0 1 ${x},${y + h - r} V${my + n} A${n},${n} 0 0 0 ${x},${my - n} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} Z`; };
const ticketSvg = () => {
  const stops = BOLD.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><style>@font-face{font-family:BS;src:url("${font}");font-weight:100 900}</style>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="110" y1="110" x2="400" y2="400">${stops}</linearGradient></defs>
<path d="${ticketPath(26, 62, 460, 388, 56, 74)}" fill="#2b2a2a" stroke="#ece6e0" stroke-width="20"/>
<text x="256" y="262" text-anchor="middle" dominant-baseline="central" font-family="BS" font-weight="900" font-size="400" fill="url(#g)">M</text></svg>`;
};
// The Mac icon (24 Nov, picked from mock-ups in a real Dock): a full charcoal tile in Apple's grid (824 of 1024, corner radius 185), since
// macOS 26 puts any icon that isn't a full tile into a grey one. The striped M with a tear line of the five feel colours down the right.
const macSvg = () => {
  const stops = BOLD.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join('');
  const tear = BOLD.map((c, k) => `<line x1="760" y1="${292 + k * 92}" x2="760" y2="${292 + k * 92 + 56}" stroke="${c}" stroke-width="26" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><defs><style>@font-face{font-family:BS;src:url("${font}");font-weight:100 900}</style>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="300" y1="300" x2="724" y2="724">${stops}</linearGradient></defs>
<rect x="100" y="100" width="824" height="824" rx="185" fill="#2b2a2a"/>
<text x="470" y="515" text-anchor="middle" dominant-baseline="central" font-family="BS" font-weight="900" font-size="560" fill="url(#g)">M</text>${tear}</svg>`;
};
// The in-app logo: the white ticket with a charcoal edge, the M in the Map's pastel feel colours and a tear line of one dash each.
const FEEL = ['#ec9481', '#e9c77f', '#95d0a2', '#94b6e2', '#bea6e8']; // the Map's own pastels (ui/screens/map/model.js)
const railSvg = () => {
  const step = (360 - 92) / 5;
  const tear = FEEL.map((c, k) => { const y0 = 76 + 46 + k * step; return `<line x1="392" y1="${y0 + 6}" x2="392" y2="${y0 + step - 14}" stroke="${c}" stroke-width="16" stroke-linecap="round"/>`; }).join('');
  const rim = 18, stops = FEEL.map((c, i) => `<stop offset="${i / 5}" stop-color="${c}"/><stop offset="${(i + 1) / 5}" stop-color="${c}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><style>@font-face{font-family:BS;src:url("${font}")}</style>
<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="120" y1="120" x2="392" y2="392">${stops}</linearGradient></defs>
<path d="${ticketPath(10 + rim / 2, 76 + rim / 2, 492 - rim, 360 - rim, 54, 64)}" fill="#ffffff" stroke="#2b2a2a" stroke-width="${rim}"/>
${tear}
<text x="214" y="262" text-anchor="middle" dominant-baseline="central" font-family="BS" font-weight="800" font-size="330" fill="url(#g)">M</text></svg>`;
};
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
/** An .ico holding one PNG per size (Windows picks the size it needs, so nothing is shrunk blurry). */
const ico = pngs => {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, k) => {
    const e = 6 + 16 * k;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3); head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.data)]);
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
const svgUrl = (make = ticketSvg) => 'data:image/svg+xml;base64,' + Buffer.from(make()).toString('base64');
const drawAt = async (size, make) => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0;background:transparent"><img id="i" width="${size}" height="${size}" src="${svgUrl(make)}"></body>`);
  await page.waitForFunction(() => document.getElementById('i').complete);
  await page.evaluate(() => document.fonts.ready);
  return page.locator('#i').screenshot({ omitBackground: true });
};
const pngs = [];
for (const size of ICO_SIZES) pngs.push({ size, data: await drawAt(size) });
const icoFile = ico(pngs), win = path.join(here, '..', 'electron', 'icons'), ui = path.join(here, '..', 'ui', 'assets');
fs.mkdirSync(win, { recursive: true }); fs.mkdirSync(ui, { recursive: true });
fs.writeFileSync(path.join(here, 'icon.png'), await drawAt(512));
fs.writeFileSync(path.join(here, 'icon.ico'), icoFile);
fs.writeFileSync(path.join(win, 'matinee.ico'), icoFile);
fs.writeFileSync(path.join(win, 'matinee.png'), await drawAt(256));
fs.writeFileSync(path.join(here, 'icon-mac.png'), await drawAt(1024, macSvg));
fs.writeFileSync(path.join(ui, 'logo.png'), await drawAt(128)); // shown at 40 px: sharp up to 3x screens
console.log('wrote build/icon.png, build/icon.ico, build/icon-mac.png, electron/icons/matinee.ico + .png and ui/assets/logo.png (ico sizes', ICO_SIZES.join(', ') + ')');
await browser.close();
