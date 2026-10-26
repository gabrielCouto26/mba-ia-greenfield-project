# Documento-fonte — Endpoint público das presigned URLs (MinIO/S3)

> **Propósito deste documento.** Capturar, com precisão, um gap de arquitetura identificado durante o
> teste manual de upload/streaming, para ser usado como **entrada (source material) do workflow do
> desafio** (research → plan-context → plan-validate → plan-resolve → plan-build → implement) numa
> branch nova a partir de `main`. **Nada foi implementado** — esta é uma decisão de arquitetura da
> Fase 03 (estratégia de endpoint das presigned URLs) a ser resolvida e justificada no research.
>
> - Data: 2026-10-26 · Autor: Claude Code
> - Baseline: `main` == `dev` == `fdf0535`
> - Enquadramento sugerido: **TD da Fase 03** em
>   `docs/decisions/technical-decisions-phase-03-videos.md` (complementa a TD-03 de streaming via
>   presigned GET), com SIs próprios — escopo separado do fix de startup/infra.

---

## 1. Problema

Todas as presigned URLs são assinadas com o host interno do Compose `minio:9000`
(`S3_ENDPOINT=http://minio:9000` em `nestjs-project/.env`, default em
`nestjs-project/src/config/s3.config.ts:4`). Esse host **só resolve dentro da rede Docker**, então
qualquer cliente fora do Docker (browser, frontend, `curl` no host) não consegue acessá-las.

Endpoints afetados:
- `GET /videos/:publicId/stream` e `GET /videos/:publicId/download` (302 → presigned GET).
- `thumbnail_url` retornada por `GET /videos/:publicId`.
- `POST /videos/:publicId/upload/presign-part` (presigned PUT).

Impacto direto no critério de aceite `desafio/criterios-de-aceite.md:16` —
*"Streaming funcionando (sem exigir download completo) e download do vídeo disponível"*: hoje
funciona apenas de dentro da rede Docker.

---

## 2. Por que não há atalho

Não dá para reescrever o host na URL **depois** de assinada: o SigV4 assina o header `host`
(`X-Amz-SignedHeaders=host`). Trocar `minio:9000` por `localhost:9000` na string quebra a assinatura
(`SignatureDoesNotMatch`).

A **troca do `S3_ENDPOINT`** de `minio:9000` para `localhost:9000` também **não serve**: ela quebra
as operações server-side que rodam dentro dos containers e fazem chamada de rede real via
`client.send()` — `initiateMultipartUpload`, `completeMultipartUpload`, `abortMultipartUpload`,
`uploadFile` (API) e `downloadFile` (worker) —, pois dentro do container `localhost` é o próprio
container. E viola a regra dura de Docker do `CLAUDE.md` ("never localhost; use o nome do serviço").

**Workaround de teste (sem código):** `curl --resolve minio:9000:127.0.0.1 ...` — conecta em
127.0.0.1 mantendo `Host: minio:9000`, preservando a assinatura. Serve só para testes manuais.

---

## 3. Solução recomendada — endpoint dividido (interno vs público)

Presigning é cálculo criptográfico puro (sem rede), então é possível **assinar com um endpoint
público mesmo de dentro do container**:

- **Client interno** (`minio:9000`): mantém create / complete / abort / upload / download (rede real).
- **Presigner público** (`localhost:9000`, configurável): usado **só** nos `getSignedUrl` —
  `getPresignedPartUrl` (`storage.service.ts:52-64`) e `getPresignedGetUrl`
  (`storage.service.ts:101-113`). A URL sai com `Host: localhost:9000`, que o cliente no host acessa
  pela porta publicada, com assinatura válida.

### Arquivos impactados (esboço — o plano define a forma final)
- `nestjs-project/src/config/s3.config.ts` — novo campo `publicEndpoint` (ex.:
  `process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9000'`).
- `nestjs-project/src/videos/services/storage.service.ts` — segundo `S3Client` (presigner) com
  `endpoint: config.publicEndpoint`; os dois métodos de presign passam a usá-lo. Os demais métodos
  seguem no client interno.
- `nestjs-project/.env` e `nestjs-project/.env.example` — `S3_PUBLIC_ENDPOINT=http://localhost:9000`.
- `nestjs-project/src/config/env.validation.ts` — incluir a nova var (opcional) no schema Joi.
- Specs do storage (`storage.service*.spec.ts` / `*.integration-spec.ts`) — ajustar asserts de
  endpoint e cobrir que os presigns usam o endpoint público e as demais operações o interno.

### Observação de produção
Em produção o `publicEndpoint` é o domínio público do S3/CDN; o endpoint interno desaparece (S3 real
é alcançável diretamente). O split é justamente o que mantém o MinIO local equivalente ao S3 em prod.

---

## 4. Decisões em aberto para o research

1. **Default do `publicEndpoint`**: cair para `S3_ENDPOINT` (comportamento atual, seguro) ou para
   `localhost:9000`? Recomendado: default = `S3_ENDPOINT` para não quebrar quem não configurar, e
   documentar `S3_PUBLIC_ENDPOINT` no `.env.example`.
2. **Um segundo `S3Client` vs recalcular endpoint por chamada**: um segundo client dedicado é mais
   simples e explícito.
3. **Escopo do split**: aplicar a todos os presigns (upload PUT + GET de stream/download/thumbnail) —
   sim, todos são consumidos por cliente externo.
4. **Streaming real (range/206)**: fora deste escopo; a TD-03 usa 302→presigned GET. Só registrar
   que o endpoint público é pré-requisito para o cliente externo seguir o redirect.

---

## 5. Como rodar pelo workflow do desafio (checklist)

1. **Branch limpa** a partir de `main` (escopo separado do fix de startup).
2. **research** → nova TD em `technical-decisions-phase-03-videos.md`: "Endpoint público para
   presigned URLs", com o problema (§1), por que o atalho não serve (§2), a solução (§3) e as decisões
   em aberto (§4) resolvidas e justificadas.
3. **plan-context / validate / resolve** → `validation.md` em `clean`.
4. **plan-build** → SIs (ex.: SI-A config `publicEndpoint` + env + validation; SI-B segundo client no
   `StorageService` + ajuste dos dois presigns; SI-C specs), cada um com Technical Spec.
5. **implement** → por SI, com `progress.md`.
6. **DoD** → suíte verde, `tsc` 0, `lint` OK; verificar do **host** que `/stream`, `/download` e a
   `thumbnail_url` abrem sem `--resolve`, e que o `presign-part` + PUT funcionam sem `--resolve`.

---

## 6. Evidência

Observado em 2026-10-26: o PUT de `presign-part` e o `GET .../stream` só funcionam do host com
`curl --resolve minio:9000:127.0.0.1`. Processamento ponta-a-ponta (`status=ready`, duração +
thumbnail) confirmado — o gap é exclusivamente de **acessibilidade das URLs por cliente externo**,
não do pipeline de processamento.
