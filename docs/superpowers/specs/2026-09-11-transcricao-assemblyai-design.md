# Transcrição com AssemblyAI (Universal-3.5 Pro) — Design

**Data:** 2026-09-11
**Escopo:** `worker/` (transcription worker), `app/api/transcription/webhook`, `lib/recordings.ts`, tipo do manifesto.

## Problema

O worker envia o áudio bruto (chunks de 5 min) para o Gemini 2.5 Flash via OpenRouter e pede
transcrição + identificação de falantes. Como é um LLM multimodal e não um sistema de ASR, ele
troca interlocutores, alucina trechos e degrada em reuniões longas (~1h30). Os guardrails
existentes (silêncio, repetição, pile-up) mitigam, mas não resolvem a causa raiz.

## Decisão

Separar responsabilidades:

- **Transcrição + diarização** → AssemblyAI, modelo `universal-3-5-pro`, diarização acústica,
  timestamps por utterance. Português fixo (`pt`), sem detecção de idioma.
- **Mapeamento de rótulos (A/B/C) para nomes reais** → Gemini (OpenRouter), recebendo a lista
  de participantes e o início da transcrição em texto.
- **Resumo/ata** → fora deste trabalho (não existe etapa de resumo hoje; fica para depois).

Reversível por feature flag `TRANSCRIPTION_PROVIDER=gemini|assemblyai` (default `gemini`).

## Fatos que moldam o design

- Não há banco para transcrições: tudo é JSON no MinIO (`manifests/`, `transcricoes/`, `meta/`).
  A "migration" é adicionar campos **opcionais** ao manifesto; manifestos antigos seguem válidos.
- O worker é um container sem porta exposta, com polling do MinIO a cada 30 s. O webhook cai no
  app Next.js (que já hospeda o webhook do LiveKit) e a entrega ao worker é por marker no MinIO.
- O MinIO é público (o app já redireciona o navegador para URLs assinadas), então a AssemblyAI
  baixa o MP4 direto por URL assinada — sem ffmpeg nem upload pelo nosso servidor no caminho
  principal.
- O frontend consome só `speaker`, `text`, `start` (segundos), `transcriptionStatus`,
  `skippedChunks`, `utteranceCount`. Nada muda nele além de exibir o motivo da falha.

## Verificado na documentação da AssemblyAI (2026-09)

| Item | Valor |
|---|---|
| Endpoint | `POST https://api.assemblyai.com/v2/transcript`, `GET /v2/transcript/{id}`, `POST /v2/upload` |
| Auth | header `Authorization: <api key>` |
| Modelo | `speech_models: ["universal-3-5-pro"]` (`speech_model` singular está deprecado) |
| Idioma | `language_code: "pt"`, `language_detection: false` |
| Diarização | `speaker_labels: true` (exige `punctuate: true`); `speaker_options.{min,max}_speakers_expected` ou `speakers_expected` (só quando o número é certo) |
| Vocabulário | `keyterms_prompt: string[]` — até 1000 termos, 6 palavras por termo (+US$ 0,05/h) |
| Webhook | `webhook_url`, `webhook_auth_header_name`, `webhook_auth_header_value`; POST `{transcript_id, status}` com status `completed`/`error`; exige 2xx em 10 s; até 10 tentativas a cada 10 s; 4xx não retenta; `webhook_status_code` no GET |
| Saída | `status` (`queued`/`processing`/`completed`/`error`), `error`, `text`, `audio_duration` (s), `speech_model_used`, `utterances[]` com `speaker` (A, B, C…), `start`/`end` em **ms**, `text`, `confidence`, `words[]` |
| Add-ons | `summarization` e `auto_chapters` deprecados (erro no 3.5 Pro); `sentiment_analysis`, `entity_detection` desligados |
| Preço | US$ 0,21/h + US$ 0,02/h diarização + US$ 0,05/h keyterms ≈ **US$ 0,28/h** |

## Arquitetura

```
worker/
  transcribe.ts              orquestração: polling MinIO, jobs pendentes, finalização (txt, Drive, manifesto)
  version.ts                 WORKER_VERSION
  config/keyterms.json       vocabulário editável (termos da Legacy + equipe)
  providers/
    types.ts                 TranscriptionProvider, TranscriptionInput, TranscriptionOutcome, TranscriptionResult
    gemini.ts                pipeline atual (chunks + OpenRouter) — sem mudança de comportamento
    assemblyai.ts            submit por URL assinada / upload fallback, poll com backoff, custo
  lib/
    assemblyai.ts            cliente REST (fetchWithTimeout + retry) — puro, testável
    utterances.ts            AssemblyAI utterances (ms) → Utterance (s)
    speakerMap.ts            rótulo → nome via Gemini, com validação
    keyterms.ts              carga/normalização do arquivo de keyterms
    retry.ts                 withBackoff (exponencial, jitter)
  scripts/transcribe-url.ts  validação manual: URL → utterances no terminal
  MIGRATION.md
app/api/transcription/webhook/route.ts   recebe callback, valida secret, grava marker
```

### Interface de provider

```ts
type TranscriptionOutcome =
  | { kind: 'completed'; result: TranscriptionResult }
  | { kind: 'pending'; jobId: string }
  | { kind: 'error'; reason: string; retryable: boolean };

interface TranscriptionProvider {
  readonly name: 'gemini' | 'assemblyai';
  submit(input: TranscriptionInput): Promise<TranscriptionOutcome>;
  poll(job: PendingJob): Promise<TranscriptionOutcome>;
}
```

- `gemini.submit` roda o pipeline inteiro e devolve `completed` (nunca `pending`).
- `assemblyai.submit` cria a transcrição e devolve `pending` com o `transcript_id`.
- `TranscriptionInput` traz `id`, `roomName`, `participants`, `tmpDir` e um `AudioSource`
  (`signedUrl()` e `downloadTo(path)`), para o provider escolher como acessar o áudio.
- `TranscriptionResult`: `utterances` (segundos, rótulos crus), `durationSeconds`, `model`,
  `providerTranscriptId?`, `audioDurationSeconds?`, `skippedChunks`, `skippedChunkDetails`,
  `diagnostics` (speechSeconds etc.), `estimatedCostUsd?`.

### Fluxo (provider assemblyai)

1. Loop acha `com-transcricao/<id>.mp4` pronto (marker `ready/` ou arquivo frio) e sem manifesto.
2. Se existe `asr-jobs/<id>.json`, o job já foi submetido → pula (evita resubmissão e custo em
   restart). Senão: gera URL assinada (12 h), `submit` com webhook, grava o job
   `{ transcriptId, submittedAt, lastCheckedAt, checks }`.
3. A cada ciclo, para cada job: se existe `asr-done/<transcriptId>.json` (escrito pelo webhook)
   → busca o resultado. Senão, consulta `GET /v2/transcript/{id}` quando o backoff permitir
   (60 s → 120 → 240, teto 300 s). Passado `ASSEMBLYAI_MAX_WAIT_MINUTES` (180) → manifesto
   `failed` com `transcriptionError`.
4. `completed` → utterances em segundos → mapeamento de falantes → `normalizeUtterances`
   (funde falas consecutivas) → txt → Drive → manifesto → limpa `asr-jobs/`, `asr-done/`,
   `ready/`, `attempts/`.
5. `error` → manifesto `failed` com o motivo; "Transcrever novamente" reprocessa
   (`requeueTranscription` também apaga `asr-jobs/<id>.json`).

Falha na **submissão** (URL inacessível, 4xx/5xx após retries) lança → cai no contador de
tentativas existente (`MAX_RECORDING_ATTEMPTS`) e depois vira `failed`. Se a AssemblyAI
devolver erro de download da URL, o provider tenta uma vez o fallback: baixa o MP4, extrai o
áudio (ffmpeg) e usa `/v2/upload`.

### Webhook

`POST /api/transcription/webhook?recordingId=<id>`

- Header `X-Legacy-Webhook-Secret` deve bater com `ASSEMBLYAI_WEBHOOK_SECRET` → senão 401
  (4xx: a AssemblyAI não retenta).
- Corpo `{ transcript_id, status }` → grava `asr-done/<transcript_id>.json`
  `{ status, recordingId, at }` e responde 200. Sem processamento pesado (limite de 10 s).
- Sem `ASSEMBLYAI_WEBHOOK_SECRET` configurado, o worker não envia `webhook_url` e funciona só
  com polling (fallback documentado).

### Parâmetros enviados

```json
{
  "audio_url": "<URL assinada do MinIO>",
  "speech_models": ["universal-3-5-pro"],
  "language_code": "pt",
  "language_detection": false,
  "speaker_labels": true,
  "speaker_options": { "max_speakers_expected": <nº de participantes, se conhecido> },
  "punctuate": true,
  "format_text": true,
  "keyterms_prompt": [<keyterms.json> + nomes dos participantes],
  "webhook_url": "<APP_BASE_URL>/api/transcription/webhook?recordingId=<id>",
  "webhook_auth_header_name": "X-Legacy-Webhook-Secret",
  "webhook_auth_header_value": "<ASSEMBLYAI_WEBHOOK_SECRET>"
}
```

Número de falantes: usa `max_speakers_expected` = participantes conhecidos (teto), nunca
`speakers_expected` exato — um participante que não falou faria o modelo dividir uma voz.
Desligável com `ASSEMBLYAI_USE_PARTICIPANT_COUNT=false`. Add-ons
(`ASSEMBLYAI_SENTIMENT`, `ASSEMBLYAI_ENTITIES`) existem como env, default `false`.

### Mapeamento de falantes

`mapSpeakers(labels, participants, sample, llm)`:

- Sem participantes → todos viram `Falante A`, `Falante B`…
- 1 participante e 1 rótulo → mapeia direto.
- Caso geral: envia participantes + primeiros 10 min (máx. 80 utterances, texto truncado a
  200 chars) ao Gemini com JSON schema estrito
  `{ mapping: [{ label, name: enum(participantes + "desconhecido"), confidence: 0..1 }] }`.
- Validação: nome precisa estar na lista; confiança ≥ `SPEAKER_MAP_MIN_CONFIDENCE` (0.7);
  um nome só pode ser atribuído a um rótulo (fica o de maior confiança); o resto mantém o
  rótulo genérico. Erro/timeout do LLM → rótulos genéricos (não bloqueia a transcrição).
- `speakerMap` (rótulo → nome final) vai para o manifesto.

Preparado para faixa por participante no futuro: a interface aceita `TranscriptionInput`
com uma lista de fontes; hoje há uma só. A mesclagem por timestamp já é o que
`normalizeUtterances` faz (ordena por `start`).

### Manifesto (campos novos, todos opcionais)

| Campo | Tipo | Descrição |
|---|---|---|
| `provider` | `'gemini' \| 'assemblyai'` | provider que gerou a transcrição |
| `providerTranscriptId` | `string` | `transcript_id` da AssemblyAI |
| `speechModel` | `string` | `speech_model_used` |
| `workerVersion` | `string` | `WORKER_VERSION` |
| `audioDurationSeconds` | `number` | `audio_duration` (custo) |
| `estimatedCostUsd` | `number` | duração × tarifa |
| `speakerMap` | `Record<string,string>` | rótulo → nome |
| `transcriptionError` | `string` | motivo quando `failed` |

`model` continua existindo (modelo de fala usado). `transcriptionStatus` segue
`'complete' | 'failed'`.

### Logs

Uma linha JSON por evento relevante: `{ evt, recordingId, transcriptId, audioSeconds,
elapsedMs, costUsd }` (`asr_submitted`, `asr_completed`, `asr_failed`, `asr_timeout`).

### Configuração (env)

| Env | Default | Uso |
|---|---|---|
| `TRANSCRIPTION_PROVIDER` | `gemini` | `gemini` ou `assemblyai` |
| `ASSEMBLYAI_API_KEY` | — | obrigatória com `assemblyai` |
| `ASSEMBLYAI_WEBHOOK_SECRET` | — | app + worker; sem ela, só polling |
| `APP_BASE_URL` | — | base do `webhook_url` |
| `ASSEMBLYAI_SPEECH_MODEL` | `universal-3-5-pro` | |
| `ASSEMBLYAI_LANGUAGE_CODE` | `pt` | |
| `ASSEMBLYAI_USE_PARTICIPANT_COUNT` | `true` | `max_speakers_expected` |
| `ASSEMBLYAI_SENTIMENT`, `ASSEMBLYAI_ENTITIES` | `false` | add-ons pagos |
| `ASSEMBLYAI_MAX_WAIT_MINUTES` | `180` | prazo do job |
| `ASSEMBLYAI_TIMEOUT_MS` | `60000` | timeout por chamada |
| `ASSEMBLYAI_RATE_USD_PER_HOUR` | `0.28` | custo estimado |
| `SIGNED_URL_TTL_SECONDS` | `43200` | validade da URL assinada |
| `KEYTERMS_FILE` | `config/keyterms.json` | vocabulário |
| `SPEAKER_MAP_MIN_CONFIDENCE` | `0.7` | |

## Testes

- `lib/assemblyai.test.ts`: corpo do submit (parâmetros exatos), get, 4xx sem retry, 5xx com
  retry/backoff (fake timers), upload.
- `lib/utterances.test.ts`: ms → s, ordenação, vazio.
- `lib/speakerMap.test.ts`: mapeamento válido, confiança baixa, nome duplicado, nome fora da
  lista, JSON inválido, sem participantes.
- `lib/keyterms.test.ts`: carga, dedup, limite de 6 palavras, união com participantes.
- `lib/retry.test.ts`.
- `app/api/transcription/webhook/route.test.ts`: 401, 400, 200 + marker.
- Script manual `worker/scripts/transcribe-url.ts <url>`.

## Rollback

`TRANSCRIPTION_PROVIDER=gemini` + restart do worker. Jobs `asr-jobs/` pendentes são ignorados
pelo provider gemini e a gravação é reprocessada pelo caminho antigo.
