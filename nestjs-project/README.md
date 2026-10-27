# StreamTube — Backend API (NestJS)

API REST do projeto StreamTube, construída com NestJS 11 + TypeScript. Roda inteiramente em Docker Compose.

Para convenções de código, estrutura de módulos, padrões de teste e regras de arquitetura, consulte [`CLAUDE.md`](./CLAUDE.md).

## Pré-requisitos

- Docker e Docker Compose

## Subindo o ambiente

```bash
# Constrói as imagens e sobe todos os serviços (API, worker, PostgreSQL, Redis, MinIO, Mailpit)
docker compose up -d --build

# Executa as migrations do banco (obrigatório — synchronize está desabilitado)
docker compose exec nestjs-api npm run migration:run

# Inicia o servidor de desenvolvimento em watch mode (em terminal separado — processo não termina)
docker compose exec nestjs-api npm run start:dev
```

> O `docker compose up -d --build` já provisiona o bucket MinIO via `minio-init` e instala as dependências Node dentro da imagem (via `npm ci` no Dockerfile). Não é necessário rodar `npm install` manualmente.

## Serviços disponíveis

| Serviço | URL / Porta |
|---------|-------------|
| API NestJS | http://localhost:3000 |
| Swagger UI | http://localhost:3000/api/docs (`SWAGGER_ENABLED=true`) |
| PostgreSQL | `localhost:5432` (db/user/senha: `streamtube`) |
| Redis | `localhost:6379` |
| MinIO API (S3) | http://localhost:9000 |
| MinIO Console | http://localhost:9001 |
| Mailpit (e-mails) | http://localhost:8025 |

## Testes

Todos os comandos rodam **dentro do container**:

```bash
# Unit + Integration (suite completa)
docker compose exec nestjs-api npm test -- --runInBand

# End-to-end
docker compose exec nestjs-api npm run test:e2e

# Type-check
docker compose exec nestjs-api npx tsc --noEmit

# Lint
docker compose exec nestjs-api npm run lint
```

## Variáveis de ambiente

Copie `.env.example` para `.env` e ajuste conforme necessário. A variável mais importante para desenvolvimento local:

```dotenv
S3_PUBLIC_ENDPOINT=http://localhost:9000
```

Sem ela, as URLs presignadas (upload, stream, download, thumbnail) apontariam para o host interno `minio:9000`, inacessível fora do Docker.
