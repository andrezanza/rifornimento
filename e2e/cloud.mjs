// Test end-to-end della sincronizzazione cloud con gli emulatori Firebase (nessun servizio reale).
//   npx firebase emulators:start --only auth,firestore --project demo-rifornimento
//   VITE_FIREBASE_EMULATOR=http://127.0.0.1 npx vite build --outDir dist-emu && npx vite preview --port 4174 --outDir dist-emu
//   URL=http://localhost:4174/ node e2e/cloud.mjs
// Verifica: accesso, copia automatica, recupero su un telefono "vuoto", allineamento tra due
// dispositivi (aggiunte ed eliminazioni), modifiche offline inviate al ritorno della rete.
import { chromium } from 'playwright-core';
const URL_ = process.env.URL || 'http://localhost:4174/';
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); process.exitCode = 1; } else console.log('ok -', m); };
const EMAIL = `andrea${Date.now()}@example.com`, PW = 'segreta123';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errors = [];
async function device() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  await p.goto(URL_);
  return { ctx, p };
}
async function login(p, create = false) {
  await p.locator('summary:has-text("Accedi con email e password")').first().click();
  await p.fill('input[name=cloudEmail]', EMAIL);
  await p.fill('input[name=cloudPassword]', PW);
  await p.locator(create ? '[data-testid=cloud-register]' : '[data-testid=cloud-login]').first().click();
}
const workKm = async (p) => (await p.textContent('body')).match(/(\d[\d.]*) km di lavoro|Uso lavorativo[^0-9]*(\d[\d.]*) km/)?.slice(1).find(Boolean);
async function addWork(p, km) {
  await p.click('nav button:has-text("Registra")');
  await p.fill('input[name=workKm]', String(km));
  await p.click('button:has-text("Salva")');
  await p.waitForSelector('text=Uso lavorativo');
}
async function waitSynced(p) {
  await p.click('nav button:has-text("Impostazioni")');
  await p.waitForSelector('.badge:has-text("sincronizzato")', { timeout: 15000 });
  await p.click('nav button:has-text("Situazione")');
}

// A: primo telefono, dati importati, poi attivazione del cloud con un nuovo account
const A = await device();
await A.p.waitForSelector("text=Hai già usato l'app?", { timeout: 10000 });
ok(true, 'onboarding propone il recupero dal cloud');
await A.p.click('[data-testid=onboard]');
await A.p.waitForSelector('text=Saldo benzina lavorativo');
ok(await A.p.isVisible('text=Attiva la copia nel cloud'), 'Situazione invita ad attivare il cloud');
await login(A.p, true);
await waitSynced(A.p);
ok(!(await A.p.isVisible('text=Attiva la copia nel cloud')), 'invito sparito dopo l\'accesso');
await addWork(A.p, 84);
ok(await A.p.isVisible('text=1746 km'), 'registrazione su A');
await waitSynced(A.p);
ok(!(await A.p.isVisible('[data-testid=backup-now]')), 'con il cloud attivo nessun promemoria di backup manuale');

// B: telefono nuovo / dati persi → accesso dall'onboarding e recupero completo
const B = await device();
await login(B.p);
await B.p.waitForSelector('text=Saldo benzina lavorativo', { timeout: 15000 });
ok(await B.p.isVisible('text=1746 km'), 'telefono vuoto: dati recuperati dal cloud dopo l\'accesso');

// allineamento in tempo reale B → A
await addWork(B.p, 10);
await A.p.waitForSelector('text=1756 km', { timeout: 15000 });
ok(true, 'registrazione fatta su B compare su A');

// eliminazione su A → sparisce su B
await A.p.click('nav button:has-text("Storico")');
const first = await A.p.locator('.li').first().textContent();
await A.p.locator('.li').first().locator('button[aria-label=Elimina]').click();
await A.p.click('nav button:has-text("Situazione")');
await B.p.waitForSelector('text=1746 km', { timeout: 15000 });
ok(true, `eliminazione propagata (${first?.slice(0, 40)}…)`);

// modifica offline su B, inviata al ritorno della rete
await B.ctx.setOffline(true);
await addWork(B.p, 20);
await B.p.click('nav button:has-text("Impostazioni")');
ok(await B.p.isVisible('.badge:has-text("in invio")'), 'offline: modifica salvata e in attesa di invio');
await B.ctx.setOffline(false);
await A.p.waitForSelector('text=1766 km', { timeout: 20000 });
ok(true, 'modifica offline arrivata su A al ritorno della rete');

// C: terzo dispositivo, verifica dei dati completi e del registro rettifiche
const C = await device();
await login(C.p);
await C.p.waitForSelector('text=1766 km', { timeout: 15000 });
await C.p.click('nav button:has-text("Storico")');
await C.p.click('button[role=radio]:has-text("Rettifiche")');
ok(await C.p.isVisible('text=Eliminata'), 'registro rettifiche sincronizzato');

// cancellazione dati su A: resta tutto nel cloud
await A.p.click('nav button:has-text("Impostazioni")');
await A.p.locator('summary:has-text("Zona pericolosa")').click();
await A.p.click('button:has-text("Cancella tutti i dati")');
await A.p.waitForSelector("text=Hai già usato l'app?");
await C.p.waitForTimeout(1500);
await C.p.click('nav button:has-text("Situazione")');
ok(await C.p.isVisible('text=1766 km'), 'cancellare i dati di un telefono non tocca il cloud');
await login(A.p);
await A.p.waitForSelector('nav', { timeout: 15000 });
await A.p.click('nav button:has-text("Situazione")');
await A.p.waitForSelector('text=1766 km', { timeout: 15000 });
ok(true, 'stesso telefono dopo la cancellazione: dati di nuovo recuperati');

ok(errors.length === 0, `nessun errore JavaScript ${errors.join(' | ')}`);
await browser.close();
