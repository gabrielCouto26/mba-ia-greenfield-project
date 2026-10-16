## Requisitos

1. Decisões técnicas (research)

Rode a etapa de research sobre as decisões em aberto acima. Salve em docs/decisions/technical-decisions-phase-03-videos.md, no formato dos documentos de decisão existentes (opções, trade-offs e recomendação por decisão). É esse documento que alimenta o planejamento.

2. Planejamento (pipeline)

Conduza a pipeline de planejamento até o plano final, gerando os artefatos na pasta docs/phases/phase-03-videos/:

- plan-context → context.md
- plan-validate → validation.md (precisa fechar em clean)
- plan-resolve → resolve as pendências apontadas e gera library-refs.md (libs confirmadas via context7)
- plan-build → phase-03-videos.md, com Step Implementations (SI-03.x), Technical Specifications (incluindo Events/Messages para a fila), Dependency Map e Deliverables

Revise criticamente cada saída. O validation.md aponta decisões faltando e gaps de dependência: itere validate ↔ resolve até ficar clean. Plano frouxo gera implementação frouxa.

3. Implementação (implement)

Implemente a fase conduzido pela skill implement, SI a SI, rodando os testes a cada passo e só avançando com a suíte do SI verde. Isso inclui:

- O módulo de vídeos no backend, seguindo as convenções e rules do projeto (separação de camadas, repository pattern, uso de fila/eventos, transações). Use o módulo auth/ como referência de forma; a estrutura concreta de arquivos é decisão do seu plano, não do enunciado.
- A infraestrutura nova no compose.yaml: serviços de object storage, fila e worker, subindo junto com a stack do backend.
- A migration criando a tabela de vídeos.
- Os testes nos níveis adequados (unit, integração com banco/serviços reais, e2e), conforme as skills de teste do projeto. Não mocke o que dá para testar de verdade com a infra do Compose.
- O progress.md da fase atualizado (status + testes por SI), como na Fase 02.

Ao final, a Definition of Done do CLAUDE.md precisa passar inteira.