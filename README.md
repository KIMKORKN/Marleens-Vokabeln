# Latein-Vokabeltrainer (Cursus)

Web-App zum Lernen lateinischer Vokabeln auf iPhone und iPad. Die Vokabeln werden per Foto aus dem Lehrbuch erfasst. Alle Daten bleiben auf dem Gerät.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die App (Oberfläche und Ablauf) |
| `parser.js` | Texterkennung auswerten, Antworten bewerten |
| `manifest.json`, `sw.js`, `icons/` | Installation auf dem Home-Bildschirm, Offline-Betrieb |

**Wichtig:** Die Datei `Lektion16_Import.json` gehört **nicht** ins Repository. Das Repository ist öffentlich, die Vokabeln stammen aus dem Lehrbuch.

## Veröffentlichen mit GitHub Pages

1. Auf github.com ein neues Repository anlegen, z. B. `Marleens-Vokabeln` (Public).
2. „Add file“ → „Upload files“ und alle Dateien aus dem ZIP hochladen, den Ordner `icons` mit seinen drei Bildern eingeschlossen.
3. „Settings“ → „Pages“ → Source: „Deploy from a branch“, Branch `main`, Ordner `/ (root)` → „Save“.
4. Nach ein bis zwei Minuten ist die App erreichbar unter `https://kimkorkn.github.io/Marleens-Vokabeln/`.

## Installation auf iPhone oder iPad

1. Die Adresse in **Safari** öffnen.
2. Teilen-Symbol → „Zum Home-Bildschirm“.
3. Die App startet dann im Vollbild wie eine normale App.

## Erste Schritte

1. Elternbereich öffnen und eine PIN festlegen.
2. Fürs Ausprobieren: Elternbereich → Verwalten → Importieren → `Lektion16_Import.json`.
3. Für neue Lektionen: „Seite fotografieren“, Lektionsnummer eintragen, Foto aufnehmen, Ergebnis prüfen und speichern.

## Datensicherung

Die Daten liegen im Speicher von Safari auf dem jeweiligen Gerät. iPhone und iPad haben getrennte Datenbestände. Über Elternbereich → Verwalten → Exportieren entsteht eine Sicherungsdatei, die sich auf dem anderen Gerät importieren lässt.
