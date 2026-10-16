## Escopo da Fase 03 — Upload e Processamento de Vídeos

Você vai entregar as capacidades abaixo (definição completa em docs/project-plan.md, Fase 03):

- Object storage para os arquivos de vídeo e thumbnails.
- Fila de processamento em segundo plano e um worker que a consome.
- Upload de vídeos de até 10GB sem travar o sistema (sem segurar a API durante o envio).
- Pré-cadastro automático do vídeo como rascunho ao iniciar o upload.
- Processamento automático após o upload: extração de duração e metadados.
- Geração automática de thumbnail a partir de um frame do vídeo.
- URL única por vídeo, sem conflito com outros.
- Reprodução via streaming (sem exigir o download completo).
- Download do vídeo pelo usuário.

Entregáveis (do plano original): upload de até 10GB funcional, processamento automático do vídeo, streaming funcionando e URLs únicas geradas.

Persistência: uma entidade/tabela de vídeos ligada ao canal, com pelo menos identificação, dono (canal), título, status (ex.: rascunho → processando → pronto/erro), chaves de storage do arquivo e do thumbnail, duração e metadados, e o identificador da URL única. O modelo exato é definido no plano (Data Model).

Decisões que você precisa tomar e justificar na etapa de research:

- A tecnologia de fila — o plano do projeto a deixa explicitamente em aberto ("TBD"). É a principal decisão de stack da fase.
- A estratégia de upload de 10GB sem travar (ex.: upload direto ao storage via URL pré-assinada / multipart, em vez de passar o arquivo pela API).
- Como o worker roda (processo/container separado) e como ele extrai metadados e gera o thumbnail (FFmpeg/ffprobe).
- A estratégia de URL única e a de streaming (ex.: requisições com range / 206 Partial Content).
- O ciclo de status do vídeo e o que acontece em caso de falha no processamento.
- Sobre o object storage: ele não é uma escolha em aberto. O projeto já aponta para S3 (compatível) — na prática você roda MinIO localmente em Docker (mesma API do S3) e trocaria por S3 em produção. O que você decide aqui é como usá-lo (organização de buckets/chaves, upload pré-assinado), não qual storage. A decisão de stack genuinamente aberta é a fila.

Essas decisões são o coração da etapa de research. Pesquise as opções, registre os trade-offs e a escolha no documento de decisões, e só então parta para o planejamento.

