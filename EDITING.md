# hackops.tech bearbeiten

Die Seite ist eine einzige HTML-Datei plus Stylesheet. Kein Build, kein Framework:
Wer speichert, veroeffentlicht. Nach jedem Commit auf `main` ist die Aenderung
nach ca. 1 Minute live auf https://hackops.tech.

## So geht's (ohne Git-Kenntnisse)

1. Auf github.com einloggen (ihr braucht eine Einladung in die Organisation).
2. Die Datei [index.html](index.html) oeffnen und oben rechts auf den Stift klicken.
3. Text aendern (siehe unten, wo was steht).
4. Unten "Commit changes" klicken. Fertig. Nach ca. 1 Minute live.

## Wo steht was in index.html

Alle Inhalte stehen in `index.html` zwischen `<div id="world">` und `</div>`.
Jeder Block hat einen Kommentar als Ueberschrift:

| Abschnitt | Suchen nach | Was man aendert |
|---|---|---|
| Startseite | `01 HOME` | Titel, Slogan, die "hack//ops runs ..." Liste |
| Easter Egg | `02 MICROPRINT` | Der Mini-Text, den man nur mit Zoom findet |
| Manifest | `03 MANIFESTO` | Unser Selbstverstaendnis + die vier Regeln |
| Events | `04 OPERATIONS` | Die vier Event-Fenster (Text, Status, Poster) |
| Team | `05 CREW` | Namen und Rollen |
| Deko | `desktop decoration` | Fake-Fenster, Icons, Spielereien |

### Typische Aenderungen

**Event-Status aendern** (z.B. Datum bekannt geben): im jeweiligen Event-Fenster die Zeile

```html
<span class="status live">first up · summer 2026</span>
```

anpassen. `class="status live"` = farbig hervorgehoben, `class="status"` = grau.

**Neues Crew-Mitglied**: im `05 CREW` Block eine Zeile kopieren und anpassen:

```html
<div><span class="nm">vorname nachname</span><span class="rl">core team</span></div>
```

**Neues Poster/Bild**: Datei in den Ordner `assets/` hochladen (im GitHub-Ordner
`assets` auf "Add file > Upload files"), dann im Event-Fenster den `src` anpassen.

## Regeln

- Alles klein schreiben (lowercase ist Teil des Designs).
- Keine Gedankenstriche, keine Emojis.
- Sponsoren erst nennen, wenn der Deal fix ist.
- Farben nur ueber die Variablen (`var(--pink)`, `var(--purple)`, `var(--sky)`,
  `var(--silver)`, `var(--red)`, `var(--gold)`).

## Fuer Fortgeschrittene

- Optik/Farben: [site.css](site.css) (Variablen ganz oben)
- Kamera/Engine: [engine.js](engine.js) (Flug-Geschwindigkeiten in `frame()`)
- Neue Kamera-Stops: ein Element mit `data-stop`, `data-x/y`, `data-vw/vh`
  bekommt automatisch einen Chip in der Navigation. Reihenfolge im Dokument =
  Reihenfolge der Tour.
- Lokal testen: Repo klonen und `pwsh serve.ps1` starten, dann http://localhost:8321
