# Rifornimento

PWA personale (Android e desktop, offline, senza account) per gestire la carta carburante aziendale UTA e+ di un'auto a uso promiscuo plug-in hybrid: saldo lavorativo in litri e kWh, assistente "posso pagare con la carta aziendale?", plafond, storico mensile, backup.

- **Usare l'app:** pubblica la cartella `dist/` su un hosting statico gratuito (Netlify Drop, GitHub Pages) e installala da Chrome. Vedi `DOCUMENTAZIONE.md` §8.
- **Metodologia, architettura, test:** `DOCUMENTAZIONE.md`.

```bash
npm install
npm run dev       # sviluppo
npm test          # test contabili
npm run build     # produce dist/
```
