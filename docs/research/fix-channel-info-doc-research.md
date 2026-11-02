# Research Dossier — Corrigir "channel info" na doc da rota `GET /videos/:publicId`

> Data: 2026-11-02 · Branch atual: `fix/channel-info` · Tipo: correção de documentação (bugfix de doc)

## 1. Problem & Context

- **Objective:** A documentação em prosa descreve que `GET /videos/:publicId` retorna "channel info", mas a implementação (`VideosService.findByPublicId`) não retorna nenhum dado de canal. Alinhar a documentação ao retorno real: `id`, `public_id`, `title`, `status`, `duration`, `thumbnail_url`, `created_at`.
- **Root Cause / Trigger:** Feedback externo apontou a divergência. A investigação confirmou que a frase "channel info" é um resíduo de redação nas tabelas-resumo em prosa — nunca refletiu o código nem o plano. A fonte da verdade do contrato (`openapi.json`) e o plano da fase (`phase-03-videos.md`) já listam apenas os 7 campos, sem canal.
- **Recommended Role for rpi:plan:** Technical Writer / Backend Documentation Maintainer (mudança de documentação, sem alteração de comportamento).

## 2. Codebase Mapping

- **Affected Packages:** `nestjs-project/` (apenas documentação); raiz do repo (`state.local.json`).
- **Key Files & Symbols:**
  - `nestjs-project/CLAUDE.md:170` — **PRECISA MUDAR.** Tabela "Videos Module → API Endpoints". Célula: `Get video metadata, status, channel info, thumbnail URL`. Trocar `channel info` pela descrição real do retorno.
  - `state.local.json:171` — **PRECISA MUDAR (ver nota de escopo).** Linha do array `endpointsAndAPIs.implemented`: `"GET /videos/:publicId — public video metadata, status, channel info, thumbnail URL (SI-03.9)"`.
  - `nestjs-project/src/videos/services/videos.service.ts:128-155` — **REFERÊNCIA (não muda).** `findByPublicId` faz `findOne({ where: { public_id } })` sem `relations`; retorna exatamente os 7 campos. Fonte da verdade do comportamento.
  - `nestjs-project/src/videos/controllers/videos.controller.ts:193-222` — **REFERÊNCIA (não muda).** Handler `getVideoInfo`; `@ApiResponse` 200 já declara os 7 campos corretos.
  - `nestjs-project/openapi.json` (`paths./videos/{publicId}.get`) — **JÁ CORRETO.** 200 props = `[id, public_id, title, status, duration, thumbnail_url, created_at]`. Nenhuma ação.
  - `docs/phases/phase-03-videos/phase-03-videos.md` (SI-03.9 linha 271-295; API Contract linha 435-446) — **JÁ CORRETO E CONSISTENTE.** Lista os 7 campos, sem canal. O plano nunca prometeu canal. Nenhuma ação.
- **Data Model & Schema Impact:**
  - Tables touched: Nenhuma.
  - Migration required: Não.
  - Código de produção alterado: Não. (Correção exclusivamente de documentação.)

## 3. Clarifications & Resolved Ambiguities

- **Corrigir a doc ou implementar o canal no retorno?** → Resolvido: **corrigir a doc** (o usuário escolheu seguir esse caminho). Expor canal na rota pública seria uma *feature nova* (relations + DTO + schema OpenAPI + plano + testes) e, pelas regras de escopo do `CLAUDE.md`, deve ser tarefa separada com seu próprio workflow — não entra aqui.
- **Imprecisões do feedback, esclarecidas:**
  - O feedback diz que "o SI-03.9 do plano também não prevê isso" sugerindo ajustar o plano. Na verdade o plano **já está consistente** com o código (7 campos, sem canal) — não precisa de mudança. Só as duas tabelas-resumo em prosa estão erradas.
  - Numeração: o API Contract no plano rotula a rota como `(SI-03.7)` (linha 435), enquanto a lista de SIs a chama `SI-03.9`. É a mesma rota; inconsistência cosmética interna do doc. **Fora de escopo** desta correção (não misturar escopos); anotar como débito de doc separado se incomodar.
- **Escopo do `state.local.json`:** é um artefato **gerado** (via skill `state-local`) e pode ser regenerado. O feedback citou nominalmente só o `nestjs-project/CLAUDE.md`. Decisão sugerida: corrigir ambos para consistência imediata, mas tratar o `state.local.json` como alvo secundário (ver pergunta aberta ao final).
- **Varredura completa:** `grep -rn "channel info"` no repo (excluindo `node_modules`) retorna **exatamente 2 ocorrências** — as duas listadas acima. Não há outras cópias da frase.

## 4. Technical Approach & Trade-offs

- **Recommended Approach:** Substituir a expressão `channel info` nas duas linhas de prosa pela lista real de campos (ou uma redação que não mencione canal). Texto sugerido, espelhando o `openapi.json`/plano:
  - `nestjs-project/CLAUDE.md:170` → célula Description: `Get video metadata: id, public_id, title, status, duration, thumbnail_url, created_at`
  - `state.local.json:171` → `"GET /videos/:publicId — public video metadata: id, public_id, title, status, duration, thumbnail_url, created_at (SI-03.9)"`
- **Alternatives Considered:**
  - *Implementar canal no retorno (Opção B):* descartado — vira feature, muda contrato público, exige testes/plano próprios, viola o limite de "um escopo por vez".
  - *Regenerar `state.local.json` via skill em vez de editar à mão:* possível, mas a skill reescreve o arquivo inteiro e pode introduzir ruído fora de escopo; edição cirúrgica da única linha é mais segura e revisável. (Confirmar preferência — pergunta aberta.)

## 5. Blueprint for rpi:plan

### Suggested Scope Stages
1. **Stage 1 — Corrigir a tabela de rotas canônica:** editar `nestjs-project/CLAUDE.md:170`, removendo "channel info" e descrevendo os 7 campos reais. Verificar que nenhuma outra célula/linha do arquivo repete a frase.
2. **Stage 2 — Alinhar o state file:** editar `state.local.json:171` (ou regenerar via skill `state-local`, conforme decisão). Alinhar a redação à do Stage 1.
3. **Stage 3 — Verificação de consistência:** reexecutar `grep -rn "channel info"` para garantir 0 ocorrências; confirmar que `openapi.json` e `phase-03-videos.md` permanecem intocados e já corretos.

### Specific Restrictions
- **Mudança de documentação apenas** — nenhum arquivo `.ts` de produção pode ser alterado. Se qualquer `.ts` precisar mudar, o escopo está errado (seria feature, não correção de doc).
- **Um escopo por vez** (CLAUDE.md § Scope Limits): não corrigir de passagem a numeração SI-03.7/03.9, nem outros itens de doc não relacionados.
- Sem mudança de código → **Definition of Done técnica (tsc/lint/testes) não se aplica como gate de produção**, mas rodar o `grep` de verificação é o critério de aceite factual.
- Git Flow: a branch `fix/channel-info` já reflete o escopo; não commitar direto em `main`.

### Validation & Testing Strategy
- **Verificação factual (substitui testes de código, pois não há código):**
  - `grep -rn "channel info" --include="*.md" --include="*.json" --include="*.ts" . | grep -v node_modules` → deve retornar **0 linhas** após a correção.
  - Conferir manualmente que as duas linhas corrigidas listam os 7 campos iguais ao `openapi.json` (`id, public_id, title, status, duration, thumbnail_url, created_at`).
- **Nenhuma suíte de teste automatizada é necessária** — a mudança não toca comportamento. Opcional: `cd nestjs-project && npm run openapi:export` para reconfirmar que o contrato gerado segue sem campo de canal (sanity check, não um gate).

### Open Questions for rpi:plan / user
1. Corrigir o `state.local.json` **à mão** (edição cirúrgica da linha) ou **regenerar** via skill `state-local`? (Recomendado: edição à mão, por ser cirúrgica.)
2. A inconsistência de numeração SI-03.7 vs SI-03.9 dentro de `phase-03-videos.md` deve virar um débito/tarefa separada, ou é ignorável? (Fora de escopo desta correção.)
