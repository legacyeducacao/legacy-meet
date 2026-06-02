# Worker de transcrição — Legacy Meet

Serviço independente (Node + ffmpeg) que transcreve as gravações das reuniões.

## Como funciona

1. Faz **polling** no bucket MinIO, na pasta `com-transcricao/` (onde o app salva as
   gravações marcadas para transcrição).
2. Para cada `.mp4` que ainda **não tem** transcrição em `transcricoes/`:
   - baixa o vídeo do MinIO;
   - extrai o áudio com `ffmpeg` (mono, 16 kHz, mp3 64 kbps);
   - divide em chunks de 5 min;
   - transcreve cada chunk via **OpenRouter** (modelo multimodal, ex. Gemini 2.5 Flash),
     com saída estruturada (speaker + timestamps);
   - junta tudo e salva no próprio bucket:
     - `transcricoes/<nome>.json` (utterances com speaker/start/end)
     - `transcricoes/<nome>.txt` (texto corrido)
3. A presença do `.json` marca a gravação como "já transcrita" (não reprocessa).

Tem proteção contra alucinação do modelo (descarta chunk com "pile-up" de timestamps
ou saída truncada no limite de tokens).

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
| `CHUNK_SECONDS` | não | `300` | Tamanho do chunk de áudio |
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
