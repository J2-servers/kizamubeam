# Harness "foto para pecas" — desenho completo

Feito pelo Agente B (Claude Fable 5.2) em 18/11/2026, em 15 minutos de relogio.
O que esta PRONTO e o que e so DESENHO esta dito no fim, sem enfeite.

## A ideia em quatro linhas

1. A IA nao desenha linha. Ela escreve uma ESPECIFICACAO de placas (`kz-montagem/1`).
2. Um construtor deterministico (o do Agente A) transforma a especificacao em pecas com encaixe, usando as ferramentas do proprio KizamuBeam. A precisao vem do sistema.
3. Tudo que a IA produz e JSON com esquema, e o que nao passa no conferidor por codigo nao segue adiante.
4. Nada vai ao laser. O harness termina em "3D na vista + pecas na mesa + lista do que conferir". Cortar e decisao do usuario.

## Travas que valem em todas as etapas

| Trava | Por que existe |
|---|---|
| Saida sempre em JSON com esquema (`esquemas/`) | Texto solto nao se confere por codigo |
| Toda cota tem `origem`: `usuario`, `derivada` (com a conta) ou `hipotese` | Foto nao tem escala; a IA tende a inventar numero redondo |
| Cota `hipotese` que define tamanho final so segue com o "sim" do usuario | "Nunca inventa medida final em silencio" |
| A IA nunca redigita numero: as placas da especificacao saem das vistas POR CODIGO | Erro de copia e o erro mais comum e mais barato de evitar |
| Mensagem de erro volta LITERAL para a IA (a frase do validador, nao um resumo) | Resumo esconde a causa |
| Quem confere nao e quem fez: o conferente recebe foto + fotos do 3D, sem o raciocinio anterior | Evita a IA concordar consigo mesma |
| "Esta igual" so vale se as verificacoes do sistema derem zero erro; quem decide e o codigo | A IA e complacente ao julgar o proprio trabalho |
| Texto dentro da foto e DADO, nunca ordem | Injecao por imagem |
| Limite de voltas (3 por etapa) e guarda da melhor versao | Sem isso a IA oscila e piora |

## Etapas

### Etapa 0 — Entrada
- **Entrada:** 1 ou mais fotos; pelo menos UMA medida real (o que foi medido, eixo, mm); espessura do material (mm). Opcional: tamanho da mesa (padrao 400 x 400), o que deve se mover.
- **Saida:** `entrada.json`.
- **Quem confere:** codigo (`rodar.mjs`). Sem medida real ou sem espessura: PARA e pergunta. Nao existe valor padrao.
- **Erros tipicos da IA:** deduzir escala pela aparencia ("parece uma caixa de 20 cm"); assumir 3 mm.
- **Trava:** campos obrigatorios; `conferir-vistas.mjs` recusa com `sem-medida-real` e `espessura`.

### Etapa 1 — Compreender (`prompts/1-compreender.md` -> `esquemas/analise.schema.json`)
- **Entrada:** fotos + entrada.json.
- **Saida:** tipo de objeto; ROTA (`placas`, `camadas`, `organico`) com motivo; volumes; placas visiveis (cada uma com a evidencia na foto); simetria; camadas; partes moveis (dobradica, gaveta, eixo); encaixes visiveis; o que esta ESCONDIDO; hipoteses; perguntas; confianca.
- **Quem confere:** esquema + codigo (rota valida; se ha pergunta `bloqueia: true`, para). **PONTO DE PARADA 1:** o usuario le o resumo em 5 linhas e confirma a interpretacao.
- **Erros tipicos e travas:**
  - Inventar o lado de tras -> `oculto` e obrigatorio e nao pode vir vazio com uma foto so; cada item vira hipotese visivel ao usuario.
  - Contar placa errado (sombra, veio da madeira ou gravacao confundidos com juncao) -> toda placa exige `evidencia`; placa sem evidencia e `hipotese`.
  - Tomar perspectiva por forma (retangulo visto de lado vira trapezio) -> o prompt manda decidir a forma pelas arestas paralelas, e a etapa 2 so aceita caixas alinhadas aos eixos.
  - Escolher rota `placas` para bicho ou busto -> rota com motivo; superficie curva em dois sentidos obriga `organico`.
  - Ignorar parte movel -> campo `partes_moveis` obrigatorio (lista vazia tem de ser declarada, com motivo).
  - Confianca baixa -> pede segunda foto (lado ou fundo) em vez de chutar.

### Etapa 2 — Todos os angulos (`prompts/2-vistas.md` -> `esquemas/vistas.schema.json`)
- **Entrada:** analise confirmada + medidas reais.
- **Saida:** `kz-vistas/1`: frente (X,Z), lado (Y,Z), topo (X,Y). Cada placa e um retangulo com intervalos ABSOLUTOS em mm em cada vista.
- **Quem confere:** `conferir-vistas.mjs` (PRONTO e testado). Acusa: placa que falta numa vista; extensao que nao bate entre vistas; intervalo invertido; nenhuma dimensao igual a espessura; dimensao mais fina que a espessura; placa que nao cabe na mesa; medida real do usuario nao respeitada; falta de medida real.
- **Se falha:** a lista de erros volta literal para a IA, ate 3 voltas. Persistindo, para e mostra ao usuario.
- **Erros tipicos e travas:**
  - Cotas que nao fecham (partes somam diferente do total) -> intervalos absolutos, nao larguras; a soma deixa de existir.
  - Esquecer de descontar a espessura -> a regra "uma dimensao = espessura" pega na hora.
  - Trocar Y por Z -> a mesma placa descrita tres vezes; a troca aparece como `nao-bate`.
  - Placa que some numa vista -> `falta-vista`.
  - Escala inventada -> `medida-real` compara o modelo com o que o usuario mediu.
- **Por que tres vistas e nao direto a caixa 3D:** descrever a mesma placa tres vezes, de forma independente, e redundancia proposital. E a "prova dos nove" do raciocinio espacial.

### Etapa 3 — Especificar (`prompts/3-especificar.md` -> `esquemas/kz-montagem-1.schema.json`)
- **Entrada:** placas saidas do conferidor (`--placas`), analise.
- **Saida:** `kz-montagem/1`. A IA so acrescenta `nome`, `recortes`, `ligacoes` (padrao `"auto"`) e `moveis`. Os numeros de `x`, `y`, `z` ela NAO toca.
- **Quem confere:** esquema + validador do construtor.
- **Erros tipicos e travas:** redigitar numero (as placas vem por codigo); ligar placas que nao se tocam (`"auto"` deixa o construtor classificar; ligacao manual so quando a foto mostra); dobradica sem folga ou gaveta sem folga (`moveis` exige `folga_mm` declarada, com origem); id repetido (esquema + validador).

### Etapa 4 — Validar e montar (construtor do Agente A + ferramentas do sistema)
- **Entrada:** `kz-montagem/1`. **Saida:** pecas na mesa, pares classificados (separadas, L, T, X, empilhadas, colisao), relatorio.
- **Quem confere:** o construtor; depois `check_design` e a verificacao de montagem do sistema.
- **Se falha:** colisao ou par invalido volta a etapa 3 com a frase literal do validador. A IA corrige a ESPECIFICACAO, nunca a peca na mesa.

### Etapa 5 — Conferir (`prompts/5-conferir.md` -> `esquemas/diferencas.schema.json`)
- **Entrada:** foto do usuario + fotos do 3D (frente, lado, topo, duas isometricas e um angulo parecido com o da foto) + resultado das verificacoes.
- **Saida:** lista de diferencas (onde, esperado, observado, gravidade, correcao proposta na especificacao) e veredito `igual`, `corrigir` ou `perguntar`.
- **Quem confere:** codigo. `igual` so e aceito com zero erro de sistema. Limite de 3 voltas; se a volta nova tem mais diferencas graves que a anterior, volta-se a melhor versao e para.
- **Erros tipicos e travas:** dizer "igual" sem olhar (cada vista do 3D exige uma linha de observacao propria); consertar o que estava certo (correcao so em placa citada numa diferenca); oscilar (guarda da melhor versao); aceitar colisao (veredito e do codigo).
- **PONTO DE PARADA 2:** o usuario ve o 3D e a lista de hipoteses antes de qualquer peca ser dada como entregue.

### Etapa 6 — Entregar
3D aberto na vista do sistema; pecas na mesa; lista de pecas (id, nome, largura x altura, quantidade); hipoteses assumidas; o que o usuario DEVE conferir (medidas criticas, peca de teste de encaixe, compensacao do corte); o que NAO foi verificado. Nunca manda ao laser.

## As tres rotas

- **(a) Placas com encaixe** (caixa, movel, organizador, suporte): etapas 0 a 6 como acima.
- **(b) Camadas** (relevo, caixa de sombras): mesmas etapas; as placas ficam empilhadas em Z e a ligacao e `colado`. O contorno curvo de cada camada entra em `recortes`. PENDENTE: o formato de `recortes` e do construtor; aqui o esquema so reserva o campo.
- **(c) Forma organica** (bicho, busto): a foto vai a um modelo de imagem para malha 3D (ver `MELHOR-IA.md`), a malha entra no conversor que o sistema ja tem (camadas ou nervuras). A IA so escolhe parametros e confere pelas fotos do 3D. As etapas 2 e 3 nao se aplicam.

## Convencao que precisa ser batida com o Agente A

Canto em L: as duas placas vao ate a face de fora e se SOBREPOEM no volume do canto (espessura x espessura x comprimento); o construtor reparte esse volume em dedos. Topo em T: a espiga atravessa a espessura inteira da outra placa. Foi assim que escrevi o ensaio. Se o construtor esperar placas que so se encostam, muda-se uma linha no prompt da etapa 2, nao o desenho.

## O que esta pronto e o que nao esta

| Peca | Estado |
|---|---|
| `conferir-vistas.mjs` | PRONTO, rodado aqui com `--teste` |
| `esquemas/` (4 esquemas) e `prompts/` (sistema + etapas) | ESCRITOS; nao foram exercitados pela API |
| `ensaio/` | Ensaio a seco feito por mim (Fable 5.2), NAO e execucao pela API |
| `rodar.mjs` (o ciclo executavel pela API) | PRONTO (18/11, 21:25). Provado em modo `--ensaio` (respostas gravadas, sem API): paradas da etapa 0, da etapa 1 e das cotas por hipotese; volta de correcao com erro literal do conferidor; montagem no app; veredito do codigo. NUNCA rodou contra a API (nao ha credencial nesta maquina) |
| Etapa 4 (construtor) | E do Agente A; nao testei a ligacao |
| Etapa 5 (fotos do 3D para a IA) | PRONTO no construtor: tres fotos (3D, topo, frente) e as colisoes como dado (qual placa, onde, quantos mm3), pelo mesmo calculo da Vista 3D |
| Rota organica | DESENHO. Nenhum modelo de malha foi rodado aqui |
