# Worker de transcrição resiliente + recuperação de backlog

**Data:** 2026-07-03
**Arquivo afetado:** `worker/transcribe.ts` (+ testes unitários)

## Problema

Reuniões pararam de aparecer no front de "Gravações" a partir de ~30/06/2026, apesar de o
egress do LiveKit estar gravando normalmente (os `.mp4` chegam ao MinIO em `com-transcricao/`).

O front lista **apenas** os `manifests/{id}.json` do MinIO ([lib/recordings.ts](../../../lib/recordings.ts)).
Um manifesto só é escrito na **última** linha do `processRecording`, **depois** de arquivar no
Google Drive. Hoje o arquivamento no Drive:

1. Roda **por último** e **só** se a transcrição deu certo (`!transcriptionFailed`).
2. **Não tem try/catch** — se qualquer chamada ao Drive lança, o `processRecording` lança
   **antes** de escrever o manifesto.

Consequências observadas:

- **Loop infinito de reprocesso:** Drive falha → sem manifesto → `.mp4` continua em
  `com-transcricao/` → próximo poll re-transcreve tudo → falha de novo. Queima créditos OpenRouter
  e nada aparece no front nem no Drive.
- **Pastas duplicadas no Drive:** `driveCreateFolder` sempre cria uma pasta nova; cada tentativa
  gera outra pasta (ex.: `03/06/2026 - 17h19 - l50u-ih9i` apareceu 3×).
- **Congelamento sem timeout:** `fetch` sem `AbortController`; uma requisição pendurada
  (OpenRouter ou Drive) trava a fila inteira até restart manual.
- **Instabilidade de rede correlacionada a relógio errado:** erros recorrentes
  `TimeoutError: Client network socket disconnected before secure TLS connection` são assinatura
  de clock skew — um relógio errado o suficiente também quebra o OAuth do Google (possível causa
  raiz da queda do Drive atual).

Backlog atual preso no MinIO, em dois estados:

- **(i)** Transcritas mas Drive falhou → existe `transcricoes/{id}.txt`, sem manifesto.
- **(ii)** Nem transcreveram → só o `.mp4`.

## Objetivos

1. **Nenhuma gravação se perde** — o vídeo sempre termina no Drive, ou fica no MinIO com manifesto.
2. **Fluxo nunca trava** — timeouts, falha de Drive nunca lança após o manifesto, sem loop, sem
   pastas duplicadas.
3. **Recuperar todo o backlog** preso no MinIO, reaproveitando txt quando existir (barato).
4. **Auto-migrar pro Drive** quando ele voltar, sem re-transcrever.

Fora de escopo (mas necessário em ops): **acertar o relógio do container do worker via NTP.**

## Desenho

### 1. `fetchWithTimeout`

Helper que envolve `fetch` com `AbortController` + timeout. Todas as chamadas de rede passam a
usá-lo: OpenRouter (`transcribeChunkOnce`), Drive token, criar/procurar pasta, upload.

Config nova (com defaults):

| Env | Default | Uso |
|---|---|---|
| `OPENROUTER_TIMEOUT_MS` | `180000` | timeout por chamada ao OpenRouter |
| `DRIVE_TIMEOUT_MS` | `120000` | timeout por chamada ao Google Drive |

Timeout dispara `AbortError`, tratado como erro **retryável** normal (não `NonRetryableChunkError`):
entra no retry de chunk (transcrição) ou no `catch` do arquivamento (Drive).

### 2. Drive idempotente

- `driveFindOrCreateFolder(token, name, parentId)` — busca via `files.list`
  (`q="name='<name>' and '<parent>' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"`,
  `supportsAllDrives=true`, `includeItemsFromAllDrives=true`). Reusa se achar; cria se não.
  Nomes são escapados (aspas simples) na query.
- `driveFindFileInFolder(token, name, folderId)` — mesma ideia para o vídeo; se já existir na pasta,
  pula o upload (evita re-subir num retry).

Isso elimina pastas/arquivos duplicados em reprocessamentos.

### 3. Novo `processRecording`

```
baixa vídeo do MinIO → extrai áudio → divide em chunks

determina utterances:
  se existe transcricoes/{id}.txt no MinIO (backlog tipo i):
    reconstrói utterances a partir do txt (parsePlainTextToUtterances) — NÃO transcreve
  senão:
    transcreve cada chunk (best-effort, com timeout; chunk com erro é pulado)

grava/atualiza transcricoes/{id}.txt no MinIO (referência)

arquiva no Drive (try/catch), se DRIVE_ENABLED:
  pasta = driveFindOrCreateFolder(...)
  se vídeo não está na pasta: driveUploadFile(vídeo)
  driveUploadFile(txt)
  storage = 'gdrive'; videoKey = null
catch (erro de Drive):
  loga o erro; storage = 's3'; videoKey = key   (mantém .mp4 no MinIO)

escreve o MANIFESTO **sempre** (qualquer storage; status complete/partial/failed)

se storage === 'gdrive': apaga o .mp4 do MinIO
```

Ordem crítica: **manifesto antes de apagar o `.mp4`**. Se crashar entre os dois, o manifesto já
existe (não reprocessa) e sobra só um `.mp4` órfão — limpo pelo passo de reconciliação (abaixo).

`transcriptionStatus` — mantém a semântica e os valores atuais (`'complete' | 'failed'`) para não
mexer no tipo `RecordingManifest` nem no front:
- `failed` — zero utterances **e** houve chunks pulados. **Mesmo assim** grava manifesto e arquiva
  o vídeo (o vídeo é o artefato valioso; aparece no front marcado como falha de transcrição).
- `complete` — qualquer outro caso (inclusive com alguns chunks pulados, como hoje).
- Chunks pulados continuam registrados em `skippedChunks` (informação já existente no manifesto).

### 4. Reconciliação / auto-migração no loop principal

Além de processar `.mp4` pendentes, cada ciclo do loop roda `reconcileS3Recordings()`:

- Lista `manifests/*.json` com `storage === 's3'` **e** `videoKey` presente no MinIO.
- Para cada: tenta arquivar vídeo+txt no Drive (**sem re-transcrever**, reusa utterances do manifesto).
  - Sucesso: atualiza manifesto para `storage='gdrive'`, `videoKey=null`, grava IDs; apaga `.mp4`.
  - Falha de Drive: deixa como está; tenta no próximo ciclo.
- Também remove `.mp4` órfãos em `com-transcricao/` cujo manifesto já é `gdrive`.

Efeito: quando o Drive volta, todo o fallback `s3` **migra sozinho**.

### 5. `parsePlainTextToUtterances(txt)`

Inverte `utterancesToPlainText`. Formato de cada linha: `[<start>s] <speaker>: <text>`.
Regex por linha: `^\[(\d+(?:\.\d+)?)s\]\s+([^:]+):\s+([\s\S]*)$`.

- `start` = número capturado; `end` = `start` da próxima utterance (ou `start` na última).
- Linhas que não casam o padrão são logadas e ignoradas.
- Perda conhecida e aceita: o `end` original não é recuperável (o txt só guarda `start`);
  reconstruído como início da fala seguinte. Player e busca funcionam igual.

## Tratamento de erros

- Qualquer `fetch` que estoure timeout → `AbortError` retryável.
- Falha de transcrição de chunk → chunk pulado (comportamento atual mantido).
- Falha de arquivamento no Drive → fallback `s3`, manifesto escrito, **sem** lançar após o manifesto.
- Erro por gravação → capturado no loop principal (`falha ao processar`), não derruba o worker.
- Sem re-transcrição no fallback nem na migração (economia de créditos).

## Testes

Unitários (vitest) para a lógica pura/arriscada:

- **`parsePlainTextToUtterances`** — casos: linha normal; múltiplas falas com `end` derivado;
  speaker com espaços; texto com `:`; linha malformada ignorada; txt vazio → `[]`.
- **`fetchWithTimeout`** — resolve antes do prazo; aborta após o prazo (fetch mockado / fake timers).
- **`driveFindOrCreateFolder`** — reusa quando `files.list` retorna item; cria quando vazio;
  escapa aspas no nome (fetch mockado).

I/O pesado (S3, ffmpeg, upload real) fica coberto pela drenagem real do backlog em staging/prod.

## Deploy

1. Merge → rebuild/redeploy do container do worker (Easypanel).
2. **Acertar o relógio do worker (NTP)** — pode ser a causa raiz da queda do Drive; sem isso o
   OAuth do Google pode continuar falhando.
3. Acompanhar o log: o worker drena o backlog (reusa txt onde há, transcreve o resto), arquiva no
   Drive (ou cai em `s3` e migra depois), e as gravações voltam a aparecer no front.

## Riscos

- **Parser de txt** é o ponto mais frágil (texto multi-linha quebraria o split por `\n`). Mitigado
  por testes e por ignorar linhas não-casadas em vez de abortar.
- **Relógio errado** pode manter o Drive fora mesmo com o código resiliente — é pré-requisito de ops.
- **Custo OpenRouter** para o backlog tipo (ii) (sem txt) é inevitável; tipo (i) é reaproveitado.
