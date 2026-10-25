// Test end-to-end su build di produzione (npm run build && npx vite preview --port 4173).
// Verifica: onboarding, registrazione km e rifornimento, assistente, funzionamento offline,
// backup e ripristino su un "dispositivo" diverso (contesto browser separato), manifest PWA.
import { chromium } from 'playwright-core';
import { readFileSync, mkdirSync } from 'node:fs';
const URL_ = process.env.URL || 'http://localhost:4173/';
const SHOTS = process.env.SHOTS || '/tmp/e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(URL_);

// Manifest e service worker
const manifest = await page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json());
ok(manifest.display === 'standalone' && manifest.icons.some((i) => i.sizes === '512x512'), 'manifest installabile (standalone, icona 512)');
await page.evaluate(() => navigator.serviceWorker.ready);
ok(true, 'service worker attivo');

// Onboarding
await page.click('[data-testid=onboard]');
await page.waitForSelector('text=Saldo benzina lavorativo');
ok(await page.isVisible('text=Prossimo pieno'), 'dashboard dopo onboarding');

// Registrazione km lavorativi
await page.click('nav button:has-text("Registra")');
await page.fill('input[name=workKm]', '84');
await page.fill('input[name=workOdo]', '3200');
await page.click('button:has-text("Salva")');
await page.waitForSelector('text=Uso lavorativo');
ok(await page.isVisible('text=1746 km'), 'km lavorativi aggiornati (1662 + 84)');

// Validazione: contachilometri inferiore
await page.click('nav button:has-text("Registra")');
await page.click('button[role=radio]:has-text("Benzina")');
await page.fill('input[name=fuelOdo]', '2000');
ok(await page.isVisible('text=Deve essere ≥'), 'validazione contachilometri');

// Rifornimento completo personale
await page.fill('input[name=fuelOdo]', '3400');
await page.fill('input[name=fuelLiters]', '30,5');
await page.fill('input[name=fuelAmount]', '60,39');
ok(await page.isVisible('text=Prezzo unitario: 1,980 €/l'), 'prezzo unitario calcolato');
await page.click('button:has-text("Salva")');
await page.waitForSelector('text=Saldo benzina lavorativo');

// Assistente
await page.click('nav button:has-text("Rifornimento")');
const verdict = await page.textContent('[data-testid=verdict]');
ok(!!verdict, `assistente risponde: ${verdict}`);
await page.screenshot({ path: `${SHOTS}/planner.png`, fullPage: true });

// Storico mesi
await page.click('nav button:has-text("Storico")');
await page.click('button[role=radio]:has-text("Mesi")');
ok(await page.isVisible('text=settembre 2026') && await page.isVisible('text=ottobre 2026'), 'report mensile settembre e ottobre');
await page.click('button[role=radio]:has-text("Grafici")');
await page.screenshot({ path: `${SHOTS}/charts.png`, fullPage: true });
await page.click('button[role=radio]:has-text("Calcoli")');
await page.screenshot({ path: `${SHOTS}/segments.png`, fullPage: true });

// Offline: ricarica senza rete
await ctx.setOffline(true);
await page.reload();
await page.waitForSelector('nav', { timeout: 8000 });
await page.click('nav button:has-text("Situazione")');
await page.waitForSelector('text=Saldo benzina lavorativo', { timeout: 8000 });
ok(true, 'app funzionante offline dopo ricarica, dati presenti');
await page.click('nav button:has-text("Registra")');
await page.fill('input[name=workKm]', '10');
await page.click('button:has-text("Salva")');
await page.waitForSelector('text=Uso lavorativo');
ok(await page.isVisible('text=1756 km'), 'registrazione offline salvata');
await ctx.setOffline(false);

// Backup
await page.click('nav button:has-text("Impostazioni")');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("Salva backup")')]);
const path = `${SHOTS}/backup.json`;
await dl.saveAs(path);
const backup = JSON.parse(readFileSync(path, 'utf8'));
ok(backup.app === 'rifornimento' && backup.state.entries.length === 19, `backup con ${backup.state.entries.length} registrazioni`);
await page.screenshot({ path: `${SHOTS}/settings.png`, fullPage: true });

// Ripristino su altro dispositivo (contesto pulito)
const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
const p2 = await ctx2.newPage();
await p2.goto(URL_);
await p2.click('text=Inizia senza dati storici');
await p2.click('nav button:has-text("Impostazioni")');
p2.on('dialog', (d) => d.accept());
await p2.setInputFiles('[data-testid=restore-input]', path);
await p2.waitForTimeout(500);
await p2.click('nav button:has-text("Situazione")');
ok(await p2.isVisible('text=1756 km'), 'ripristino su nuovo dispositivo: dati identici');
// Dati persistenti dopo chiusura
await p2.close();
const p3 = await ctx2.newPage();
await p3.goto(URL_);
await p3.waitForSelector('text=Saldo benzina lavorativo');
ok(await p3.isVisible('text=1756 km'), 'dati persistenti dopo riapertura');

// Modifica retroattiva ed eliminazione dallo storico
await p3.click('nav button:has-text("Storico")');
p3.on('dialog', (d) => d.accept());
const before = await p3.locator('.li').count();
await p3.locator('.li').first().locator('button[aria-label=Elimina]').click();
await p3.waitForTimeout(300);
ok(await p3.locator('.li').count() === before - 1, 'eliminazione con ricalcolo');
await p3.click('button[role=radio]:has-text("Rettifiche")');
ok(await p3.isVisible('text=Eliminata'), 'eliminazione tracciata nel registro rettifiche');

ok(errors.length === 0, `nessun errore JavaScript ${errors.join(' | ')}`);
await browser.close();
