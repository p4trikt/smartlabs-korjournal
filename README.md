# Körjournal – fleranvändarversion (v2)

Installerbar webbapp (PWA) med central databas i Supabase (projekt "SmartLabs Backend", tabeller med prefix kj_).

## Roller
- Förare: registrerar sig själv, väntar på godkännande, loggar och ser sina egna resor. Kan redigera egna resor men inte ta bort.
- Admin: godkänner/spärrar förare, hanterar fordon, ser alla resor, tar ut rapport (PDF via utskrift, CSV för Excel), kan redigera och ta bort resor.

## Skydd i databasen
- RLS (radnivåsäkerhet) styr vem som ser vad – gäller även om någon manipulerar appen.
- Överlappande mätarställningar på samma fordon stoppas.
- Tjänsteresa kräver ärende.

## Filer
- js/config.js – Supabase-adress och publik nyckel
- js/api.js – alla databasanrop + offline-kö
- js/app.js – vyer
- sw.js – offline-cache, höj VERSION vid uppdatering
- logs/ – CSV-loggar över ändringar
- _karantan/ – gamla filer

## Köra lokalt
    python -m http.server 8080
Öppna http://localhost:8080

## Publicera
Lägg mappen på valfri HTTPS-värd (Netlify, hemmaservern med domän).
Lägg in adressen i Supabase: Authentication > URL Configuration > Site URL och Redirect URLs.
