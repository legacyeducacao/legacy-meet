# Worker de transcrição — Legacy Meet

Serviço independente (Node + ffmpeg) que transcreve as gravações das reuniões.

## Como funciona

1. Faz **polling** no bucket MinIO, na pasta `com-transcricao/` (onde o app salva as
   gravações marcadas para transcrição).
2. Para cada `.mp4` que ainda **não tem** manifesto em `manifests/`:
   - só processa quando o egress terminou: existe o marker `ready/<id>.json`
     (escrito pelo webhook do LiveKit ou pelo retry) **ou** o arquivo está sem
     modificação há `EGRESS_MIN_AGE_SECONDS` (evita transcrever upload parcial);
   - entrega o áudio ao **provider** escolhido em `TRANSCRIPTION_PROVIDER`:
     - **`assemblyai`** (recomendado): ASR dedicado com diarização acústica. O worker
       gera uma URL assinada do MinIO e a AssemblyAI baixa o MP4 direto; o resultado
       chega por webhook (`/api/transcription/webhook` no app) ou polling. Rótulos
       A/B/C são mapeados para os participantes por um LLM no **LLM Gateway da
       própria AssemblyAI** (mesma chave). Ver `MIGRATION.md`.
     - **`gemini`** (padrão, caminho antigo): baixa o vídeo, extrai o áudio com
       `ffmpeg`, divide em chunks de ~5 min cortados em silêncio e transcreve cada
       chunk via **OpenRouter** (modelo multimodal), com guardrails anti-alucinação.
   - normaliza (casa rótulos com nomes reais, funde falas consecutivas) e salva:
     - `transcricoes/<id>.txt` (texto corrido)
     - `manifests/<id>.json` (manifesto com as utterances)
3. A presença do manifesto marca a gravação como "já processada" (não reprocessa).
4. Gravação que falha `MAX_RECORDING_ATTEMPTS` vezes vira manifesto `failed`
   (aparece na UI com o botão "Transcrever novamente") em vez de ficar em loop.

## Webhook do LiveKit (recomendado)

O app expõe `POST /api/livekit/webhook`. Configurado no servidor LiveKit, ele:

- registra os **participantes** de forma confiável (evento `participant_joined`) —
  melhora a identificação de speakers na transcrição;
- escreve o marker `ready/<id>.json` quando o egress termina (`egress_ended`),
  liberando a transcrição na hora (sem esperar o arquivo "esfriar").

No `livekit.yaml` do servidor:

```yaml
webhook:
  api_key: <LIVEKIT_API_KEY>
  urls:
    - https://meet.legacyexecutoria.com.br/api/livekit/webhook
```

Sem o webhook tudo continua funcionando — o worker só espera
`EGRESS_MIN_AGE_SECONDS` antes de processar cada gravação.

## Webhook da AssemblyAI

Com `TRANSCRIPTION_PROVIDER=assemblyai`, o worker pede à AssemblyAI que chame
`POST <APP_BASE_URL>/api/transcription/webhook?recordingId=<id>` ao terminar, com o
header `X-Legacy-Webhook-Secret: <ASSEMBLYAI_WEBHOOK_SECRET>`. O app valida o secret e
grava `asr-done/<transcript_id>.json`; o worker finaliza no ciclo seguinte. Sem secret
ou `APP_BASE_URL`, o worker consulta a API com backoff (60 s → 5 min) — fallback
documentado, só mais lento.

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `S3_ENDPOINT` | sim | — | URL do MinIO (precisa ser acessível pela AssemblyAI quando `assemblyai`) |
| `S3_KEY_ID` | sim | — | Access key |
| `S3_KEY_SECRET` | sim | — | Secret key |
| `S3_REGION` | não | `us-east-1` | Região (MinIO aceita qualquer) |
| `S3_BUCKET` | não | `legacy-meet` | Bucket das gravações |
| `TRANSCRIPTION_PROVIDER` | não | `gemini` | `gemini` ou `assemblyai` |
| `OPENROUTER_API_KEY` | com `gemini` | — | Chave do OpenRouter (só o provider `gemini`) |
| `OPENROUTER_MODEL` | não | `google/gemini-2.5-flash` | Modelo multimodal do provider `gemini` |
| `ASSEMBLYAI_API_KEY` | com `assemblyai` | — | Chave da AssemblyAI |
| `ASSEMBLYAI_WEBHOOK_SECRET` | não | — | Secret do webhook (mesmo valor no app). Sem ele: só polling |
| `APP_BASE_URL` | não | — | Base pública do app para montar o `webhook_url` |
| `ASSEMBLYAI_SPEECH_MODEL` | não | `universal-3-5-pro` | Modelo de fala |
| `ASSEMBLYAI_LANGUAGE_CODE` | não | `pt` | Idioma fixo (sem detecção automática) |
| `ASSEMBLYAI_USE_PARTICIPANT_COUNT` | não | `true` | Envia nº de participantes como teto de falantes |
| `ASSEMBLYAI_SENTIMENT` / `ASSEMBLYAI_ENTITIES` | não | `false` | Add-ons pagos da AssemblyAI |
| `ASSEMBLYAI_MAX_WAIT_MINUTES` | não | `180` | Prazo do job antes de `failed` |
| `ASSEMBLYAI_POLL_MIN_SECONDS` / `ASSEMBLYAI_POLL_MAX_SECONDS` | não | `60` / `300` | Backoff do polling de fallback |
| `ASSEMBLYAI_TIMEOUT_MS` | não | `60000` | Timeout por chamada à API |
| `ASSEMBLYAI_RATE_USD_PER_HOUR` | não | tabela pública | Tarifa fixa para o custo estimado |
| `SIGNED_URL_TTL_SECONDS` | não | `43200` | Validade da URL assinada entregue à AssemblyAI |
| `TRANSCRIPTION_DONE_PREFIX` | não | `asr-done/` | Prefixo do marker do webhook (mesmo valor no app) |
| `KEYTERMS_FILE` | não | `config/keyterms.json` | Vocabulário (`keyterms_prompt`) |
| `SPEAKER_MAP_MIN_CONFIDENCE` | não | `0.7` | Confiança mínima para trocar "Falante A" por um nome |
| `SPEAKER_MAP_VIA` | não | `assemblyai` com `assemblyai`, senão `openrouter` | Onde roda o LLM do mapeamento de falantes |
| `SPEAKER_MAP_MODEL` | não | `gemini-2.5-flash-lite` (gateway) / `OPENROUTER_MODEL` | Modelo do mapeamento de falantes |
| `POLL_INTERVAL_SECONDS` | não | `30` | Intervalo do polling no MinIO |
| `CHUNK_SECONDS` | não | `300` | Tamanho-alvo do chunk de áudio (`gemini`) |
| `EGRESS_MIN_AGE_SECONDS` | não | `120` | Idade mínima do MP4 sem marker `ready/` |
| `SILENCE_NOISE_DB` | não | `-35` | Abaixo disto é silêncio/ruído (`gemini`) |
| `SILENCE_MIN_SECONDS` | não | `0.5` | Duração mínima para contar como silêncio (`gemini`) |
| `MIN_SPEECH_SECONDS_PER_CHUNK` | não | `2` | Chunk com menos fala que isto nem vai para a IA (`gemini`) |
| `MIN_SPEECH_RATIO` | não | `0.25` | Fala reportada em silêncio é descartada (`gemini`) |
| `MAX_RECORDING_ATTEMPTS` | não | `3` | Tentativas antes de marcar como `failed` |
| `SOURCE_PREFIX` | não | `com-transcricao/` | Pasta de origem no bucket |
| `OUTPUT_PREFIX` | não | `transcricoes/` | Pasta de destino das transcrições |

## Estrutura

```
transcribe.ts          orquestração (polling, jobs assíncronos, txt, Drive, manifesto)
providers/types.ts     interface TranscriptionProvider
providers/gemini.ts    pipeline em chunks via OpenRouter (rollback)
providers/assemblyai.ts submit por URL assinada, polling, custo
lib/assemblyai.ts      cliente REST da AssemblyAI
lib/speakerMap.ts      rótulo A/B/C → nome via LLM
lib/chatJson.ts        chamada texto→JSON (LLM Gateway da AssemblyAI ou OpenRouter)
config/keyterms.json   vocabulário da Legacy (editável)
scripts/transcribe-url.ts  teste manual: URL → utterances
MIGRATION.md           como ativar/reverter a AssemblyAI
```

## Rodar local (teste)

```bash
cd worker
npm install
# exporte as variáveis acima e:
npm start
# testes
npm test
```

## Deploy no EasyPanel

1. Crie um novo serviço do tipo **App / Dockerfile** apontando para a pasta `worker/`.
2. Configure as variáveis de ambiente acima (mesmas credenciais do MinIO do app).
3. É um processo contínuo (faz polling) — não precisa expor portas.
