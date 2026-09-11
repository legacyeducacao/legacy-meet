# Transcrição com AssemblyAI — Implementation Plan

> Spec: `docs/superpowers/specs/2026-09-11-transcricao-assemblyai-design.md`. Um commit por task.

**Goal:** Trocar o motor de transcrição/diarização do worker por AssemblyAI (Universal-3.5 Pro),
mantendo o Gemini só para mapear rótulos → nomes, com feature flag reversível.

**Tech Stack:** Node 20, TypeScript ESM, tsx, vitest, `@aws-sdk/client-s3` + `s3-request-presigner`,
REST AssemblyAI via `fetchWithTimeout`, OpenRouter (Gemini) via fetch.

## Global Constraints

- Worker é pacote próprio (`worker/`, npm). Testes rodam pela raiz (`pnpm test`, vitest pega
  `worker/lib/*.test.ts`) e typecheck `cd worker && npx tsc --noEmit`.
- `transcribe.ts` executa `void main()` ao importar — testes só importam `worker/lib/*` e
  `worker/providers/*` (que não têm efeito colateral na importação).
- Com `TRANSCRIPTION_PROVIDER=gemini` (default) o comportamento é idêntico ao atual.
- Nunca commitar chave. `.env.example` atualizado.
- Commits em pt-BR, estilo `feat(escopo): ...`.

## Tasks

### Task 1: Interface de provider + extração do pipeline Gemini (sem mudança de comportamento)
- Create `worker/version.ts`, `worker/providers/types.ts`, `worker/providers/gemini.ts`.
- Modify `worker/transcribe.ts`: `processRecording` vira submit → finalize; loop trata `pending`.
- `worker/tsconfig.json` inclui `providers/` e `scripts/`.
- Verify: `tsc --noEmit`, `pnpm test`.
- Commit: `refactor(worker): interface de provider e flag TRANSCRIPTION_PROVIDER`.

### Task 2: Cliente REST AssemblyAI + retry + keyterms (TDD)
- Create `worker/lib/retry.ts` (+test), `worker/lib/assemblyai.ts` (+test),
  `worker/lib/keyterms.ts` (+test), `worker/config/keyterms.json`, `worker/lib/utterances.ts` (+test).
- Commit: `feat(worker): cliente AssemblyAI, retry com backoff e keyterms`.

### Task 3: Provider assemblyai (submit por URL assinada, jobs, polling, custo)
- Create `worker/providers/assemblyai.ts`. Modify `worker/transcribe.ts` (jobs em `asr-jobs/`,
  marker `asr-done/`, deadline, logs JSON, presigner).
- `worker/package.json`: dep `@aws-sdk/s3-request-presigner`.
- Commit: `feat(worker): provider assemblyai com jobs assincronos e polling de fallback`.

### Task 4: Webhook no app
- Create `app/api/transcription/webhook/route.ts` (+test).
- Commit: `feat(api): webhook da AssemblyAI grava marker no MinIO`.

### Task 5: Mapeamento de falantes via Gemini
- Create `worker/lib/speakerMap.ts` (+test). Wire no finalize (só para assemblyai).
- Commit: `feat(worker): mapeamento de rotulos A/B/C para participantes via Gemini`.

### Task 6: Manifesto, requeue e UI mínima
- Modify `lib/recordings.ts` (tipo + requeue apaga `asr-jobs/`), `RecordingDetail.tsx`
  (motivo da falha).
- Commit: `feat(gravacoes): campos de rastreabilidade no manifesto e requeue limpa job`.

### Task 7: Script de validação manual
- Create `worker/scripts/transcribe-url.ts`.
- Commit: `feat(worker): script manual de transcricao por URL`.

### Task 8: Docs
- Create `worker/MIGRATION.md`. Modify `worker/README.md`, `.env.example`, Dockerfile (copia
  `providers/`, `config/`).
- Commit: `docs(worker): migracao para AssemblyAI`.
