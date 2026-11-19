# GameVault Deals-Bot (Steam DE, PlayStation Store DE & PS Plus)

Dieses öffentliche Begleit-Repository ruft täglich vollautomatisch per GitHub Actions aktuelle **Steam-Sales (DE)**, **PlayStation-Store-Sales (DE)** sowie den **PlayStation-Plus-Katalog** ab und speichert das Ergebnis in `deals.json`.

**Datenschutz:** Dieses Repository enthält keinerlei persönliche Daten und keinen APK-Signatur-Schlüssel – ausschließlich öffentliche Shop-Preise.

## Einrichtung (2 Minuten)
1. Lege auf GitHub ein **öffentliches (Public)** Repository mit dem Namen `gamevault-deals` an.
2. Lade `catalog-index.json`, `deals.json`, `scripts/fetch-deals.mjs` und `README.md` hoch.
3. Lege im Reiter **Actions** (über *„set up a workflow yourself“*) die Datei `.github/workflows/update-deals.yml` an (Inhalt liegt im ZIP unter `.github/workflows/update-deals.yml`).
4. Starte den Workflow einmalig manuell über **Actions → Update GameVault Deals & PS Plus (DE) → Run workflow**.
5. Fertig! Deine GameVault-App ruft ab sofort automatisch `https://raw.githubusercontent.com/Veodin-del/gamevault-deals/main/deals.json` ab.
