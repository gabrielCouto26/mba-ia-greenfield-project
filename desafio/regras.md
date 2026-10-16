## Regras e Definition of Done

O CLAUDE.md define as regras do projeto, que valem para esta fase:

- Definition of Done: a fase só está pronta quando a suíte de testes relevante passa (unit + integração + e2e), a suíte completa passa, npx tsc --noEmit sai com código 0 e npm run lint passa.
- Docker: tudo roda em containers; use sempre o nome do serviço do Compose como host (ex.: db), nunca localhost.
- Documentação de libs: antes de implementar com qualquer biblioteca, consulte a doc oficial via context7 (MCP) e siga a versão instalada.
- Git Flow: branches de feature/* saem da dev e voltam para a dev; nunca commite direto na main. Commits curtos e descritivos.
- Testes: sufixos *.spec.ts (unit), *.integration-spec.ts (integração com banco/serviços reais), *.e2e-spec.ts (e2e via supertest).