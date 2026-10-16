## Critérios de Aceite

Todos obrigatórios. Esta é a lista única de avaliação.

### Decisões e planejamento

- technical-decisions-phase-03-videos.md com as decisões em aberto resolvidas e justificadas (fila, estratégia de upload, streaming, processamento/thumbnail, ciclo de status)
- Pasta docs/phases/phase-03-videos/ com context.md, validation.md (status clean), o plano phase-03-videos.md, o progress.md e o library-refs.md (se houver libs novas a fixar — esperado nesta fase)
- O plano segue o formato do projeto: SIs SI-03.x, Technical Specifications (Data Model, API Contracts, Authorization Matrix, Error Catalog, Events/Messages), Dependency Map e Deliverables

### Implementação — feature

- Upload de vídeo de até 10GB sem travar a API, com pré-cadastro do vídeo como rascunho ao iniciar
- Processamento automático após o upload: extração de duração/metadados e geração de thumbnail
- URL única por vídeo, sem conflito
- Streaming funcionando (sem exigir download completo) e download do vídeo disponível
- Ciclo de status do vídeo (rascunho → processando → pronto/erro) refletido no banco

### Implementação — infraestrutura e qualidade

- Object storage, fila e worker subindo via docker compose junto com o backend
- Migration cria a tabela de vídeos; entidade ligada ao canal
- Testes nos níveis adequados, verdes (npm test e npm run test:e2e)
- Definition of Done completa: suíte verde + npx tsc --noEmit (código 0) + npm run lint
- Git Flow respeitado (trabalho em feature/* a partir de dev, sem commit direto na main)

### Documentação e ferramenta

- CLAUDE.md (ou equivalente) atualizado com a seção de vídeos, coerente com o código
- Atualize o CLAUDE.md (ou o arquivo equivalente da sua ferramenta) refletindo o estado real do código após a fase: o módulo de vídeos, os endpoints, a fila/worker e o storage. Documentação que cite arquivos ou comportamentos inexistentes reprova.

## Reprova automática

- Pular o workflow: implementar sem as etapas de research, planejamento e implementação (e seus artefatos)
- Plano sem SIs ou sem as Technical Specifications, ou validation.md que não fecha em clean
- Passar o arquivo de 10GB pela API de forma que trave o sistema (sem estratégia de upload assíncrono/direto)
- Não ter fila, worker e storage reais subindo no Compose
tsc com erro, lint quebrado ou suíte vermelha
- Commit direto na main
- CLAUDE.md/equivalente inconsistente com o código
- Usar outra ferramenta sem portar a fundação para a convenção dela


## Estrutura entregável

Tudo dentro do fork do mba-ia-greenfield-project. Abaixo, apenas o que é novo/alterado (os nomes de arquivo do módulo são ilustrativos — a estrutura final é decisão do seu plano):

mba-ia-greenfield-project/
├── docs/
│   ├── decisions/
│   │   └── technical-decisions-phase-03-videos.md     ← research
│   └── phases/
│       └── phase-03-videos/                           ← pasta da fase
│           ├── context.md                             ← plan-context
│           ├── validation.md                          ← plan-validate (clean)
│           ├── library-refs.md                        ← plan-resolve (se houver libs novas)
│           ├── phase-03-videos.md                     ← plan-build (o plano)
│           └── progress.md                            ← implement
├── nestjs-project/
│   ├── CLAUDE.md (ou equivalente)                     ← atualizado
│   ├── compose.yaml                                   ← + storage, fila, worker
│   ├── src/
│   │   ├── videos/                                    ← novo módulo (forma de referência: auth/)
│   │   │   └── ...
│   │   └── database/migrations/
│   │       └── <timestamp>-CreateVideos.ts
│   └── (worker de vídeo — local conforme o seu plano)
└── CLAUDE.md (ou equivalente)                         ← atualizado
