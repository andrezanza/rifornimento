// Genera le icone PNG dall'SVG con Chromium (eseguito una sola volta in sviluppo).
import { chromium } from 'playwright-core';
import { readFileSync } from 'node:fs';
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.12]]) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - 2 * pad));
  const body = pad
    ? `<div style="width:${size}px;height:${size}px;background:#0f766e;display:grid;place-items:center">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace('rx="112"', 'rx="0"')}</div>`
    : svg.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  await page.screenshot({ path: new URL(`../public/${name}`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
