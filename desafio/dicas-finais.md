## Dicas finais

- A Fase 03 é grande; o plano é o que segura. Quanto melhores as decisões e o plano (SIs bem fatiados, contratos e eventos definidos), mais limpa a implementação. Gaste tempo no planejamento.
- Upload de 10GB é decisão de arquitetura, não de força bruta. Pesquise a estratégia certa antes de codar; passar o arquivo inteiro pela API é o caminho errado.
- Infra real, testada. Fila, worker e storage precisam subir no Compose e ser exercitados pelos testes: não simule o que dá para rodar de verdade.
- Continuidade, não retrabalho. Reuse os padrões do projeto (guard, filtro de exceções, repository, migrations, rules). Você está somando uma fase, não reescrevendo o que já existe.
- Ferramenta é escolha sua, workflow não. Use o Claude Code ou porte a fundação para a sua ferramenta — mas o encadeamento research → planejamento → implementação e os artefatos da fase são os mesmos.
