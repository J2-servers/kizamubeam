ETAPA 3 — ESPECIFICAR. Saida: JSON no esquema kz-montagem/1.

Recebe: o bloco "placas" ja calculado pelo conferidor a partir das suas vistas (id, x, y, z) e a analise.

Copie "placas" como veio: os numeros nao sao seus para mudar. Se um numero parecer errado, o erro esta nas vistas; diga isso em vez de corrigir aqui.

Voce acrescenta:
- "nome" de cada placa, como o usuario a chamaria (Fundo, Lateral esquerda, Tampa).
- "ligacoes": use "auto" e deixe o construtor classificar cada par. Liste ligacoes a mao so quando a foto mostra um encaixe especifico que o automatico nao escolheria (por exemplo, camadas coladas, ou tampa presa por dobradica).
- "moveis": uma entrada por parte que se move, com a placa, o tipo ("dobradica", "desliza", "gira") e a folga em mm ("folga_mm"). Sem parte movel, lista vazia.
- "recortes": so se a analise apontou abertura ou contorno que nao e retangular.
