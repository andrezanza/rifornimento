import { chromium } from 'playwright-core';
const url = process.argv[2] || 'http://localhost:4173/';
const out = process.argv[3] || '/tmp/claude-0/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await page.goto(url);
await page.screenshot({ path: `${out}/0-onboarding.png`, fullPage: true });
await page.click('[data-testid=onboard]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/1-dashboard.png`, fullPage: true });
for (const [i, label] of [['2', 'Rifornimento'], ['3', 'Storico'], ['4', 'Impostazioni'], ['5', 'Registra']]) {
  await page.click(`nav button:has-text("${label}")`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${i}-${label}.png`, fullPage: true });
}
console.log('errors', JSON.stringify(errs));
await browser.close();
