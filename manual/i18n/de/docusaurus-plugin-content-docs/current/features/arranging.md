---
sidebar_position: 9
title: Anordnen und vervielfältigen
description: Raster- und Kreisarrays, Verschachteln zum Materialsparen und nahtlose Musterfüllungen.
---

# Anordnen und vervielfältigen

## Ausrichten und verteilen

Bei mehreren ausgewählten Objekten richtet die Ausrichten-Gruppe in der Hauptleiste (und **Anordnen → Ausrichten und verteilen**) Kanten oder Mitten aus und verteilt Objekte gleichmäßig. Per Tastatur: **L R T B** für links, rechts, oben, unten, **C** und **E** für die Mitten.

![Vier unterschiedlich hohe Namensschilder, unten ausgerichtet und gleichmäßig verteilt, dazu die geöffnete Ausrichten-Gruppe in der Hauptleiste](/img/align-distribute-de.webp)

## Arrays

**Werkzeuge → Array** erzeugt viele Kopien auf einmal, mit Live-Vorschau. Bézierkurven werden exakt kopiert.

- **Rasterarray …** (Ctrl+Shift+A): Spalten und Zeilen, mit dem Abstand zwischen den Kopien oder dem Abstand ihrer Mitten, Richtung, einem Versatz für jede zweite Zeile oder Spalte (für ein Ziegelmuster) und wahlweise gespiegelter jeder zweiter Zeile oder Spalte.
- **Kreisarray …**: Kopien im Kreis um einen Mittelpunkt.

![Dialog Rasterarray mit 4 Spalten, 3 Zeilen und 6 mm Abstand; die Arbeitsfläche zeigt die Kopien eines Schlüsselanhängers als Vorschau](/img/grid-array-dialog-de.webp)

![Dialog Kreisarray mit 12 Kopien um einen Mittelpunkt; die Arbeitsfläche zeigt ein Blatt, das im Kreis wiederholt wird](/img/circular-array-dialog-de.webp)

## Verschachteln

**Anordnen → Verschachteln …** (auch im Werkzeugkasten) ordnet die ausgewählten Teile nach ihren echten Umrissen an, nicht nur nach ihren Begrenzungsrahmen, um Material zu sparen.

![Dialog Verschachteln mit Abstand, Drehung, Startecke und Genauigkeit; sechzehn Teile liegen dicht gepackt in der linken unteren Ecke des Arbeitsbereichs](/img/nesting-dialog-de.webp)

**Wohin:**

- in den Arbeitsbereich,
- auf eine Materialgröße (Breite × Höhe an einer Position) oder
- in eine ausgewählte Form als Platte, etwa den Umriss eines Reststücks.

**Einstellungen:**

- **Abstand** zwischen den Teilen und zum Rand (Schnittbreite einrechnen).
- **Drehung**: keine, nur 180° oder in Schritten von 90°, 45°, 15° oder 5°.
- Die Ecke, in der begonnen wird.
- **Genauigkeit**: schnell, normal oder gründlich. Normal und gründlich probieren mehrere Reihenfolgen und behalten die beste — und rechnen mit einem feineren Raster.

Die Teile werden auf einem Raster gepackt, und auf einer großen Platte ist das Raster gröber. Damit der gewünschte Abstand sicher eingehalten wird, wächst jedes Teil vorher um eine halbe Zelldiagonale — der wirkliche Abstand ist also **Abstand + Zelle × 1,41**. Der Dialog sagt, was das auf der gewählten Fläche ergibt; mit **Gründlich** oder auf einer kleineren Fläche wird das Raster feiner.

Kleine Teile können in Löcher größerer Teile wandern, und andere Objekte auf der Seite werden umgangen. Was nicht passt, kommt auf neue Seiten. Was zusammengehört, bewegt sich gemeinsam: als eigene Formen gezeichnete Löcher, Gravuren und Text auf einem Teil, Generator-Baugruppen. Verschachteln ist ein Rückgängig-Schritt.

**Reststück zeichnen** hält fest, was von der Platte übrig bleibt: Nach dem Verschachteln wird das restliche Material als geschlossener Umriss auf den Werkzeug-Layer T1 gelegt, der nie gelasert wird. **Kleinstes Reststück** wirft alles Schmalere weg, damit keine Splitter die Seite vollstellen; mit 0 bleibt jeder. Jedes Teil beansprucht den halben Teileabstand um sich herum, der Umriss ist also immer etwas kleiner als der wirkliche Rest, nie größer. Beim nächsten Mal diesen Umriss auswählen und mit **Gewählte Form (Reststück)** daraufsetzen — so wird eine Platte über mehrere Aufträge hinweg aufgebraucht.

## Muster füllen

**Werkzeugkasten → Vervielfältigen und Anordnen → Muster füllen** füllt eine geschlossene Form mit einem nahtlosen Muster aus echten Vektoren, um Flächen zu verzieren.

![Dialog Muster füllen mit dem Wabenmuster und seinen Wiederholungs-Einstellungen; auf der Arbeitsfläche ist eine Platte mit Waben gefüllt, der Schriftzug in der Mitte bleibt frei](/img/pattern-fill-dialog-de.webp)

1. Wähle die Zielform aus.
2. Wähle eine Kachel: eines von 13 eingebauten Mustern (Waben, Schuppen, Wellen, Truchet, Ringe, Rauten, Fischgrät, Korbgeflecht, Sterne, Punkte, Kreisraster, Chevron, Ogee), ein gespeichertes Muster oder eigene Objekte (ein Rechteck um sie herum legt den Kachelrahmen fest).
3. Wähle, wie sich die Kacheln wiederholen: Raster, Ziegel, halb versetzt, gespiegelt, um 90° gedreht (Windrad) oder sechseckig, mit Versatz, Abstand (negativ = Überlappung), Größe, Drehung und Verschiebung.

Am Rand wird das Muster exakt abgeschnitten, oder es bleiben nur ganze Kacheln; ein Rand hält die Kontur frei, und Text, Bilder und Codes auf der Form werden automatisch ausgespart. Linien, an denen Kacheln zusammenstoßen, werden bereinigt, damit nichts doppelt gelasert wird. **Kanten umbrechen** lässt Linien, die die Kachel verlassen, in der Nachbarkachel weiterlaufen.

Das Ergebnis können Linien sein (zum Gravieren, Ritzen oder Schneiden) oder Flächen für Füll-Layer. Das Muster bleibt ein Objekt: Ein Doppelklick ändert jede Einstellung. **Als Muster speichern** legt Kachel und Einstellungen in der Bibliothek ab.
