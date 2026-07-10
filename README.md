# Cyber Asset Inventory & Risk Assessment

Klientapp (HTML/CSS/JS) + Cloudflare Pages Functions + D1-databas.
Flera konsulter och kunder kan dela samma data över tid via **arbetsrum**
(ett arbetsrum = ett kunduppdrag).

## Arkitektur

```
index.html / style.css / script.js   → statisk frontend (Cloudflare Pages)
functions/api/...                     → serverless API (Cloudflare Pages Functions)
migrations/schema.sql                 → D1-databasschema
wrangler.toml                         → Cloudflare-konfiguration
```

Data flödar: `frontend fetch('/api/...') → Pages Function → D1-databas`.
Ingen egen server att drifta.

## Ett-gångs-setup

Kräver [Node.js](https://nodejs.org) och ett Cloudflare-konto.

```cmd
npm install -g wrangler
wrangler login
```

### 1. Skapa D1-databasen

```cmd
wrangler d1 create risk_assessment_db
```

Kommandot skriver ut ett `database_id`. Klistra in det i `wrangler.toml`
(ersätt `REPLACE_WITH_YOUR_DATABASE_ID`).

### 2. Kör schemat mot databasen

```cmd
wrangler d1 execute risk_assessment_db --remote --file=./migrations/schema.sql
```

(Kör utan `--remote` först om du vill testa lokalt.)

### 3. Skapa Pages-projektet och koppla D1

Enklast via dashboarden:
1. **dash.cloudflare.com → Workers & Pages → Create → Pages → Connect to Git**
2. Välj `CyberbobSweden/risk-assessment-spa`
3. Build settings: **Framework preset: None**, **Build command: (tomt)**, **Build output directory: `/`**
4. Efter första deploy: gå till projektet → **Settings → Functions → D1 database bindings**
   → lägg till binding med namn **`DB`** som pekar på `risk_assessment_db`
5. Redeploy en gång så att bindningen slår igenom

Eller via CLI:

```cmd
wrangler pages deploy . --project-name=risk-assessment-spa
```

(D1-bindningen i `wrangler.toml` följer med automatiskt vid CLI-deploy.)

### 4. Sätt upp Cloudflare Access (inloggning/delning)

För att bara rätt konsulter och kunder ska kunna nå appen:

1. **Zero Trust-dashboarden → Access → Applications → Add an application → Self-hosted**
2. Domän: din Pages-URL (t.ex. `risk-assessment-spa.pages.dev` eller egen domän)
3. Policy: lägg till regler, t.ex.
   - **Allow**: er egen e-postdomän (t.ex. `@dittbolag.se`)
   - **Allow**: specifika kund-e-postadresser (en policy per kundengagemang, eller en gemensam lista)
4. Spara — nu krävs inloggning (Google/Microsoft/e-post-OTP m.m., valfritt i Access-policyn) för att nå appen överhuvudtaget

**Notera:** Access styr *vem som kommer in på sajten*. Alla som släpps in ser
listan över arbetsrum och kan välja/skapa ett. Om ni vill att en specifik
kund bara ska se sitt eget arbetsrum (inte andras) är nästa steg att lägga
till en `members`-tabell i D1 och filtrera `/api/workspaces` på
`Cf-Access-Authenticated-User-Email` — hör av dig om ni vill ha det inbyggt.

## Lokal utveckling

```cmd
wrangler d1 execute risk_assessment_db --local --file=./migrations/schema.sql
wrangler pages dev . --d1=DB=risk_assessment_db
```

Öppna `http://localhost:8788`. Utan Access framför lokal dev loggas ändringar
med `okänd användare` som utförare — det är förväntat.

## Funktioner

- Dashboard med KPI:er, 6 diagram, Top 10-risker, Quick Wins, prioriterade åtgärder
- Systeminventering med 5-stegs formulär och automatisk riskanalys (0–100 poäng)
- Riskanalys, beroenden/leverantörskedjor
- 5 rapporttyper, export till PDF/Excel/CSV/JSON
- Flera arbetsrum (ett per kunduppdrag), delad data i realtid mellan alla med åtkomst
- All data i D1 (SQLite på Cloudflares edge), ingen data i webbläsarens LocalStorage
  förutom en pekare till "senast öppnade arbetsrum"
