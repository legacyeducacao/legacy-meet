# Migração da transcrição: Gemini → AssemblyAI (Universal-3.5 Pro)

Desde o worker 2.0 a transcrição + diarização pode ser feita pela AssemblyAI. O mapeamento
dos rótulos de voz (A, B, C) para os nomes dos participantes também roda na AssemblyAI, pelo
LLM Gateway dela (mesma chave, modelo `gemini-2.5-flash-lite` por padrão). Com a flag em
`assemblyai`, o OpenRouter não é mais usado. A troca é por feature flag e reversível.

## 1. Configurar a chave

1. Crie uma API key em https://www.assemblyai.com/app (projeto próprio para o Legacy Meet).
2. No serviço do **worker** (EasyPanel), adicione:

```
TRANSCRIPTION_PROVIDER=assemblyai
ASSEMBLYAI_API_KEY=<chave>
APP_BASE_URL=https://meet.legacyexecutoria.com.br
ASSEMBLYAI_WEBHOOK_SECRET=<string aleatória longa, ex. openssl rand -hex 32>
```

3. No serviço do **app** (Next.js), adicione o mesmo `ASSEMBLYAI_WEBHOOK_SECRET`.
4. Reinicie os dois serviços. No log do worker deve aparecer
   `provider=assemblyai` e `webhook=on`.

Nunca commite a chave. `.env.example` lista todas as variáveis.

## 2. Como funciona depois da flag

1. O worker acha o MP4 em `com-transcricao/`, gera uma URL assinada do MinIO (12 h) e cria a
   transcrição na AssemblyAI (`speech_models: ["universal-3-5-pro"]`, `language_code: pt`,
   diarização, keyterms de `config/keyterms.json` + nomes dos participantes). Nada passa
   pelo servidor: a AssemblyAI baixa direto do MinIO.
2. O job fica em `asr-jobs/<id>.json`. Se o worker reiniciar, não resubmete.
3. Quando termina, a AssemblyAI chama `POST /api/transcription/webhook` no app, que grava
   `asr-done/<transcript_id>.json`. O worker vê o marker no próximo ciclo (30 s), busca o
   resultado, mapeia falantes pelo LLM Gateway da AssemblyAI, grava txt + manifesto e
   arquiva no Drive (o MP4 sai do MinIO só depois disso, como antes).
4. Sem webhook (secret ou `APP_BASE_URL` ausentes), o worker consulta a API sozinho: 60 s,
   120 s, 240 s… até 5 min entre consultas. Funciona, só demora um pouco mais.
5. Passados `ASSEMBLYAI_MAX_WAIT_MINUTES` (180) sem resposta, a gravação vira `failed` com
   o motivo no manifesto e o botão "Transcrever novamente" na tela.

Custo de referência: US$ 0,21/h (modelo) + 0,02 (diarização) + 0,05 (keyterms) ≈
**US$ 0,28 por hora de áudio**. Cada manifesto grava `audioDurationSeconds` e
`estimatedCostUsd`; o log JSON `transcription_completed` traz `costUsd`.

## 3. Validar antes de virar em produção

Com a flag ainda em `gemini`, teste uma reunião real onde o Gemini errava:

```bash
cd worker
npm install
ASSEMBLYAI_API_KEY=... \
  npx tsx scripts/transcribe-url.ts "<URL assinada do MP4>" --participants "Nome A,Nome B"
```

Para obter a URL assinada de uma gravação que ainda está no MinIO, abra a gravação no app
e copie a URL para onde `/api/recordings/<id>/video` redireciona (ou gere com o `mc`).
O script imprime `[mm:ss] Falante: texto` e o mapeamento usado.

## 4. Reprocessar reuniões antigas

- **Uma reunião:** abra a gravação no app → "Transcrever novamente". O app devolve o vídeo
  para `com-transcricao/` (baixando do Drive se preciso), apaga manifesto/txt/job e o
  worker reprocessa com o provider atual da flag.
- **Várias:** repita pela tela ou chame `POST /api/recordings/<id>/retry` logado. O worker
  processa uma por ciclo; 1h30 de áudio leva alguns minutos na AssemblyAI.
- O worker **reaproveita** `transcricoes/<id>.txt` quando ele existe (economia de créditos).
  Para forçar nova transcrição, use o "Transcrever novamente" (ele apaga o txt) — não
  apague só o manifesto à mão.

Manifestos antigos (`provider` ausente) continuam válidos; o front trata todos os campos
novos como opcionais.

## 5. Voltar para o Gemini

1. No worker: `TRANSCRIPTION_PROVIDER=gemini` (ou remova a variável) e reinicie.
2. `OPENROUTER_API_KEY` precisa estar configurada (o provider `gemini` transcreve por ela).
3. Jobs pendentes em `asr-jobs/` são descartados e as gravações voltam para a fila do
   pipeline antigo (contam no cap de tentativas).
4. O webhook do app pode ficar configurado — sem jobs, nunca é chamado.

## 6. Ajustes finos

| Env | Default | Quando mexer |
|---|---|---|
| `ASSEMBLYAI_USE_PARTICIPANT_COUNT` | `true` | `false` se reuniões com gente sem nome registrado estiverem juntando vozes |
| `SPEAKER_MAP_MIN_CONFIDENCE` | `0.7` | Subir se aparecer nome errado; baixar se ficar muito "Falante A" |
| `SPEAKER_MAP_MODEL` | `gemini-2.5-flash-lite` | Outro modelo do LLM Gateway da AssemblyAI (ex.: `claude-haiku`) |
| `SPEAKER_MAP_VIA` | `assemblyai` | `openrouter` para mapear pelo OpenRouter (exige `OPENROUTER_API_KEY`) |
| `KEYTERMS_FILE` | `config/keyterms.json` | Apontar para um arquivo montado no container para editar sem rebuild |
| `ASSEMBLYAI_SENTIMENT` / `ASSEMBLYAI_ENTITIES` | `false` | Add-ons pagos; o resumo continua no LLM |
| `ASSEMBLYAI_MAX_WAIT_MINUTES` | `180` | Prazo para marcar `failed` |

## 7. Depuração

- Log JSON por reunião: `transcription_submitted`, `speaker_map`, `transcription_completed`,
  `transcription_failed`, `transcription_timeout` (campos `recordingId`, `transcriptId`,
  `audioSeconds`, `elapsedMs`, `costUsd`).
- O manifesto de uma falha traz `transcriptionError`. Erros comuns:
  - `Download error` / URL inacessível: MinIO não está acessível de fora ou a URL expirou.
    Na retentativa o worker sobe o áudio pela API de upload (fallback automático).
  - `assemblyai 401`: chave inválida.
  - `sem resposta do provider em N min`: veja `webhook_status_code` no painel da AssemblyAI
    e se o app respondeu 2xx ao webhook.
