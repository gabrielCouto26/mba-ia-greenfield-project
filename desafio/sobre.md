# StreamTube

## Sobre

O StreamTube é a plataforma de compartilhamento de vídeos que você acompanhou sendo construída ao longo do curso. O professor entregou as Fases 01 (configuração base) e 02 (autenticação, usuários e canais), backend e frontend, seguindo o workflow de desenvolvimento orientado por IA do curso.

Seu desafio é dar continuidade ao projeto implementando a próxima fase da sequência, a Fase 03 — Upload e Processamento de Vídeos, por completo. Diferente de uma feature simples de CRUD, a Fase 03 é um desafio de engenharia por si só: envolve armazenamento de arquivos grandes, processamento assíncrono em fila, um worker de vídeo, streaming e infraestrutura nova em Docker. Você vai conduzir tudo isso usando IA como ferramenta principal, seguindo o workflow do projeto de ponta a ponta.

Este é um desafio de backend: a entrega é a API, o worker, a infraestrutura e os artefatos do processo. (Há um frontend no repositório, mas a interface de vídeo não faz parte do escopo desta fase.)

## O que já existe no projeto

- Backend NestJS 11 + TypeORM + PostgreSQL 17 em nestjs-project/, com as Fases 01 e 02 fechadas: módulos auth/, users/, channels/, mail/, common/, config/, database/ e swagger/ (OpenAPI).
- Cada usuário tem um canal (relação 1:1), criado no cadastro. Os vídeos da Fase 03 pertencem a um canal.
- Guard JWT global, filtro de exceções de domínio, ValidationPipe global, rate limiting, migrations versionadas e seeds.
- Infra atual no nestjs-project/compose.yaml: apenas API, PostgreSQL e Mailpit.
- Um frontend Next.js em next-frontend/ (Fases 01–02), fora do escopo desta fase.

O que não existe e você vai construir: o módulo de vídeo, a tabela de vídeos, o serviço de object storage, a fila de processamento e o worker de vídeo (FFmpeg). A arquitetura-alvo (em docs/diagrams/software-arch.mermaid e no CLAUDE.md) já prevê esses três componentes como parte da Fase 03.