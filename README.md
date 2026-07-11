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

### 4. Kör databasmigreringarna (om databasen redan finns sen tidigare)

Om du redan körde `schema.sql` innan denna uppdatering saknas tabellerna
`workspace_members` och `users`. Kör båda:

```cmd
wrangler d1 execute risk_assessment_db --remote --file=./migrations/0002_members.sql
wrangler d1 execute risk_assessment_db --remote --file=./migrations/0003_users.sql
```

(Nya installationer får båda tabellerna automatiskt via `schema.sql` och kan hoppa över detta steg.)

### 5. Sätt JWT-hemligheten (för riktig inloggning)

Inloggningen fungerar precis som i share-your-music: e-post + lösenord,
PBKDF2-hashat (100 000 iterationer, SHA-256, unikt salt per användare), och en
signerad JWT (giltig 30 dagar) sparas i webbläsarens `localStorage` efter
inloggning. Inget kort krävs, ingen Cloudflare Access behövs.

```cmd
wrangler pages secret put JWT_SECRET --project-name=risk-assessment-spa
```

Klistra in en lång, slumpad sträng när den frågar (t.ex. 40+ tecken —
generera en med `openssl rand -hex 32` eller valfri lösenordsgenerator).
Detta är hemligheten som signerar alla inloggningstokens; byt den och alla
utfärdade tokens blir ogiltiga (alla loggas ut).

**Så fungerar det för användarna:** första besöket möts av en startsida →
"Kom igång" → registrera konto (e-post + lösenord, minst 8 tecken) eller
logga in om kontot redan finns. Vem som helst kan skapa ett konto — det är
**arbetsrums-medlemskapet** (nästa steg) som styr vilken data de faktiskt ser,
inte kontot i sig.

### 6. Arbetsrums-medlemskap (vem ser vilket arbetsrum)

Inloggningen styr *vem som har ett konto överhuvudtaget*. Vem som ser *vilket
specifikt arbetsrum* styrs separat, av en `workspace_members`-tabell i D1:

- Den som skapar ett arbetsrum läggs till som medlem automatiskt.
- Lägg till fler medlemmar (kollegor, kundens kontaktperson) under
  **Inställningar → Dela arbetsrum** i appen — bara deras e-postadress krävs,
  och den måste matcha exakt den e-post de registrerar sitt konto med.
- Den som inte är medlem i ett arbetsrum ser det inte alls i listan, även om
  de har ett giltigt konto och är inloggade.

**Om du redan skapat testarbetsrum innan inloggningen var på plats** (utan
inloggning räknas alla anrop som samma "okänd användare" och har ingen riktig
medlemskapsrad) — ge dig själv åtkomst till dem i efterhand med din riktiga
e-postadress (samma du registrerar kontot med):

```cmd
wrangler d1 execute risk_assessment_db --remote --command="INSERT INTO workspace_members (workspace_id, email, added_at) SELECT id, 'din-epost@dittbolag.se', datetime('now') FROM workspaces;"
```

Eller enklare: radera testarbetsrummen och skapa nya efter att du registrerat
ditt konto — då blir du automatiskt medlem.

## Lokal utveckling

```cmd
wrangler d1 execute risk_assessment_db --local --file=./migrations/schema.sql
wrangler pages dev . --d1=DB=risk_assessment_db
```

Öppna `http://localhost:8788`. Utan `JWT_SECRET` satt lokalt loggas ändringar
med `okänd användare` som utförare (och inloggning hoppas över helt) — det är
förväntat för snabb lokal utveckling.

## Funktioner

- Dashboard med KPI:er, 6 diagram, Top 10-risker, Quick Wins, prioriterade åtgärder
- Systeminventering med 5-stegs formulär och automatisk riskanalys (0–100 poäng)
- Riskanalys, beroenden/leverantörskedjor
- 5 rapporttyper, export till PDF/Excel/CSV/JSON
- Flera arbetsrum (ett per kunduppdrag), delad data i realtid mellan alla med åtkomst
- Riktig inloggning (e-post + lösenord, PBKDF2-hashat) med JWT-session, samma mönster som share-your-music
- All data i D1 (SQLite på Cloudflares edge), ingen data i webbläsarens LocalStorage
  förutom inloggningstoken och en pekare till "senast öppnade arbetsrum"
