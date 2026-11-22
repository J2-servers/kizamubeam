# Motor de montagem (kz-montagem/1)

A IA escreve uma especificacao de placas; este motor confere por codigo e constroi as pecas
com as ferramentas do proprio KizamuBeam. A precisao vem do sistema, nao da IA.

## Como rodar

```bash
node validar.mjs --teste                      # 5 casos embutidos: ok / FALHOU
node validar.mjs exemplos/caixa-aberta.json   # JSON com erros, avisos, placas, pares (sai 1 se houver erro)
node montar.mjs  exemplos/caixa-aberta.json   # constroi no app e grava em saida/
```

`montar.mjs` precisa do app aberto em `http://localhost:1421` (ou `KZ_URL`) e da biblioteca de
automacao (`KZ_LIB`, caminho `file:///.../app.mjs`; o padrao aponta para a pasta temporaria desta
sessao e some num reinicio). Grava em `saida/`: `<nome>-mesa.png`, `<nome>-3d.png`,
`<nome>-check.json` (check_design) e `<nome>-relatorio.json` (pecas, encaixes, medidas, linha da Vista 3D).

## Convencao da especificacao (o que a IA precisa saber)

- Eixos X largura, Y profundidade, Z altura, em mm. Cada placa e uma caixa cuja menor dimensao e a espessura.
- **Canto em L (dedos):** as duas placas vao ate a face de fora; o volume espessura x espessura fica em comum.
- **Topo em T (espiga):** a placa que entra atravessa a espessura inteira da outra e termina na face de fora dela.
- **Cruzamento em X (meia-madeira):** as duas passam uma pela outra.
- **Empilhadas:** mesmo eixo de espessura, face encostada em face (colado).
- Placa que so encosta de topo (sem volume em comum) vira aviso `de-topo` e fica colada, sem encaixe.
- Qualquer outro volume em comum e `colisao` (erro).

## O que funciona (rodado nesta maquina, 18/11/2026)

| Exemplo | Encaixes feitos | Vista 3D do app | Medida das pecas | check_design |
|---|---|---|---|---|
| caixa-aberta (5 placas) | 8 x dedos | Pecas: 5 (Conjuntos: 1), sem sobreposicoes | 5 de 5 exatas | 0 achados |
| prateleira (2 laterais + 3 tabuas) | 6 x espiga e furo | Pecas: 5 (Conjuntos: 1), sem sobreposicoes | 5 de 5 exatas; furos em 20..23 mm, como pedido | 0 achados |
| suporte (cruz) | 1 x meia-madeira, rasgos de 30 + 30 mm | Pecas: 2 (Conjuntos: 1), sem sobreposicoes | 2 de 2 exatas | 0 achados |

`validar.mjs` acusa, com o id das placas: espessura diferente, colisao (com a regiao em mm), placa solta,
id ou nome repetido, medida absurda, ligacao pedida que nao combina com o contato, parte movel de placa que nao existe.

## O que falta (nao foi feito)

- `recortes` e `moveis`: o validador le, o construtor **ignora**. Dobradica (`lidhinge`) nao esta ligada.
- Camadas empilhadas: sao classificadas, mas vao para a mesa sem pino de alinhamento e a Vista 3D nao as empilha.
- Meia-madeira fora do meio da aresta ou com placas de alturas diferentes: o construtor **recusa** e registra em `nao_feito`.
- Contato mais curto que a aresta (divisoria parcial): so aviso; dedos e furos se espalham pela aresta inteira.
- Canto de tres placas: na caixa saiu sem sobreposicao, mas nao foi provado para outros casos.
- Folga e largura do corte (`kerf`, `clearance`): ficam no padrao do app.
- Fotos: so um angulo (o padrao da Vista 3D). Nao ha ferramenta de agente para girar a camera nem para ler a colisao;
  a linha "Pecas / Conjuntos / Sobreposicoes" e lida da tela.
- Peca que nao cabe na mesa de 400 x 400: so aviso, nao abre outra pagina.
- `esquema.json` descreve o formato; `validar.mjs` faz as proprias conferencias e nao roda um validador de JSON Schema.

## Armadilhas das ferramentas de encaixe (medidas, nao supostas)

1. **Dedos:** usar `direction: "in"`. Assim a peca mantem a medida de fora (conferido: 120 x 80 continuou 120 x 80).
2. **Espiga sai da aresta.** O `tenon` soma 1 espessura: a tabua de 150 mm ficou com 156 mm. Correcao: o retangulo nasce
   1 espessura mais curto em cada ponta com espiga; a peca pronta fecha em 150 mm.
3. **Furo por linha solta engana.** Com uma linha de apoio como segunda aresta, os furos viram objeto separado, a placa
   continua macica e a Vista 3D acusa 6 sobreposicoes (1.620 mm3). O certo: segunda aresta = borda da propria placa,
   paralela ao encaixe, e `slotOffset` = distancia da borda ate o **meio** do furo. Os furos entram na placa.
4. **Meia-madeira (`lap`)** so abre o rasgo no centro da aresta escolhida, metade da altura em cada placa
   (`lapCount: 1`, `lapDepth: 50`). Primeira aresta = borda de cima de uma placa; segunda = borda de baixo da outra.
5. **Os numeros de aresta mudam.** Depois de um `make_joint` o objeto vira caminho e `sub/seg` mudam: chamar `list_edges`
   de novo antes de cada encaixe e achar a aresta pela coordenada (o segmento mais longo sobre a linha da borda).
6. **A Vista 3D mostra so a selecao.** Se o ultimo objeto criado estiver selecionado, ela pode abrir vazia:
   chamar `select` com `ids: []` antes de fotografar.
7. **A Vista 3D deita o conjunto do jeito dela** (a prateleira aparece de lado). A orientacao da foto nao e o Z da especificacao.
9. **Furos centrados no lugar errado.** O `tenon` centra os furos no MEIO da aresta de referencia e as espigas no meio
   da aresta da espiga. Se a placa que atravessa foi encurtada numa ponta so (a divisoria que tambem entra no fundo), os
   meios nao coincidem: 1,5 mm de erro e 4 sobreposicoes na caixa organizadora. O construtor agora empurra os furos novos
   pela diferenca (`furos_deslocados` no relatorio).
10. **A Vista 3D como dado:** o relatorio traz `vista3d_dados` (pecas, conjuntos, caixa de cada placa e cada colisao com
   as placas, o volume e a regiao em mm), e saem fotos `-3d-iso`, `-3d-topo` e `-3d-frente`.
8. **`check_design` nao enxerga o 3D:** deu 0 achados mesmo na rodada com 6 sobreposicoes. Quem pega isso e a Vista 3D
   e a conferencia de medidas do `montar.mjs` (`medidas` no relatorio).
