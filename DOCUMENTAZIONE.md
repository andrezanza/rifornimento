# Rifornimento — documentazione di progetto

PWA personale, gratuita e local-first per gestire la carta carburante aziendale UTA e+ di una CUPRA Formentor e-HYBRID a uso promiscuo.

Indice: 1. Analisi · 2. Metodologia · 3. Architettura · 4. Schermate · 5. Implementazione · 6. Inizializzazione con i dati reali · 7. Test e limiti · 8. Installazione e uso · 9. Miglioramenti futuri

---

## 1. Analisi del problema e criticità

### Fatti verificati (fonti pubbliche, ottobre 2026)

| Dato | Valore | Fonte |
|---|---|---|
| Serbatoio Formentor e-HYBRID (facelift 2024+) | **40 l** | alvolante.it (scheda 1.5 e-HYBRID 272 CV), encycarpedia.com (204 CV) |
| Batteria | 25,8 kWh lordi / **19,7 kWh netti** | encycarpedia.com |
| UTA e+ (Edenred UTA Mobility) | carta "multienergia": carburante e ricarica su un'unica carta | missionline.it (2024), comunicato UTA eCharge Italia (aprile 2025) |
| Plafond 500 €: data di rinnovo, unico o separato per ricariche | **non verificabile** pubblicamente | → impostazione **provvisoria** e configurabile |

### Dati disponibili, stimati e sconosciuti

- **Certi:** date, contachilometri, litri, importi e metodo di pagamento dei tre rifornimenti; data di consegna; contachilometri attuale (2.910 km).
- **Stimati:** km lavorativi 1.650–1.660 (aggregati, non ripartibili per mese né per intervallo).
- **Sconosciuti:** benzina presente alla consegna; benzina prima/dopo ogni rifornimento; se i rifornimenti erano pieni completi; storico delle ricariche domestiche.

### Criticità principali

1. **Ibrido plug-in.** Il consumo di benzina per km varia enormemente con la quota percorsa in elettrico. Un consumo medio (19,3 km/l) applicato ai km lavorativi produce crediti fittizi.
2. **I consumi medi del computer di bordo non sono coerenti con gli acquisti.** 2.910 km a 19,3 km/l richiederebbero circa 151 l, ma risultano acquistati 107,05 l più al massimo 40 l presenti alla consegna, e il serbatoio adesso è quasi pieno (39,03 l acquistati 158 km fa). Le medie si riferiscono quindi a una finestra diversa (memoria del computer) e **non vengono usate come misura**.
3. **Litri acquistati ≠ litri consumati.** La benzina resta nel serbatoio. L'incertezza però è limitata fisicamente: al massimo 40 l, e prima di ogni rifornimento c'era spazio per i litri acquistati. Esempio: il 23/10 sono entrati 39,03 l in un serbatoio da 40 l, quindi prima c'erano al massimo 0,97 l.
4. **Il carburante alla consegna** è stato fornito con l'auto, quindi non da Andrea. È l'unico dato storico sconosciuto che sposta davvero il saldo (fino a 40 l × quota personale ≈ 17 l).
5. **Regole aziendali minime.** La carta è riservata ai consumi lavorativi; il resto (metodo di ripartizione, compensazione nel tempo, plafond) è un'**ipotesi operativa**, configurabile e dichiarata come tale.

---

## 2. Metodologia di calcolo

### Confronto

| Metodo | Pro | Contro | Esito |
|---|---|---|---|
| **A. Ripartizione proporzionale degli acquisti** (litri acquistati × km lavoro/km totali) | semplicissimo | ignora la benzina nel serbatoio; ogni rifornimento è "giusto" solo a posteriori; non dice quanto si può pagare con la carta | scartato come metodo unico |
| **A'. Consumo medio × km lavorativi** | non serve sapere quando si fa il pieno | in un PHEV il consumo/km è molto variabile: genera crediti fittizi | scartato |
| **B. Contabilità progressiva** (maturato − già pagato) | gestisce la compensazione nel tempo e il "posso pagare adesso?" | serve una misura del maturato | adottata come struttura |
| **C. Ibrido: B alimentata da consumi misurati pieno-a-pieno e quota chilometrica per tratto** | consumo reale (benzina, non km), incertezza esplicita, nessun dato inventato | richiede di segnalare i pieni completi | **adottato** |
| Tracciamento di ogni viaggio / GPS | massima precisione | onere quotidiano e privacy | escluso |

### Variabili

- `C` capacità serbatoio (40 l). `S` scorta nel serbatoio, sempre gestita come intervallo `[min, max]`.
- **Ancore**: punti in cui la scorta è nota o delimitata, cioè inizio contabilità, pieno completo (S = C) e lettura dell'indicatore (modalità avanzata).
- **Tratto** `i`: dall'ancora `i` alla successiva. `P_i` litri acquistati nel tratto, `A_i` di cui con carta aziendale.
- `km_i` dal contachilometri; `L_i` km lavorativi registrati nel tratto; quota `w_i = L_i / km_i`.

### Formule

```
consumo_i       = S_inizio + P_i − S_fine                    (pieno-a-pieno: = P_i, misurato)
maturato_i      = consumo_i × w_i                             litri lavorativi
fornitura_0     = S_consegna   (se il carburante iniziale è fornito dall'azienda)
saldo_benzina   = Σ maturato_i − Σ A_i − fornitura_0          [litri]
```

- La scorta tra le ancore si propaga così: `S − km × [consumo/km max, min]`, poi si limita a `[0, C]`. A ogni rifornimento `S ≤ C − litri` prima, `S + litri` dopo.
- Il consumo per km serve **solo** per il tratto non ancora chiuso da un pieno. È misurato dagli ultimi 5 tratti pieno-a-pieno (±15–20%); in mancanza si usa l'intervallo predefinito 2–7 l/100 km (centrale 5,2); se disponibile, il consumo "dal rifornimento" del computer di bordo ±10%.
- Saldo **in litri** (neutrale rispetto alle variazioni di prezzo). Controvalore in € indicativo, all'ultimo prezzo pagato.
- **Elettrico, saldo separato in kWh** (mai convertito in litri): `Σ kWh ammissibili × quota lavorativa cumulata − kWh pagati con UTA e+`. Sono ammissibili le ricariche pubbliche; quelle domestiche solo se abilitato (di default sono solo statistica). L'energia domestica ha una valorizzazione separata (€/kWh configurabile, default 0,25), solo informativa.

### Incertezza

Ogni grandezza è un intervallo `[min, centrale, max]`. Gli estremi del contributo di ogni tratto si calcolano sugli estremi congiunti delle variabili (scorta iniziale, scorta finale, quota), così da non perdere la correlazione tra carburante iniziale consumato e carburante iniziale fornito. Nelle schermate:
- **affidabilità** (alta ≤ 2 l, media ≤ 6 l, bassa oltre) dell'incertezza *corrente*;
- **incertezza storica fissa** (carburante alla consegna), dichiarata a parte;
- **criterio prudente** (default): le raccomandazioni usano il limite inferiore del saldo, meno un margine di sicurezza (1 l).

### Raccomandazione sul rifornimento

L'assistente aggiunge al registro un rifornimento **simulato** e ricalcola tutto con lo stesso motore, così la simulazione coincide per costruzione con ciò che si vedrà dopo averlo registrato. Poi cerca i litri massimi `L` per cui `saldo_dopo(L, carta aziendale) ≥ margine` e li confronta con il plafond residuo.

- Con un **pieno completo** il tratto si chiude e il consumo diventa misurato. Una quota `w` dei litri reintegrati è quindi già lavorativa: `L_max ≈ saldo / (1 − w)`.
- Con un **parziale** il consumo resta stimato: `L_max ≈ saldo stimato`.
- Esiti possibili: *carta aziendale compatibile*, *parziale aziendale potenzialmente compatibile (fino a X l)*, *carta personale consigliata*, *dati insufficienti* (km non aggiornati, oppure incertezza troppo ampia rispetto ai litri). Ogni esito ha una motivazione esplicita e riporta che **non è un'autorizzazione aziendale**.

### Compensazione nel tempo (configurabile)

Il credito maturato con pieni personali usati anche per lavoro si compensa con pieni aziendali successivi. È una **scelta operativa**, non un diritto riconosciuto. Si può limitare con un *tetto al credito riportabile* (litri) e segnare il criterio come "concordato con l'azienda" una volta che lo è.

### Limiti

- Dentro un tratto, km lavorativi e personali hanno lo stesso consumo per km. In realtà un'autostrada di lavoro può consumare più benzina di brevi tragitti personali in elettrico, e viceversa. È il compromesso tra precisione e semplicità; tratti brevi (pieni frequenti) lo riducono.
- I km lavorativi aggregati su più tratti vengono attribuiti al tratto in cui termina il periodo.
- Il saldo tra un pieno e l'altro è una stima; diventa una misura al pieno successivo (la "riconciliazione").

---

## 3. Architettura

| Scelta | Motivo |
|---|---|
| **React 18 + TypeScript + Vite** | standard, molto documentati, manutenzione semplice; TypeScript protegge il modello contabile |
| **vite-plugin-pwa (Workbox)** | service worker e manifest generati: installabile su Android, funziona offline |
| **IndexedDB, un unico documento JSON** | pochi dati (centinaia di righe l'anno): ogni salvataggio è atomico e il backup coincide con i dati salvati; fallback su localStorage |
| **Nessun server, account, analytics o GPS** | local-first, gratuito, privacy |
| **Grafici in SVG scritti a mano** | nessuna dipendenza in più |
| **Hosting statico gratuito** (GitHub Pages, Netlify, Cloudflare Pages) | nessun costo ricorrente; serve solo a scaricare l'app, i dati non lasciano il telefono |

Struttura:

```
src/domain/   motore contabile puro e testabile (nessuna dipendenza dal browser)
  types.ts      modello dati (importi in centesimi, litri in centilitri, energia in Wh: interi)
  engine.ts     propagazione della scorta, tratti, saldi, plafond, elettrico, avvisi
  planner.ts    assistente rifornimento/ricarica (simulazione sul ledger)
  reports.ts    report mensili, periodi di plafond, CSV, backup JSON e validazione
  seed.ts       impostazioni predefinite e storico reale di Andrea
src/data/     persistenza IndexedDB, stato React, registro rettifiche, copie di sicurezza
src/ui/       schermate
tests/        25 test contabili (Vitest)
e2e/          test end-to-end nel browser (Playwright + Chromium)
```

**Modello dati:** registro di eventi (`fuel`, `charge`, `work`, `reading`) + impostazioni + registro rettifiche. I saldi non vengono mai salvati: sono ricalcolati ogni volta, quindi modifiche e cancellazioni retroattive si riconciliano da sole.

---

## 4. Schermate

1. **Situazione** (dashboard): raccomandazione per il prossimo pieno con i litri aziendali giustificabili; saldo benzina (intervallo, affidabilità, controvalore in €); saldo ricariche; plafond con barra e stato "provvisorio"; km totali, lavorativi e personali con la percentuale; ultimo rifornimento; avvisi (backup, dati vecchi, incoerenze); "Come è calcolato".
2. **Registra**: quattro moduli rapidi.
   - *Km lavoro*: km con tasti +20/+40…, contachilometri facoltativo che calcola i km personali, periodo aggregato, intervallo min–max.
   - *Benzina*: contachilometri, litri, importo, prezzo calcolato, carta, pieno sì/parziale/non so.
   - *Ricarica*: domestica (kWh oppure n. ricariche × kWh, stimata, aggregata) o pubblica (personale/UTA e+, proporzionale o di trasferta).
   - *Lettura*: contachilometri; in modalità avanzata livello serbatoio in ottavi, consumo "dal rifornimento", kWh/100 km e km elettrici.
   La validazione è automatica: contachilometri coerente con le registrazioni prima e dopo, km lavorativi ≤ km percorsi, litri ≤ serbatoio, prezzo plausibile, plafond.
3. **Rifornimento** (assistente): pieno o parziale, litri, prezzo o importo, contachilometri, km di lavoro non ancora registrati. Mostra l'esito, il massimo in litri con carta aziendale, una tabella "prima / dopo con carta aziendale / dopo con carta personale", spazio nel serbatoio, plafond e la motivazione. Un pulsante passa direttamente alla registrazione precompilata. Una scheda analoga copre le ricariche pubbliche.
4. **Storico**:
   - *Registrazioni*: filtri, modifica, eliminazione.
   - *Mesi*: personale/aziendale per benzina e ricariche, km, periodi di plafond, **riepilogo documentabile stampabile in PDF**.
   - *Grafici*: spese mensili, saldo progressivo con banda d'incertezza, consumo per tratto, km.
   - *Calcoli*: ogni tratto con tutte le grandezze.
   - *Rettifiche*: registro di tutte le operazioni, con il valore precedente.
5. **Impostazioni**: backup/ripristino/CSV, regole di ripartizione, plafond, veicolo e stime, metodologia.

---

## 5. Implementazione

Codice completo in questa cartella. Comandi:

```bash
npm install          # una volta
npm run dev          # sviluppo su http://localhost:5173
npm test             # 25 test contabili
npm run build        # crea la cartella dist/ da pubblicare
npx vite preview --port 4173 & node e2e/run.mjs   # test end-to-end (serve Chromium)
```

---

## 6. Inizializzazione con i dati reali

Alla prima apertura l'app mostra i dati già noti, distinti in certi, stimati, sconosciuti e provvisori, e li importa con un tocco senza chiedere di reinserirli. Aggiornamento del 25/10/2026 con i dati forniti da Andrea.

**Rifornimenti** (tutti pieni completi, confermati):

| Data | Km | Litri | Importo | €/l (calcolato) | Pagamento |
|---|---:|---:|---:|---:|---|
| 30/09/2026 | 1.220 | 32,34 | 64,00 € | 1,979 | personale |
| 11/10/2026 | 1.981 | 35,68 | 71,00 € | 1,990 | personale |
| 23/10/2026 | 2.752 | 39,03 | 77,67 € | 1,990 | UTA e+ |

**Tragitti lavorativi:** 11 tragitti datati, 1.662 km in totale (10 casa-lavoro e ritorno, 1 trasferta da cliente), registrati con il tipo di tragitto.

**Altri dati:**
- consegna 18/09 con circa 1/4 di serbatoio, un po' meno, non in riserva (6–10 l, fornito con l'auto, quindi aziendale);
- rilevazioni il 23/10 a 2.910 km e il 25/10 a 3.073 km, con indicatore a metà.

**Report mensile ricostruito:**

| Mese | Benzina personale | Benzina aziendale | Km lavorativi |
|---|---|---|---|
| settembre 2026 | 64,00 € (32,34 l) | 0,00 € | 507 km |
| ottobre 2026 | 71,00 € (35,68 l) | 77,67 € (39,03 l) | 1.155 km |

**Tratti pieno-a-pieno:**

| Tratto | Km | Benzina consumata | Quota lavoro | Litri lavorativi |
|---|---:|---:|---:|---:|
| consegna → 30/09 | 0–1.220 | 0–2,3 l (*) | 41,6% | ≈ 0,1 l |
| 30/09 → 11/10 | 1.220–1.981 | 35,68 l (misurato) | 73,1% | 26,1 l |
| 11/10 → 23/10 | 1.981–2.752 | 39,03 l (misurato) | 58,5% | 22,8 l |
| 23/10 → 25/10 | 2.752–3.073 | 17,5–18,8 l (dall'indicatore) | 46,1% | 8,7 l |

Il consumo misurato è 4,7–5,1 l/100 km.

**Saldo benzina al 25/10: +10,7 l (intervallo 8,9–12,5 l), affidabilità alta.** Litri lavorativi maturati 57,7 l, meno 39,03 l pagati con UTA e meno 6–10 l forniti con l'auto.

(*) **Anomalia del primo tratto.** Con 6–10 l alla consegna e 32,34 l per tornare al pieno su un serbatoio da 40 l, nei primi 1.220 km risultano consumati al massimo 2,3 l. Ai consumi misurati dopo (circa 5 l/100 km) ne servirebbero circa 55–60. Le spiegazioni possibili sono un rifornimento non registrato prima del 30/09, più benzina alla consegna, oppure un primo periodo quasi tutto in elettrico (improbabile con tragitti da 169 km). L'app lo segnala; il calcolo resta prudente, perché attribuisce meno credito. Se emerge un rifornimento mancante, aggiungilo dallo storico: tutti i saldi si ricalcolano.

**Cosa significa per i prossimi rifornimenti:**
- Il prossimo **pieno** va pagato con la carta personale. I circa 18 l consumati tra il 23 e il 25/10 (46% lavoro) sono già nel saldo, e un pieno aziendale li farebbe pagare interamente all'azienda.
- Dopo qualche giornata di lavoro è invece compatibile un **parziale aziendale** (circa 18 l dopo 300 km di lavoro).
- Il pieno successivo, a uso simile, tornerà tipicamente compatibile con la carta aziendale.

## 7. Test e limitazioni

### Eseguiti (tutti superati)

**26 test contabili** (`tests/scenarios.test.ts`, incluso il caso reale di Andrea con i dati del 25/10), uno o più per ciascuno dei 20 scenari richiesti:

1. solo km lavorativi;
2. solo km personali;
3. alternanza;
4. viaggio quasi tutto elettrico (nessun credito fittizio);
5. pieno aziendale dopo pieni personali, verificato che simulazione = registrazione;
6. pieno aziendale oltre il saldo (esito parziale, saldo negativo se forzato);
7. parziale che non chiude il tratto, riconciliato al pieno successivo;
8. ricarica UTA e+ (saldo kWh separato);
9. ricariche domestiche stimate (solo statistica, credito solo se abilitato);
10. km non aggiornati (avviso, esito cauto, km lavorativi oltre l'ultima lettura);
11. modifica ed eliminazione retroattive;
12. plafond superato e giorno di rinnovo diverso dal 1°;
13. saldo iniziale non ricostruibile con i dati reali (intervallo, restringimento con il dato di consegna, modalità ripartenza);
14. consumo misurato anziché predefinito, computer di bordo;
15. importo o prezzo mancanti;
16–17. backup, validazione, ripristino identico;
18. storico reale (settembre/ottobre, CSV);
19. prezzi unitari e aritmetica intera;
20. separazione personale/aziendale nei report, ricariche comprese.

Invarianti aggiuntivi: maturato lavorativo + personale = benzina consumata (nessun doppio conteggio); il carburante iniziale aziendale riduce il saldo; errore se i km lavorativi superano i km percorsi; errore se il contachilometri decresce; tetto al credito; il criterio prudente non consiglia mai più del criterio centrale.

**16 verifiche end-to-end** su build di produzione in Chromium (`e2e/run.mjs`): manifest installabile, service worker, onboarding, registrazione km e rifornimento, validazione, prezzo calcolato, assistente, report mensili, **funzionamento offline dopo ricarica e registrazione offline**, backup scaricato, **ripristino in un browser pulito (altro dispositivo)**, persistenza alla riapertura, eliminazione con ricalcolo e traccia nel registro, nessun errore JavaScript.

### Non eseguibili in questo ambiente

- Installazione reale su uno smartphone Android e verifica di "Aggiungi a schermata Home". Il manifest e il service worker soddisfano i criteri di Chrome, ma va provato sul telefono.
- Condivisione del backup verso Google Drive con il menu di condivisione Android: testato solo il download.
- Verifica delle condizioni reali del plafond UTA e+.

### Limitazioni residue

Quelle della metodologia (§2), più:
- i dati vivono nel browser del telefono: senza backup, la disinstallazione o la pulizia dei dati del sito li cancella;
- un aggiornamento dell'app non tocca i dati, ma cambiare indirizzo web (dominio) crea un archivio nuovo e vuoto: in quel caso si ripristina il backup.

---

## 8. Installazione e uso

### 1. Pubblicare l'app (una volta, gratis)

L'app è un sito statico: basta pubblicare la cartella `dist/`. Due opzioni, entrambe gratuite e senza abbonamenti:

- **Netlify Drop** (la più semplice): crea un account gratuito su netlify.com, apri *app.netlify.com/drop* e trascina la cartella `dist`. Ottieni un indirizzo `https://nome-a-caso.netlify.app`, che puoi rinominare nelle impostazioni del sito.
- **GitHub Pages** (configurazione adottata): il repository `andrezanza/rifornimento` contiene il codice e il workflow `.github/workflows/deploy.yml`, che a ogni push su `main` esegue i test, crea `dist/` e la pubblica. Una tantum: *Settings → Pages → Source: GitHub Actions*. Indirizzo: `https://andrezanza.github.io/rifornimento/`.

L'hosting serve solo a scaricare l'app: i dati restano sul telefono.

### 2. Installarla su Android

Apri l'indirizzo con **Chrome**, menu ⋮ → **Installa app** (o "Aggiungi a schermata Home"). Si apre a schermo intero e funziona offline.

### 3. Configurare i dati iniziali

Alla prima apertura controlla i dati precaricati, indica se ricordi la benzina alla consegna e tocca **Importa i dati e inizia**. Poi apri *Impostazioni → Plafond* e correggi giorno di rinnovo e perimetro appena li conosci; segna "verificato".

### 4. Primo aggiornamento

*Registra → Km lavoro*: inserisci i km di lavoro della giornata (o della settimana) e, se puoi, il contachilometri. I km personali si calcolano da soli.

### 5. Usare l'assistente

Prima di andare al distributore apri **Rifornimento**: vedi se il pieno è compatibile con la carta aziendale e fino a quanti litri. Al distributore fai il pieno: se la pompa si ferma entro il limite indicato puoi pagare con UTA e+, altrimenti paga con la carta personale. Poi tocca *Registra con carta…*: la registrazione è precompilata.

### 6. Backup e ripristino

*Impostazioni → Salva backup* crea un file JSON. Su Android puoi condividerlo direttamente su Google Drive o via email. Fallo **almeno una volta al mese e dopo ogni rifornimento aziendale**; la dashboard lo ricorda dopo 30 giorni.

Per ripristinare (anche su un altro telefono): installa l'app, tocca *Inizia senza dati storici*, poi *Impostazioni → Ripristina da backup* e scegli il file. Prima di ogni ripristino o cancellazione l'app conserva una copia di sicurezza interna.

### 7. Aggiornare l'app senza perdere lo storico

Ripubblica allo **stesso indirizzo** (con GitHub Pages basta un push su `main`: il workflow pubblica solo se i test passano). All'apertura successiva compare "Nuova versione disponibile → Aggiorna". I dati restano nel telefono e le impostazioni nuove vengono aggiunte automaticamente. Per prudenza fai un backup prima di aggiornare.

---

## 9. Miglioramenti futuri (non essenziali)

- Promemoria settimanale per inserire i km (notifiche push richiedono un server: valutare un promemoria di sistema Android).
- Lettura della foto dello scontrino o del cruscotto (OCR locale).
- Importazione dell'estratto conto UTA e+ (CSV) per riconciliare gli addebiti aziendali.
- Attribuzione con consumi diversi per km lavorativi e personali, se il computer di bordo offre "km elettrici" affidabili per tragitto.
- Saldo unico in euro tra benzina ed elettrico, attivabile solo se concordato con l'azienda.
- Più veicoli o passaggio a una nuova auto aziendale.
