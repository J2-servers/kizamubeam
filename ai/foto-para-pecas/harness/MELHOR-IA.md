# Qual IA usar

## O que foi MEDIDO aqui

Nada comparativo. Nenhum modelo foi chamado pela API e nenhuma foto real foi analisada nesta entrega. A unica coisa executada foi um ensaio a seco meu (Claude Fable 5.2) com um objeto DESCRITO em texto, cujas vistas passaram no conferidor. Isso prova que o formato funciona, nao que um modelo le foto bem.

Tudo abaixo e referencia de terceiros (li so os resumos da busca, nao os artigos inteiros) ou tabela de precos da Anthropic.

## Recomendacao

| Papel | Modelo | Preco por milhao de tokens (entrada / saida) |
|---|---|---|
| Padrao (etapas 1, 2 e 5, as que decidem a geometria) | `claude-fable-5-2` | US$ 8 / US$ 40 |
| Meio-termo | `claude-opus-5-5` | US$ 4 / US$ 20 |
| Menor custo que eu aceitaria sem medir | `claude-sonnet-5-5` | US$ 2 / US$ 10 |
| So para redigir a entrega (etapa 6) | `claude-haiku-5-5` | US$ 0,10 / US$ 0,50 |

Por que o mais caro como padrao: um objeto custa poucas chamadas (estimo 5 a 10, por volta de US$ 1 a 2 no Fable 5.2; e estimativa, nao medicao) e uma placa errada custa chapa e tempo de maquina. A Anthropic descreve o Fable 5.2 como o modelo mais capaz dela; isso e a palavra do fabricante, nao teste meu.

## O que as referencias dizem (terceiros)

- Nenhum modelo vence em tudo. No CadBench (maio/2026), na trilha de imagem para codigo CAD, cada metrica teve um lider diferente: Claude Opus 4.7, Gemini 3.1 Pro e o especialista CAD-Coder. [arXiv 2605.10873](https://arxiv.org/html/2605.10873v1)
- Raciocinio espacial e fraco em todos. No OmniSpatial os melhores de 2025 ficaram perto de 55 em 100. [arXiv 2506.03135](https://arxiv.org/html/2506.03135v3)
- Codigo que roda nao e geometria certa: no Ortho2CAD, 96% dos scripts executaram com a forma errada. [arXiv 2607.08891](https://arxiv.org/html/2607.08891v1)
- Mostrar o resultado de volta para a IA melhora: CADCodeVerify (ICLR 2025). [arXiv 2410.05340](https://arxiv.org/html/2410.05340v2)

Conclusao pratica: a escolha do modelo pesa menos que o harness. E por isso que a precisao fica no construtor e a conferencia fica em codigo.

Concorrentes diretos (Gemini 3.x, GPT-5.x): aparecem nesses estudos, mas nao achei numero que os compare nesta tarefa. Nao afirmo que sao melhores nem piores.

## Rota organica (foto para malha 3D)

Sem vencedor claro, e as comparacoes sao de blogs de fornecedores (confianca baixa):
- Abertos: TRELLIS.2 da Microsoft (licenca MIT, cerca de 24 GB de video) e Hunyuan3D 2.1 da Tencent (cerca de 10 GB so a forma; licenca com restricao por pais).
- Pagos: Tripo, Meshy, Rodin. Meshy e Rodin exportam STL direto.
- Os abertos saem em GLB; precisa converter para STL. Nenhuma fonte mediu se a malha sai fechada.

Fontes: [3D AI Studio](https://www.3daistudio.com/3d-generator-ai-comparison-alternatives-guide/best-image-to-3d-tools-2026), [Vitalify](https://www.vitalify.asia/en/blog/ai-image-to-3d-generators-comparison), [Pixazo](https://www.pixazo.ai/blog/best-open-source-3d-model-generation-apis), [Arcframe](https://arcframe.ai/blog/best-image-to-3d-ai-models-compared).

## Como o harness troca de modelo

Por `modelos.json` nesta pasta (padrao e um modelo por etapa). Quem le esse arquivo e o `rodar.mjs`, que NAO foi escrito: hoje o arquivo so registra a escolha.

Para quem escrever o `rodar.mjs` (tirado da documentacao do SDK oficial `@anthropic-ai/sdk`, nao testado aqui): foto como bloco `{ type: "image", source: { type: "base64", media_type, data } }`; saida com esquema por `client.messages.parse` e `output_config.format`; profundidade por `output_config.effort` (comecar em "high"); no Fable 5.2 o raciocinio fica sempre ligado (nao enviar `thinking`), nao existe `tool_choice` forcado, e a resposta pode vir com `stop_reason: "refusal"`, que tem de ser tratada.

## O primeiro teste a fazer

Dez fotos reais de objetos ja medidos, as etapas 1 e 2 em cada modelo, e contar: quantas passam no conferidor na primeira tentativa e quantas placas saem certas. Custa dinheiro de API; precisa do seu sim.
