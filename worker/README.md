# Worker de transcrição — Legacy Meet

Serviço independente (Node + ffmpeg) que transcreve as gravações das reuniões.

## Como funciona

1. Faz **polling** no bucket MinIO, na pasta `com-transcricao/` (onde o app salva as
   gravações marcadas para transcrição).
2. Para cada `.mp4` que ainda **não tem** manifesto em `manifests/`:
   - só processa quando o egress terminou: existe o marker `ready/<id>.json`
     (escrito pelo webhook do LiveKit ou pelo retry) **ou** o arquivo está sem
     modificação há `EGRESS_MIN_AGE_SECONDS` (evita transcrever upload parcial);
   - baixa o vídeo do MinIO;
   - extrai o áudio com `ffmpeg` (mono, 16 kHz, mp3 64 kbps);
   - divide em chunks de ~5 min **cortados em pausas de silêncio** (silencedetect);
   - transcreve cada chunk via **OpenRouter** (modelo multimodal, ex. Gemini 2.5 Flash),
     com saída estruturada (speaker + timestamps), schema com **enum dos
     participantes** e as últimas falas do chunk anterior como contexto;
   - normaliza (casa rótulos com nomes reais, funde falas consecutivas) e salva:
     - `transcricoes/<id>.txt` (texto corrido)
     - `manifests/<id>.json` (manifesto com as utterances)
3. A presença do manifesto marca a gravação como "já processada" (não reprocessa).
4. Gravação que falha `MAX_RECORDING_ATTEMPTS` vezes vira manifesto `failed`
   (aparece na UI com o botão "Transcrever novamente") em vez de ficar em loop.

Tem proteção contra alucinação do modelo (descarta chunk com "pile-up" de timestamps
ou saída truncada no limite de tokens).

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

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `S3_ENDPOINT` | sim | — | URL do MinIO |
| `S3_KEY_ID` | sim | — | Access key |
| `S3_KEY_SECRET` | sim | — | Secret key |
| `S3_REGION` | não | `us-east-1` | Região (MinIO aceita qualquer) |
| `S3_BUCKET` | não | `legacy-meet` | Bucket das gravações |
| `OPENROUTER_API_KEY` | sim | — | Chave do OpenRouter |
| `OPENROUTER_MODEL` | não | `google/gemini-2.5-flash` | Modelo multimodal (ex.: `openai/gpt-4o-transcribe`, `mistralai/voxtral-mini-transcribe`) |
| `POLL_INTERVAL_SECONDS` | não | `30` | Intervalo do polling |
| `CHUNK_SECONDS` | não | `300` | Tamanho-alvo do chunk de áudio |
| `EGRESS_MIN_AGE_SECONDS` | não | `120` | Idade mínima do MP4 sem marker `ready/` |
| `SILENCE_NOISE_DB` | não | `-35` | Abaixo disto é silêncio/ruído (guardrail anti-alucinação e cortes) |
| `SILENCE_MIN_SECONDS` | não | `0.5` | Duração mínima para contar como silêncio |
| `MIN_SPEECH_SECONDS_PER_CHUNK` | não | `2` | Chunk com menos fala que isto nem vai para a IA |
| `MIN_SPEECH_RATIO` | não | `0.25` | Fala reportada com menos que esta fração em trechos de fala é descartada |
| `MAX_RECORDING_ATTEMPTS` | não | `3` | Tentativas antes de marcar como `failed` |
| `SOURCE_PREFIX` | não | `com-transcricao/` | Pasta de origem no bucket |
| `OUTPUT_PREFIX` | não | `transcricoes/` | Pasta de destino das transcrições |

> Use um **modelo multimodal** (Gemini, GPT-4o Transcribe, Voxtral) para obter o JSON
> com speaker + timestamps. Modelos de ASR puro (Whisper, Parakeet, Chirp) retornam só
> texto corrido e não seguem o schema estruturado.

## Rodar local (teste)

```bash
cd worker
npm install
# exporte as variáveis acima e:
npm start
```

## Deploy no EasyPanel

1. Crie um novo serviço do tipo **App / Dockerfile** apontando para a pasta `worker/`.
2. Configure as variáveis de ambiente acima (mesmas credenciais do MinIO do app).
3. É um processo contínuo (faz polling) — não precisa expor portas.
