---
sidebar_position: 9
title: Disporre e ripetere
description: Array a griglia e circolari, nesting per risparmiare materiale e riempimenti con motivi senza giunture.
---

# Disporre e ripetere

## Allineare e distribuire

Con più oggetti selezionati, il gruppo di pulsanti di allineamento nella barra principale (e **Disponi → Allinea e distribuisci**) allinea bordi o centri e distribuisce gli oggetti in modo uniforme. Da tastiera: **L R T B** per sinistra, destra, alto, basso, **C** ed **E** per i centri.

![Quattro targhette di altezza diversa allineate in basso e distribuite in modo uniforme, con il gruppo di pulsanti di allineamento aperto nella barra principale](/img/align-distribute-en.webp)

## Array

**Strumenti → Array** crea molte copie in una volta, con anteprima dal vivo. Le curve di Bézier vengono copiate esattamente.

- **Array a griglia …** (Ctrl+Maiusc+A): colonne e righe, con lo spazio tra le copie o la distanza tra i loro centri, direzione, uno sfalsamento per ogni seconda riga o colonna (per una disposizione a mattoni) e la specchiatura facoltativa di ogni seconda riga o colonna.
- **Array circolare …**: copie in cerchio intorno a un centro.

![Finestra Array a griglia con 4 colonne, 3 righe e 6 mm di distanza; l’area di lavoro mostra in anteprima le copie di un portachiavi](/img/grid-array-dialog-en.webp)

![Finestra Array circolare con 12 copie intorno a un centro; l’area di lavoro mostra in anteprima una foglia ripetuta in cerchio](/img/circular-array-dialog-en.webp)

## Nesting

**Disponi → Nesting …** (anche nella Casella degli strumenti) dispone i pezzi selezionati secondo i loro contorni reali, non solo i riquadri di delimitazione, per risparmiare materiale.

![Finestra Nesting con distanza, rotazione, angolo di partenza e precisione; sedici pezzi sono disposti fitti nell’angolo in basso a sinistra dell’area di lavoro](/img/nesting-dialog-en.webp)

**Dove:**

- nell’area di lavoro,
- su una dimensione di materiale (larghezza × altezza in una posizione), oppure
- in una forma selezionata come lastra, per esempio il contorno di un ritaglio.

**Impostazioni:**

- **Distanza** tra i pezzi e dal bordo (considera la larghezza di taglio).
- **Rotazione**: nessuna, solo 180° o a passi di 90°, 45°, 15° o 5°.
- L’angolo da cui iniziare.
- **Precisione**: veloce, normale o accurata. Normale e accurata provano più ordini e tengono il migliore — e lavorano su una griglia più fine.

I pezzi vengono disposti su una griglia, e su una lastra grande la griglia è più grossolana. Perché la distanza richiesta sia garantita, ogni pezzo cresce prima di mezza diagonale di cella: la distanza reale è quindi **distanza + cella × 1,41**. La finestra dice quanto diventa sulla superficie scelta; con **Approfondita**, o su una superficie minore, la griglia diventa più fine.

I pezzi piccoli possono finire nei fori di quelli grandi, e gli altri oggetti sulla pagina vengono evitati. Ciò che non ci sta va su nuove pagine. Ciò che va insieme si sposta insieme: fori disegnati come forme separate, incisioni e testo su un pezzo, assiemi dei generatori. Il nesting è un passo di annullamento.

**Disegnare il ritaglio** conserva ciò che resta della lastra: dopo il nesting il materiale rimasto viene disegnato come contorno chiuso sul livello strumento T1, che non viene mai inciso. **Ritaglio più piccolo** scarta tutto ciò che è più stretto, così le schegge non riempiono la pagina; con 0 restano tutte. Ogni pezzo occupa metà della distanza tra i pezzi attorno a sé, quindi il contorno è sempre un po’ più piccolo del resto reale, mai più grande. La volta dopo si seleziona quel contorno e ci si annida sopra con **Forma selezionata (ritaglio)** — così una lastra si consuma nell’arco di più lavori.

## Riempimento con motivo

**Casella degli strumenti → Copia e disponi → Riempi con motivo** riempie una forma chiusa con un motivo senza giunture fatto di vettori reali, per decorare superfici.

![Finestra Riempi con motivo con il motivo a nido d’ape e le impostazioni di ripetizione; sull’area di lavoro una piastra è riempita di esagoni, la scritta al centro resta libera](/img/pattern-fill-dialog-en.webp)

1. Seleziona la forma di destinazione.
2. Scegli una tessera: uno dei 13 motivi integrati (nido d’ape, squame, onde, Truchet, anelli, rombi, spina di pesce, intreccio, stelle, punti, griglia di cerchi, chevron, ogiva), un motivo salvato o i tuoi oggetti (un rettangolo intorno a essi definisce la cornice della tessera).
3. Scegli come si ripetono le tessere: griglia, mattoni, mezzo sfalsamento, specchiato, ruotato di 90° (girandola) o esagonale, con sfalsamento, distanza (negativa = sovrapposizione), dimensione, rotazione e spostamento.

Sul bordo il motivo viene tagliato esattamente, oppure restano solo tessere intere; un margine lascia libero il contorno, e testo, immagini e codici sulla forma vengono risparmiati automaticamente. Le linee dove le tessere si incontrano vengono ripulite, così nulla viene lavorato due volte. **Bordi continui** fa proseguire nella tessera vicina le linee che escono dalla tessera.

Il risultato può essere fatto di linee (da incidere, marcare o tagliare) o di aree per livelli di riempimento. Il motivo resta un unico oggetto: un doppio clic modifica qualsiasi impostazione. **Salva come motivo** salva tessera e impostazioni nella libreria.
