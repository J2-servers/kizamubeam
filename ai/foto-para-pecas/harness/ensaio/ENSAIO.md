# Ensaio a seco — caixa organizadora com divisoria

ISTO E UM ENSAIO MEU (Claude Fable 5.2, o agente que escreveu o harness). NAO e execucao pela API e NAO houve foto: o objeto foi descrito em texto. Serve para provar o formato e o conferidor, nao a leitura de imagem.

## Objeto imaginado
Caixa aberta em cima, com uma divisoria no meio. O usuario informou: largura por fora 200 mm e chapa de 3 mm.

## Etapa 1 (compreender), em resumo
Rota `placas`. Seis placas: fundo, frente, tras, lateral esquerda, lateral direita, divisoria. Simetrica em X. Sem parte movel. Oculto: nada relevante (caixa aberta).

## Etapa 2 (vistas)
`caixa-organizadora.vistas.json`, escrito por mim a mao. Passou em `conferir-vistas.mjs`.

O que o harness de verdade faria AQUI e eu nao pude fazer: a profundidade (120) e a altura (60) estao marcadas como `hipotese`, porque o usuario so deu a largura. O harness pararia e perguntaria antes de seguir.

## Etapa 3 (especificar)
`caixa-organizadora.kz-montagem.json`. Os numeros das placas NAO foram digitados: sairam do conferidor por codigo, como o harness manda. Eu so pus nomes, `ligacoes: "auto"` e `moveis: []`.

## O que NAO foi feito no ensaio
- Nao passei a especificacao pelo construtor do Agente A (etapa 4), entao nao sei se a convencao de canto sobreposto e a que ele espera.
- Nao houve 3D nem comparacao com foto (etapa 5).
