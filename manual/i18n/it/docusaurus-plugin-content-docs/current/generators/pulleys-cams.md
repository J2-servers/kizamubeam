---
sidebar_position: 2
title: Pulegge e camme
description: Pulegge dentate per cinghie GT2 e HTD e camme a disco con legge di moto e cedente a scelta.
---

# Pulegge e camme

Entrambi i generatori si trovano in **Casella degli strumenti → Meccanica**.

## Puleggia dentata

Una **Puleggia** per cinghie dentate, con il diametro esterno calcolato dal passo e dalla distanza della linea primitiva della cinghia.

![Finestra di creazione della puleggia: profilo della cinghia GT2 2 mm, 36 denti, gioco delle gole, kerf e un alesaggio per albero a D; l’anteprima mostra la puleggia con le sue gole rotonde e, sotto, il diametro esterno, il diametro primitivo e l’avanzamento della cinghia per giro](/img/pulley-dialog-en.webp)

| Campo | Significato |
|---|---|
| **Profilo cinghia** | GT2 (passo 2, 3 o 5 mm) oppure HTD (3M, 5M). |
| **Numero di denti** | Da 8 a 400. |
| **Gioco della scanalatura** | Allarga ogni scanalatura perché la cinghia entri facilmente (i valori negativi la stringono). |
| **Kerf** | Larghezza del taglio laser. |
| **Alesaggio** | Nessuno, arrotondato, albero a D o con cava per linguetta, come per gli ingranaggi. |

Le scanalature sono arrotondate, con la profondità e la larghezza usuali per il profilo. Di solito una puleggia si taglia da più strati incollati insieme, con un disco più grande su ogni lato come flangia.

## Camma a disco

Una **Camma** trasforma la rotazione in un moto di sollevamento di un cedente: per automi, giocattoli e meccanismi semplici. Un giro si divide in salita, sosta in alto, ritorno e sosta in basso.

![Finestra di creazione della camma: raggio del cerchio di base 22 mm, alzata 10 mm, angolo di salita 110°, sosta in alto 40°, angolo di ritorno 110°, la legge di moto cicloidale e un cedente a rullo; l’anteprima mostra la camma e, sotto, il raggio massimo, l’angolo di pressione massimo e la sosta in basso](/img/cam-dialog-en.webp)

| Campo | Significato |
|---|---|
| **Raggio del cerchio di base** | Raggio minimo della camma: qui il cedente è nel punto più basso. |
| **Alzata** | Quanto sale il cedente. |
| **Angolo di salita** | Rotazione durante la quale il cedente sale. |
| **Sosta in alto** | Rotazione durante la quale resta in alto. |
| **Angolo di ritorno** | Rotazione durante la quale ridiscende. Il resto del giro è la sosta in basso. |
| **Legge di moto** | **Cicloidale (basso jerk)**, **Polinomiale di quinto grado** o **Armonica**. La cicloidale è la più dolce. |
| **Cedente** | **Rullo** (con **Diametro del rullo**) oppure **Punta a coltello**. |
| **Kerf** | Larghezza del taglio laser. |
| **Alesaggio** | Come per gli ingranaggi. |

La finestra controlla l’angolo di pressione e la dimensione del rullo: se la camma è troppo ripida per il cedente, o il rullo troppo grande per una cavità della camma, compare un avviso. Aiutano un cerchio di base più grande o un angolo di salita più lungo.
