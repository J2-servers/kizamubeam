ETAPA 4 — CENA E ACABAMENTO. Saida: JSON no esquema kz-cena/1.

Recebe: a foto, as placas da estrutura ja conferidas (id, x, y, z em mm) e a analise.

A estrutura (caixa, moldura, prateleiras, divisorias) ja esta pronta. Agora descreva TUDO o que falta para o produto ficar igual a foto, peca por peca:

1. "recortes": janelas e aberturas nas placas da estrutura (por exemplo a janela da moldura da frente). Cada um: placa, forma "retangulo", os dois eixos da face da placa em mm ([inicio, fim]) e "raio" do canto.
2. "gravuras": textos gravados nas placas da estrutura. Cada um: placa, texto EXATO como na foto (acentos, maiusculas), centro na face da placa (os dois eixos dela) e altura da letra em mm.
3. "cena": as pecas decorativas coladas em camadas sobre a face de DENTRO de uma placa ("sobre": id da placa, normalmente o fundo). As camadas vao do fundo para a frente (a primeira encosta na placa). Pecas na mesma profundidade ficam na mesma camada. Cada camada: nome, cor (#rrggbb, a cor da pintura na foto) e pecas.
   Cada peca:
   - id, nome, o_que (descricao curta do que e, como aparece na foto)
   - caixa: retangulo que a peca ocupa NA FACE da placa, nos dois eixos dela, em mm, medido na foto pela escala da estrutura
   - fonte, uma destas, nesta preferencia:
     - {"tipo":"forma","forma":"retangulo"|"circulo"|"placa_seta"|"placa_seta_esquerda"|"moldura","raio":mm,"borda":mm} para formas geometricas (placas de texto, placas de direcao, molduras);
     - {"tipo":"biblioteca","id":"..."} se um motivo pronto da lista abaixo for a mesma coisa (aviao, palmeira, nuvem, veleiro, coracao...);
     - {"tipo":"web","busca":"termos em INGLES para achar um SVG livre no Wikimedia Commons"} para o que tem forma real conhecida (mapa de um pais com os estados, monumento);
     - {"tipo":"desenho"} para o que nenhum dos outros resolve: o programa vai pedir o desenho a uma IA.
   - "busca": termos em ingles para a internet, mesmo quando a fonte e outra. Se a peca nao ficar parecida, o programa busca la.
   - "gravuras" opcionais na peca: texto exato, altura em mm e "largura_max" em mm (o texto encolhe para caber); o centro e o meio da caixa, a nao ser que voce de "centro".

Regras:
- Use a escala da estrutura: as placas ja tem as medidas reais. Uma peca que na foto ocupa metade da largura interna tem metade da largura interna aqui.
- Uma peca por objeto que se ve na foto. Um mapa com estados coloridos em cima de uma base: duas camadas (a base e os estados).
- Nada pode sair da face da placa. Nada da cena pode ficar mais fundo que o espaco livre entre a placa e a frente.
- Texto que aparece na foto e gravura, nao peca.

Motivos prontos da biblioteca (id):
{BIBLIOTECA}
