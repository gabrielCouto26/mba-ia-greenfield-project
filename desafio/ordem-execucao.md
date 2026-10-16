## Ordem de execução sugerida

1. Setup. Faça o fork, suba o backend (cd nestjs-project && docker compose up -d, instale as dependências, rode as migrations) e confirme a suíte atual verde. Se for usar outra ferramenta, porte a fundação de IA antes de começar. [OK]

2. Research. Pesquise e feche as decisões em aberto (fila, estratégia de upload, streaming, processamento). O object storage já é dado (S3/MinIO).

3. Planejamento. Rode a pipeline (context → validate → resolve → build) até o validation.md fechar em clean e o plano ficar completo. Revise criticamente.

4. Implementação. Conduza a implementação SI a SI: módulo, infra no Compose, migration, testes e progress.md.

5. Fechamento. Garanta a Definition of Done (testes + tsc + lint), atualize o CLAUDE.md e revise os Critérios de Aceite item a item antes do push.
