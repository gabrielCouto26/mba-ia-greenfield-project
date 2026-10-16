## Workflow

O projeto foi desenvolvido por um workflow de planejamento em pipeline, e você deve segui-lo. Cada estágio é uma skill do projeto e gera um artefato:

- Pesquisar opções e decidir o caminho técnico — **skill research** — artefato docs/decisions/technical-decisions-phase-03-videos.md
- Consolidar o contexto da fase — **skill plan-context** — artefato docs/phases/phase-03-videos/context.md
- Validar (inconsistências, decisões faltando, gaps) — **skill plan-validate** — artefato validation.md (veredito clean/dirty)
- Resolver pendências e fixar libs — **skill plan-resolve** — atualiza decisões/contexto + library-refs.md
- Gerar o plano executável — **skill plan-build** — artefato phase-03-videos.md (SIs + Technical Specs + Dependency Map + Deliverables)
- Gerar specs de teste (opcional) — **skill plan-test**-specs — artefato specs de teste
- Implementar passo a passo — **skill implement** — artefato código + progress.md

Pontos do formato que você precisa respeitar:

- A fase é uma pasta (docs/phases/phase-03-videos/) com context.md, validation.md, o plano phase-03-videos.md e o progress.md — mais o library-refs.md quando a fase fixa bibliotecas novas (o caso aqui, por causa de storage/fila/FFmpeg). Use a pasta docs/phases/phase-02-auth/ como referência de formato.
- O plano é organizado em Step Implementations (SI-03.1, SI-03.2, …) com as Technical Specifications (Data Model, API Contracts, Authorization Matrix, Error Catalog e, por causa da fila, Events/Messages), o Dependency Map e os Deliverables.
- O validation.md precisa terminar com status clean antes de implementar.
- Os sub-agents de leitura (.claude/agents/) são usados pelas skills por baixo dos panos: você não os invoca diretamente.
- Para quem usa outra ferramenta: produza os mesmos artefatos (decisões, contexto, validação, plano com SIs e Technical Specs, progresso), seguindo o mesmo encadeamento. O formato da pasta da fase é o contrato; a skill que o gera é detalhe da ferramenta.