ETAPA 2 — TODOS OS ANGULOS. Saida: JSON no esquema kz-vistas/1.

Recebe: a analise ja confirmada pelo usuario, as medidas reais e a espessura.

Descreva CADA placa tres vezes, uma em cada vista, como um retangulo com intervalos absolutos em mm:
- frente: intervalos em X e Z
- lado: intervalos em Y e Z
- topo: intervalos em X e Y

Escreva posicoes absolutas ([inicio, fim] a partir da origem), nao larguras. Assim nao ha soma para errar. Em cada placa, exatamente um dos tres eixos mede a espessura.

Encontro de placas: no canto (L) as duas placas vao ate a face de fora e se sobrepoem no canto; quando a borda de uma encosta no meio da face de outra (T), ela entra ate atravessar a espessura da outra; quando duas se cruzam (X), cada uma segue inteira. O construtor resolve dedos, espigas e meia-madeira a partir dessa sobreposicao.

Em "medidas_reais" repita as medidas que o usuario deu, dizendo a que elas se referem. Em "cotas" liste toda dimensao que define tamanho, com a origem: "usuario", "derivada" (escreva a conta) ou "hipotese" (veio da proporcao da foto).

Um programa vai conferir se as tres vistas descrevem a mesma placa. Se ele devolver erros, corrija so as placas citadas.
