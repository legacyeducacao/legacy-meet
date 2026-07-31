# LiveKit Estabilidade + Transcrição (diarização) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar os falantes fantasma ("Pessoa 1/2/3") e vozes trocadas na transcrição, e tornar as chamadas LiveKit estáveis e eficientes para usuários com máquinas e internet ruins, sem perder qualidade.

**Architecture:** Três fases. (1) Worker de transcrição: lista de participantes fiel por sessão, schema com enum de speakers, contexto entre chunks, corte em silêncio, normalização pós-merge e robustez (idade do MP4, cap de retries). (2) Cliente: tratamento de `DisconnectReason`, overlay de reconexão, retry de conexão, Krisp por padrão, cleanup de ciclo de vida. (3) Tuning de publicação (dtx, screen share, codec por capacidade), auth nos endpoints de gravação e webhook do LiveKit.

**Tech Stack:** Next.js 15 App Router, livekit-client 2.19.1, @livekit/components-react 2.9.21, livekit-server-sdk 2.15.4, worker Node/TS com ffmpeg + OpenRouter (Gemini 2.5 Flash), MinIO (S3), vitest.

## Global Constraints

- Idioma do produto/comentários/commits: **pt-BR** (seguir estilo dos commits existentes: `feat(escopo): ...`, `fix(escopo): ...`).
- Testes: `pnpm test` (vitest na raiz; pega `worker/lib/*.test.ts` também).
- Verificação de tipos: `pnpm exec tsc --noEmit`.
- Nunca quebrar o fluxo atual quando webhook do LiveKit **não** estiver configurado no servidor (fallbacks obrigatórios).
- Sem novas dependências npm.

---

## FASE 1 — Transcrição

### Task 1: Meta de participantes fiel por sessão de gravação

**Files:**
- Modify: `app/api/record/start/route.ts` (bloco de meta, linhas 49–52 e 93–118)
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx` (`handleConnected`)

**Interfaces:**
- Produces: meta `meta/<roomName>.json` com `participants` **resetado** a cada novo egress; merge do nome do caller no caminho 409; POST de participantes no join (além do leave).

- [ ] **Step 1:** Em `app/api/record/start/route.ts`, no caminho 409 (egress já ativo), mesclar o nome do caller no meta antes de retornar:

```ts
if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
  // Já gravando: registra quem entrou agora na lista de participantes desta sessão.
  try {
    const caller = (req.nextUrl.searchParams.get('host') ?? '').trim();
    if (caller) {
      const key = metaKey(roomName);
      const meta = (await readJson<MeetingMeta>(key)) ?? {};
      meta.participants = [...new Set([...(meta.participants ?? []), caller])];
      await writeJson(key, meta);
    }
  } catch (e) {
    console.error('Falha ao registrar participante no meta:', e);
  }
  return new NextResponse('Meeting is already being recorded', { status: 409 });
}
```

- [ ] **Step 2:** No bloco de meta pós-start (linhas 93–118), **resetar** `participants` (não herdar de sessões antigas — era isso que criava falantes a mais com nomes reais) e usar `createdAt` novo:

```ts
const existing = (await readJson<MeetingMeta>(metaKey(roomName))) ?? {};
await writeJson(metaKey(roomName), {
  title: title || dbTitle || existing.title || '',
  host: host || dbHost || existing.host || '',
  createdAt: new Date().toISOString(),
  // RESET por sessão: nomes de reuniões antigas na mesma sala contaminavam o
  // prompt do worker e o modelo "encontrava" gente que não estava presente.
  participants: [...new Set([host, dbHost].filter(Boolean))] as string[],
});
```

- [ ] **Step 3:** Em `PageClientImpl.tsx` `handleConnected`, registrar o próprio nome no meta já no join (hoje só acontece no leave — aba fechada perdia o nome):

```ts
const myName = (props.userChoices.username ?? '').trim();
if (myName) {
  fetch(`/api/record/participants?roomName=${encodeURIComponent(room.name)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ names: [myName] }),
    keepalive: true,
  }).catch(() => {});
}
```

(colocar após `collectParticipants()`, antes do bloco de gravação; vale para host e convidado)

- [ ] **Step 4:** `pnpm exec tsc --noEmit` e `pnpm lint` — sem erros novos.
- [ ] **Step 5:** Commit `fix(transcricao): participantes por sessão de gravação (reset no start + registro no join)`.

### Task 2: Schema com enum de speakers + prompt sem "Pessoa N"

**Files:**
- Modify: `worker/transcribe.ts` (`buildPrompt` l.192, `TRANSCRIPTION_SCHEMA` l.228, `transcribeChunkOnce` l.298, fallback l.674)

**Interfaces:**
- Produces: `buildTranscriptionSchema(participants: string[])` e `buildPrompt(participants: string[])`; fallback de speaker vira `'Desconhecido'`.

- [ ] **Step 1:** Substituir a constante `TRANSCRIPTION_SCHEMA` por uma função — quando há participantes conhecidos, `speaker` vira `enum` (participantes + "Desconhecido"), impedindo o modelo de inventar rótulos:

```ts
function buildTranscriptionSchema(participants: string[]) {
  const speaker = participants.length
    ? { type: 'string', enum: [...participants, 'Desconhecido'] }
    : { type: 'string' };
  return {
    type: 'object',
    properties: {
      utterances: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            speaker,
            text: { type: 'string' },
            start: { type: 'number' },
            end: { type: 'number' },
          },
          required: ['speaker', 'text', 'start', 'end'],
          additionalProperties: false,
        },
      },
    },
    required: ['utterances'],
    additionalProperties: false,
  };
}
```

- [ ] **Step 2:** Novo `speakerSection` no `buildPrompt`:

```ts
const speakerSection = participants.length
  ? `Os participantes desta reunião são EXATAMENTE: ${participants.join(', ')}.
- Use SEMPRE o nome exato de um deles no campo "speaker".
- Só use "Desconhecido" quando realmente não conseguir atribuir a fala a nenhum deles.
- NUNCA invente outros nomes nem rótulos como "Pessoa 1".`
  : `Se houver vozes distintas, use "Pessoa 1", "Pessoa 2", etc, mantendo consistência dentro deste áudio.`;
```

- [ ] **Step 3:** Em `transcribeChunkOnce`, usar `buildTranscriptionSchema(participants)` no `response_format`. No merge (l.674), trocar `'Pessoa 1'` por `'Desconhecido'` como fallback.
- [ ] **Step 4:** `pnpm exec tsc --noEmit` (o worker compila junto? senão `pnpm exec tsc --noEmit -p worker` se houver tsconfig próprio) — sem erros.
- [ ] **Step 5:** Commit `feat(transcricao): enum de speakers no schema + prompt sem "Pessoa N"`.

### Task 3: Contexto entre chunks (rótulos consistentes)

**Files:**
- Modify: `worker/transcribe.ts` (`buildPrompt`, `transcribeChunk`, `transcribeChunkOnce`, loop de `processRecording`)

**Interfaces:**
- Produces: `transcribeChunk(chunkPath, participants, prevTail: Utterance[])`; prompt ganha seção CONTEXTO com as últimas falas do chunk anterior.

- [ ] **Step 1:** `buildPrompt(participants: string[], prevTail: Utterance[] = [])` ganha, antes das regras absolutas:

```ts
const contextSection = prevTail.length
  ? `\nCONTEXTO (NÃO transcrever — apenas referência): este áudio é a CONTINUAÇÃO da mesma reunião. Últimas falas do trecho anterior:\n${prevTail
      .map((u) => `${u.speaker}: ${u.text}`)
      .join('\n')}\nUse os MESMOS rótulos de speaker para as mesmas vozes.\n`
  : '';
```

e inserir `${contextSection}` no template logo após a primeira linha.

- [ ] **Step 2:** Propagar: `transcribeChunkOnce(audioB64, participants, prevTail)` e `transcribeChunk(chunkPath, participants, prevTail)`. No loop de `processRecording`, manter `let prevTail: Utterance[] = []`; após um chunk bem-sucedido com utterances, `prevTail = utterances desse chunk (com speaker/text) .slice(-10)`; chunk pulado mantém o tail anterior.
- [ ] **Step 3:** typecheck + commit `feat(transcricao): contexto entre chunks para manter speakers consistentes`.

### Task 4: Corte de chunks em silêncio (TDD)

**Files:**
- Create: `worker/lib/audioChunks.ts`
- Create: `worker/lib/audioChunks.test.ts`
- Modify: `worker/transcribe.ts` (`runProcess`, `splitAudio`)

**Interfaces:**
- Produces: `parseSilences(log: string): Array<{start:number; end:number}>`; `computeChunkBoundaries(duration: number, silences: Silence[], targetSeconds: number, windowSeconds: number): number[]` (pontos de corte, exclusivos de 0 e duration).

- [ ] **Step 1:** Escrever testes em `worker/lib/audioChunks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeChunkBoundaries, parseSilences } from './audioChunks';

describe('parseSilences', () => {
  it('extrai pares start/end do stderr do silencedetect', () => {
    const log = [
      '[silencedetect @ 0x1] silence_start: 12.5',
      '[silencedetect @ 0x1] silence_end: 13.75 | silence_duration: 1.25',
      '[silencedetect @ 0x1] silence_start: 290.1',
      '[silencedetect @ 0x1] silence_end: 291.0 | silence_duration: 0.9',
    ].join('\n');
    expect(parseSilences(log)).toEqual([
      { start: 12.5, end: 13.75 },
      { start: 290.1, end: 291.0 },
    ]);
  });
  it('ignora silence_start sem end', () => {
    expect(parseSilences('silence_start: 5.0')).toEqual([]);
  });
});

describe('computeChunkBoundaries', () => {
  it('sem silêncio: corta exatamente no alvo', () => {
    expect(computeChunkBoundaries(650, [], 300, 60)).toEqual([300, 600]);
  });
  it('áudio curto: sem cortes', () => {
    expect(computeChunkBoundaries(200, [], 300, 60)).toEqual([]);
  });
  it('corta no meio do silêncio mais próximo do alvo dentro da janela', () => {
    const silences = [{ start: 290.0, end: 292.0 }];
    expect(computeChunkBoundaries(650, silences, 300, 60)).toEqual([291, 591]);
  });
  it('silêncio fora da janela é ignorado', () => {
    const silences = [{ start: 100, end: 101 }];
    expect(computeChunkBoundaries(650, silences, 300, 60)).toEqual([300, 600]);
  });
});
```

- [ ] **Step 2:** Rodar `pnpm test` → falha (módulo não existe).
- [ ] **Step 3:** Implementar `worker/lib/audioChunks.ts`:

```ts
export interface Silence {
  start: number;
  end: number;
}

// Parseia o log do ffmpeg `silencedetect` (vem no stderr).
export function parseSilences(log: string): Silence[] {
  const out: Silence[] = [];
  let pending: number | null = null;
  const re = /silence_(start|end):\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    const v = parseFloat(m[2]);
    if (m[1] === 'start') pending = v;
    else if (pending != null) {
      out.push({ start: pending, end: v });
      pending = null;
    }
  }
  return out;
}

// Pontos de corte a cada ~targetSeconds, puxados para o meio do silêncio mais
// próximo dentro de [alvo-windowSeconds, alvo]. Cortar no meio de uma frase
// confunde o speaker na fronteira do chunk — silêncio é o lugar seguro.
export function computeChunkBoundaries(
  duration: number,
  silences: Silence[],
  targetSeconds: number,
  windowSeconds: number,
): number[] {
  const cuts: number[] = [];
  let prev = 0;
  while (duration - prev > targetSeconds) {
    const target = prev + targetSeconds;
    let cut = target;
    let best = Infinity;
    for (const s of silences) {
      const mid = (s.start + s.end) / 2;
      if (mid <= prev + 1) continue;
      if (mid < target - windowSeconds || mid > target) continue;
      const d = target - mid;
      if (d < best) {
        best = d;
        cut = mid;
      }
    }
    cuts.push(cut);
    prev = cut;
  }
  return cuts;
}
```

- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Em `worker/transcribe.ts`: adicionar `runProcessAll` (igual a `runProcess`, mas resolve `stdout + stderr` e aceita código de saída != 0? Não — ffmpeg com `-f null -` sai 0; manter rejeição em code != 0, resolvendo `stdout + '\n' + stderr`). Adicionar:

```ts
async function detectSilences(audioPath: string): Promise<Silence[]> {
  try {
    const out = await runProcessAll('ffmpeg', [
      '-i', audioPath,
      '-af', 'silencedetect=noise=-35dB:d=0.5',
      '-f', 'null', '-',
    ]);
    return parseSilences(out);
  } catch (e) {
    log(`silencedetect falhou (${e}) — cortes fixos`);
    return [];
  }
}
```

e reescrever `splitAudio` para usar boundaries `[0, ...cuts, duration]`, exportando cada segmento com `-ss <start> -t <len>` (mesmo re-encode mono 16k/64k atual). O `offset` de cada chunk passa a ser o start real (fracionário ok).

- [ ] **Step 6:** typecheck + `pnpm test` + commit `feat(transcricao): corte de chunks alinhado a silêncio (ffmpeg silencedetect)`.

### Task 5: Normalização pós-merge (fuzzy match + fusão de falas) (TDD)

**Files:**
- Create: `worker/lib/speakers.ts`
- Create: `worker/lib/speakers.test.ts`
- Modify: `worker/transcribe.ts` (`processRecording`, antes de gerar `plainText`)

**Interfaces:**
- Produces: `matchSpeaker(label: string, participants: string[]): string`; `normalizeUtterances(utts: Utterance[], participants: string[]): Utterance[]`.

- [ ] **Step 1:** Testes `worker/lib/speakers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { matchSpeaker, normalizeUtterances } from './speakers';

describe('matchSpeaker', () => {
  const parts = ['João Gaspar', 'Maria Silva'];
  it('match exato ignorando caixa/acentos', () => {
    expect(matchSpeaker('joao gaspar', parts)).toBe('João Gaspar');
  });
  it('match por primeiro nome', () => {
    expect(matchSpeaker('Maria', parts)).toBe('Maria Silva');
  });
  it('rótulo desconhecido fica como está', () => {
    expect(matchSpeaker('Pessoa 1', parts)).toBe('Pessoa 1');
    expect(matchSpeaker('Desconhecido', parts)).toBe('Desconhecido');
  });
});

describe('normalizeUtterances', () => {
  it('funde falas consecutivas do mesmo speaker com gap <= 1.5s', () => {
    const out = normalizeUtterances(
      [
        { speaker: 'joao gaspar', text: 'oi', start: 0, end: 1 },
        { speaker: 'João Gaspar', text: 'tudo bem?', start: 1.5, end: 2.5 },
        { speaker: 'Maria', text: 'tudo!', start: 3, end: 4 },
      ],
      ['João Gaspar', 'Maria Silva'],
    );
    expect(out).toEqual([
      { speaker: 'João Gaspar', text: 'oi tudo bem?', start: 0, end: 2.5 },
      { speaker: 'Maria Silva', text: 'tudo!', start: 3, end: 4 },
    ]);
  });
  it('ordena por start e corrige end < start', () => {
    const out = normalizeUtterances(
      [
        { speaker: 'A', text: 'b', start: 10, end: 5 },
        { speaker: 'B', text: 'a', start: 0, end: 1 },
      ],
      [],
    );
    expect(out[0].speaker).toBe('B');
    expect(out[1].end).toBe(10);
  });
});
```

- [ ] **Step 2:** `pnpm test` → falha.
- [ ] **Step 3:** Implementar `worker/lib/speakers.ts`:

```ts
import type { Utterance } from './text';

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

// Mapeia o rótulo devolvido pelo modelo para o nome real mais próximo.
// Conservador de propósito: melhor manter o rótulo do que trocar a pessoa.
export function matchSpeaker(label: string, participants: string[]): string {
  const l = norm(label);
  if (!l || l.length < 3) return label;
  for (const p of participants) if (norm(p) === l) return p;
  for (const p of participants) {
    const first = norm(p).split(/\s+/)[0];
    if (first.length >= 3 && (l === first || l.startsWith(`${first} `))) return p;
  }
  return label;
}

const MERGE_GAP_SECONDS = 1.5;

export function normalizeUtterances(utts: Utterance[], participants: string[]): Utterance[] {
  const mapped = utts
    .map((u) => ({
      ...u,
      speaker: participants.length ? matchSpeaker(u.speaker, participants) : u.speaker,
    }))
    .sort((a, b) => a.start - b.start)
    .map((u) => ({ ...u, end: Math.max(u.end, u.start) }));
  const out: Utterance[] = [];
  for (const u of mapped) {
    const last = out[out.length - 1];
    if (last && last.speaker === u.speaker && u.start - last.end <= MERGE_GAP_SECONDS) {
      last.text = `${last.text} ${u.text}`.trim();
      last.end = Math.max(last.end, u.end);
    } else {
      out.push({ ...u });
    }
  }
  return out;
}
```

- [ ] **Step 4:** `pnpm test` → PASS.
- [ ] **Step 5:** Em `processRecording`, aplicar após montar `allUtts` (nos dois caminhos — reuso de txt e transcrição nova): `const finalUtts = normalizeUtterances(allUtts, participants);` e usar `finalUtts` no txt/manifesto.
- [ ] **Step 6:** typecheck + commit `feat(transcricao): normalização de speakers e fusão de falas consecutivas`.

### Task 6: Robustez do worker (idade do MP4, cap de retries, scripts)

**Files:**
- Modify: `worker/transcribe.ts` (loop `main`, novos helpers)
- Modify: `lib/recordings.ts` (`requeueTranscription`)
- Modify: `scripts/reprocess.mjs`, `scripts/reprocess-big.mjs`

**Interfaces:**
- Produces: objetos `ready/<id>.json` (marker de egress concluído — escrito pelo webhook da Task 12 e pelo requeue) e `attempts/<id>.json` (`{count:number}`).

- [ ] **Step 1:** Worker — não processar MP4 recém-modificado (egress pode estar subindo o arquivo; MP4 parcial = áudio corrompido = alucinação):

```ts
const EGRESS_MIN_AGE_SECONDS = Number(env.EGRESS_MIN_AGE_SECONDS ?? '120');

async function isEgressReady(id: string, lastModified?: Date): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: `ready/${id}.json` }));
    return true;
  } catch {
    /* sem marker — cai na idade */
  }
  const ageSeconds = lastModified ? (Date.now() - lastModified.getTime()) / 1000 : Infinity;
  return ageSeconds >= EGRESS_MIN_AGE_SECONDS;
}
```

No loop `main`, antes de processar: `if (!(await isEgressReady(id, rec.lastModified))) continue;` (sem contar como `processedAny`).

- [ ] **Step 2:** Cap de tentativas — hoje uma gravação quebrada é retentada para sempre (loop de créditos):

```ts
const MAX_RECORDING_ATTEMPTS = Number(env.MAX_RECORDING_ATTEMPTS ?? '3');

async function bumpAttempts(id: string): Promise<number> {
  const key = `attempts/${id}.json`;
  const cur = Number(JSON.parse((await getObjectTextOrNull(key)) ?? '{"count":0}').count ?? 0) + 1;
  await uploadText(key, JSON.stringify({ count: cur }), 'application/json');
  return cur;
}
```

No catch do loop `main`: `const n = await bumpAttempts(id); if (n >= MAX_RECORDING_ATTEMPTS) await writeFailedManifest(rec, String(e));` onde `writeFailedManifest` grava um manifesto mínimo (`transcriptionStatus:'failed'`, `utterances:[]`, `storage:'s3'`, `videoKey:key`, `skippedChunkDetails:[{chunk:0,offsetSeconds:0,reason}]`, demais campos derivados como em `processRecording`) — a gravação aparece como falha na UI e o botão "Transcrever novamente" funciona. Em `processRecording`, após gravar o manifesto com sucesso, apagar `attempts/<id>.json` e `ready/<id>.json` (best-effort).

- [ ] **Step 3:** `lib/recordings.ts` `requeueTranscription`: após apagar manifesto+txt, escrever `ready/<id>.json` (o vídeo acabou de ser garantido em `com-transcricao/` — sem isso o retry esperaria `EGRESS_MIN_AGE_SECONDS`) e apagar `attempts/<id>.json`:

```ts
await writeJson(`ready/${id}.json`, { at: new Date().toISOString(), source: 'requeue' });
await deleteObject(`attempts/${id}.json`);
```

- [ ] **Step 4:** Scripts — apagar também o `.txt` (senão o worker reaproveita a transcrição antiga e o "reprocessamento" devolve o mesmo resultado ruim). Em `scripts/reprocess.mjs` e `scripts/reprocess-big.mjs`, após o delete do manifesto:

```js
await s3.send(new DeleteObjectCommand({Bucket:BUCKET,Key:`transcricoes/${id}.txt`})).catch(()=>{});
await s3.send(new PutObjectCommand({Bucket:BUCKET,Key:`ready/${id}.json`,Body:JSON.stringify({at:new Date().toISOString(),source:'script'}),ContentType:'application/json'}));
```

(`reprocess-big.mjs` precisa importar `PutObjectCommand`.)

- [ ] **Step 5:** typecheck + `pnpm test` + commit `fix(transcricao): guarda de MP4 parcial, cap de retries e reprocesso que apaga o txt`.

---

## FASE 2 — Estabilidade do cliente

### Task 7: DisconnectReason + overlay de reconexão + retry de conexão

**Files:**
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx`

**Interfaces:**
- Produces: estado `connectionLost: null | 'reconnecting' | 'failed'`; `handleOnLeave(reason?: DisconnectReason)`; overlay `ConnectionLostOverlay` (componente local no mesmo arquivo).

- [ ] **Step 1:** Importar `DisconnectReason` de `livekit-client` e `ConnectionStateToast` já cobre reconexão do SDK; adicionar toasts próprios:

```ts
const reconnectingToastId = React.useRef<string | null>(null);
const handleReconnecting = React.useCallback(() => {
  if (!reconnectingToastId.current) {
    reconnectingToastId.current = toast.loading('Conexão instável — reconectando…');
  }
}, []);
const handleReconnected = React.useCallback(() => {
  if (reconnectingToastId.current) {
    toast.dismiss(reconnectingToastId.current);
    reconnectingToastId.current = null;
  }
  toast.success('Conexão restabelecida');
}, []);
```

Registrar/desregistrar `RoomEvent.Reconnecting` e `RoomEvent.Reconnected` no effect principal.

- [ ] **Step 2:** `handleOnLeave` passa a receber o motivo. Saída voluntária/remoção → `/obrigado`; queda de rede → overlay com botão de reconectar (o token vale 12h, dá para reusar):

```ts
const [connectionLost, setConnectionLost] = React.useState<null | 'reconnecting' | 'failed'>(null);

const sendParticipants = React.useCallback(() => {
  collectParticipants();
  const names = [...participantNamesRef.current];
  if (names.length) {
    fetch(`/api/record/participants?roomName=${encodeURIComponent(room.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names }),
      keepalive: true,
    }).catch(() => {});
  }
}, [room, collectParticipants]);

const handleOnLeave = React.useCallback(
  (reason?: DisconnectReason) => {
    sendParticipants();
    // Saída pelo botão, remoção pelo host ou sala encerrada → fluxo normal.
    // Queda de rede/servidor → oferecemos reconectar em vez de ejetar o usuário.
    const voluntary =
      reason === undefined ||
      reason === DisconnectReason.CLIENT_INITIATED ||
      reason === DisconnectReason.PARTICIPANT_REMOVED ||
      reason === DisconnectReason.ROOM_DELETED ||
      reason === DisconnectReason.DUPLICATE_IDENTITY;
    if (voluntary) {
      const isTeam = isHost || isCohost;
      router.push(`/obrigado?room=${encodeURIComponent(room.name)}${isTeam ? '&host=1' : ''}`);
    } else {
      setConnectionLost('failed');
    }
  },
  [router, room, sendParticipants, isHost, isCohost],
);
```

- [ ] **Step 3:** Conexão inicial com retry + reconexão manual:

```ts
const connectRoom = React.useCallback(async () => {
  const attempts = 3;
  for (let i = 1; i <= attempts; i++) {
    try {
      await room.connect(
        props.connectionDetails.serverUrl,
        props.connectionDetails.participantToken,
        connectOptions,
      );
      return;
    } catch (e) {
      if (i === attempts) throw e;
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}, [room, props.connectionDetails, connectOptions]);

const handleManualReconnect = React.useCallback(async () => {
  setConnectionLost('reconnecting');
  try {
    await connectRoom();
    setConnectionLost(null);
    toast.success('Conexão restabelecida');
  } catch (e) {
    console.error(e);
    setConnectionLost('failed');
    toast.error('Ainda sem conexão. Verifique sua internet e tente de novo.');
  }
}, [connectRoom]);
```

No effect principal, trocar `room.connect(...).catch(handleError)` por `connectRoom().catch((error) => { handleError(error); setConnectionLost('failed'); })`.

- [ ] **Step 4:** Overlay (renderizado dentro do container, acima de tudo, quando `connectionLost !== null`) — componente local `ConnectionLostOverlay` com o mesmo visual do `WaitingRoom` (fundo gradiente, logo), título "Conexão perdida", texto "Sua conexão com a reunião caiu. Verifique sua internet e tente reconectar.", botão primário "Reconectar" (desabilitado com spinner quando `'reconnecting'`) chamando `handleManualReconnect`, e botão secundário "Sair da reunião" que faz `router.push('/obrigado?...')` (mesma URL do fluxo voluntário).
- [ ] **Step 5:** `pnpm exec tsc --noEmit` + `pnpm lint` + commit `feat(sala): reconexão em queda de rede (DisconnectReason, retry e overlay)`.

### Task 8: Krisp ativo por padrão (fora do menu de configurações)

**Files:**
- Create: `lib/NoiseFilterBoot.tsx`
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx`

- [ ] **Step 1:** Criar `lib/NoiseFilterBoot.tsx`:

```tsx
'use client';

import React from 'react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';
import { isLowPowerDevice } from './client-utils';

/**
 * Liga o cancelamento de ruído Krisp por padrão, sem depender do menu de
 * configurações (que fica atrás da flag NEXT_PUBLIC_SHOW_SETTINGS_MENU).
 * Em máquinas fracas fica desligado — o filtro custa CPU.
 */
export function NoiseFilterBoot() {
  const { setNoiseFilterEnabled } = useKrispNoiseFilter({
    filterOptions: {
      bufferOverflowMs: 100,
      bufferDropMs: 200,
      quality: 'medium',
      onBufferDrop: () => {
        console.warn('krisp buffer drop — o filtro se desativa sozinho nas versões >= 0.3.2');
      },
    },
  });

  React.useEffect(() => {
    if (!isLowPowerDevice()) setNoiseFilterEnabled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
```

- [ ] **Step 2:** Em `PageClientImpl.tsx`, dentro do bloco `admitted` (junto de `<KeyboardShortcuts />`), montar `{!SHOW_SETTINGS_MENU && <NoiseFilterBoot />}` — quando o menu está ligado, quem ativa o Krisp continua sendo o `MicrophoneSettings` (evita duas instâncias do hook disputando o processor do microfone).
- [ ] **Step 3:** typecheck + lint + commit `feat(sala): cancelamento de ruído Krisp ativo por padrão`.

### Task 9: Ciclo de vida (disconnect no unmount, pagehide, cookie 12h)

**Files:**
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx`
- Modify: `app/api/connection-details/route.ts` (`getCookieExpirationTime`)

- [ ] **Step 1:** Effect só-de-unmount (o `room` é estável — `useMemo` com deps vazias):

```ts
React.useEffect(() => {
  return () => {
    // Navegação client-side (ex.: /obrigado) desmonta o componente sem fechar a
    // conexão — o Room ficava órfão consumindo rede até o servidor perceber.
    room.disconnect().catch(() => {});
  };
}, [room]);
```

- [ ] **Step 2:** `pagehide` com `sendBeacon` (fechar a aba perdia os nomes dos participantes → prompt do worker sem participantes → "Pessoa N"):

```ts
React.useEffect(() => {
  const onPageHide = () => {
    collectParticipants();
    const names = [...participantNamesRef.current];
    if (!names.length) return;
    const blob = new Blob([JSON.stringify({ names })], { type: 'application/json' });
    navigator.sendBeacon(
      `/api/record/participants?roomName=${encodeURIComponent(room.name)}`,
      blob,
    );
  };
  window.addEventListener('pagehide', onPageHide);
  return () => window.removeEventListener('pagehide', onPageHide);
}, [room, collectParticipants]);
```

- [ ] **Step 3:** Cookie do postfix de identidade alinhado ao TTL do token (12h — antes 2h: um reload após 2h gerava identidade nova no meio de reunião longa):

```ts
function getCookieExpirationTime(): string {
  // Alinhado ao TTL do token (12h): se o cookie expirar antes, um reload troca a
  // identidade (nome__postfix) e quebra a reconexão na mesma reunião.
  const now = new Date();
  now.setTime(now.getTime() + 12 * 60 * 60 * 1000);
  return now.toUTCString();
}
```

- [ ] **Step 4:** typecheck + lint + commit `fix(sala): cleanup do Room, sendBeacon no pagehide e cookie de identidade 12h`.

---

## FASE 3 — Tuning LiveKit + segurança

### Task 10: Tuning de publicação para máquinas/redes fracas

**Files:**
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx` (roomOptions/connectOptions)
- Modify: `app/custom/VideoConferenceClientImpl.tsx`
- Modify: `lib/LegacyVideoConference.tsx` (captureOptions do screen share)

- [ ] **Step 1:** `PageClientImpl.tsx` — roomOptions:

```ts
import { ScreenSharePresets } from 'livekit-client';
import { isLowPowerDevice } from '@/lib/client-utils';

let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
// VP9 comprime melhor (menos banda), mas codificar custa mais CPU. Em máquina
// fraca, H.264 (aceleração por hardware quase universal) mantém a chamada fluida.
if (videoCodec === 'vp9' && typeof navigator !== 'undefined' && isLowPowerDevice()) {
  videoCodec = 'h264';
}
if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
  videoCodec = undefined;
}
const publishDefaults: TrackPublishDefaults = {
  // DTX: para de mandar pacotes de áudio no silêncio — economiza banda sem
  // perda perceptível (o bug antigo do SDK que motivou desligar já foi corrigido).
  dtx: true,
  videoSimulcastLayers: props.options.hq
    ? [VideoPresets.h1080, VideoPresets.h720]
    : [VideoPresets.h540, VideoPresets.h216],
  red: !e2eeEnabled,
  videoCodec,
  // Tela compartilhada: 1080p15 com camada baixa de simulcast — texto legível
  // para quem tem banda e algo utilizável para quem não tem.
  screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
  screenShareSimulcastLayers: [ScreenSharePresets.h360fps3],
};
```

e `adaptiveStream: { pixelDensity: 'screen' }` (em vez de `true`).

- [ ] **Step 2:** connectOptions com mais fôlego para redes ruins:

```ts
const connectOptions = React.useMemo((): RoomConnectOptions => {
  return {
    autoSubscribe: true,
    maxRetries: 3,
    peerConnectionTimeout: 20_000,
  };
}, []);
```

- [ ] **Step 3:** `lib/LegacyVideoConference.tsx` — screen share nítido (importar `ScreenSharePresets` de `livekit-client`):

```ts
captureOptions: {
  audio: true,
  selfBrowserSurface: 'include',
  contentHint: 'detail',
  resolution: ScreenSharePresets.h1080fps15.resolution,
},
```

- [ ] **Step 4:** `app/custom/VideoConferenceClientImpl.tsx` — alinhar com o caminho principal: `dtx: true` no publishDefaults, `autoGainControl: false`, e memoizar o key provider (`const keyProvider = useMemo(() => new ExternalE2EEKeyProvider(), []);`) para o `Room` parar de ser recriado a cada render.
- [ ] **Step 5:** typecheck + lint + commit `feat(sala): tuning de publicação (dtx, screen share, codec por CPU, retries de conexão)`.

### Task 11: Autenticação nos endpoints de gravação

**Files:**
- Modify: `lib/livekitAuth.ts` (exportar verificação de token de sala)
- Modify: `app/api/record/start/route.ts`, `app/api/record/stop/route.ts`
- Modify: `app/rooms/[roomName]/PageClientImpl.tsx` (token no start automático + wrapper do SettingsMenu)
- Modify: `lib/SettingsMenu.tsx` (prop `participantToken`, token nas chamadas)
- Modify: `app/custom/VideoConferenceClientImpl.tsx` (wrapper do SettingsMenu)

**Interfaces:**
- Produces: `verifyRoomToken(token: string | undefined, roomName: string): LivekitPayload | null` em `lib/livekitAuth.ts` (payload com `video.roomJoin === true` e sala correta); `SettingsMenuProps.participantToken?: string`.

- [ ] **Step 1:** `lib/livekitAuth.ts` — ampliar o tipo e exportar:

```ts
type LivekitPayload = {
  sub?: string;
  exp?: number;
  video?: { room?: string; roomAdmin?: boolean; roomJoin?: boolean };
};

/** Token de PARTICIPANTE válido para a sala (prova que quem chama está na reunião). */
export function verifyRoomToken(token: string | undefined, roomName: string): LivekitPayload | null {
  const payload = verifyLivekitPayload(token, roomName);
  return payload?.video?.roomJoin === true ? payload : null;
}
```

- [ ] **Step 2:** `start/route.ts`: substituir o comentário CAUTION por exigência de token de participante:

```ts
const token = req.nextUrl.searchParams.get('token') ?? undefined;
if (!verifyRoomToken(token, roomName)) {
  return new NextResponse('Não autorizado', { status: 401 });
}
```

`stop/route.ts`: exigir host (hostKey/roomAdmin/staff/cohost):

```ts
const token = req.nextUrl.searchParams.get('token') ?? undefined;
const authorized = await authorizeHostAction(req, roomName, { participantToken: token });
if (!authorized) return new NextResponse('Não autorizado', { status: 401 });
```

- [ ] **Step 3:** `PageClientImpl.tsx` `handleConnected`: `params.set('token', props.connectionDetails.participantToken)` no start automático. `SettingsMenu`: nova prop `participantToken?: string`, anexada como `&token=` nas URLs de `/start` e `/stop`. Nos dois pages, passar via wrapper memoizado:

```ts
const SettingsWithToken = React.useMemo(() => {
  if (!SHOW_SETTINGS_MENU) return undefined;
  const token = props.connectionDetails.participantToken;
  const Comp = () => <SettingsMenu participantToken={token} />;
  return Comp;
}, [props.connectionDetails.participantToken]);
```

(`/custom` usa `props.token`.)

- [ ] **Step 4:** typecheck + lint + commit `fix(gravacao): endpoints start/stop exigem token da sala (start) e host (stop)`.

### Task 12: Webhook do LiveKit (participant_joined + egress_ended)

**Files:**
- Create: `app/api/livekit/webhook/route.ts`
- Modify: `worker/README.md` (instruções do livekit.yaml)

**Interfaces:**
- Consumes: markers `ready/<id>.json` (worker Task 6 já os lê) e meta `meta/<roomName>.json`.

- [ ] **Step 1:** Criar a rota:

```ts
import { WebhookReceiver } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { metaKey, readJson, writeJson, type MeetingMeta } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

// Webhook do LiveKit (configurar em livekit.yaml → webhook.urls). Valida a
// assinatura JWT do próprio LiveKit — sem ela a requisição é recusada.
export async function POST(req: NextRequest) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return new NextResponse('LiveKit não configurado', { status: 500 });
  }
  let event;
  try {
    const receiver = new WebhookReceiver(LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
    event = await receiver.receive(await req.text(), req.headers.get('Authorization') ?? undefined);
  } catch {
    return new NextResponse('assinatura inválida', { status: 401 });
  }

  try {
    if (event.event === 'participant_joined') {
      // Registro confiável de participantes no servidor (o POST do navegador é
      // best-effort e se perde quando a aba fecha).
      const roomName = event.room?.name;
      const name = event.participant?.name?.trim();
      const identity = event.participant?.identity ?? '';
      if (roomName && name && !identity.startsWith('EG_')) {
        const key = metaKey(roomName);
        const meta = (await readJson<MeetingMeta>(key)) ?? {};
        meta.participants = [...new Set([...(meta.participants ?? []), name])];
        await writeJson(key, meta);
      }
    } else if (event.event === 'egress_ended') {
      // Marker que libera o worker imediatamente (sem ele, o worker espera o
      // arquivo "esfriar" por EGRESS_MIN_AGE_SECONDS antes de processar).
      const filename = event.egressInfo?.fileResults?.[0]?.filename ?? '';
      const m = filename.match(/([^/\\]+)\.mp4$/i);
      if (m) {
        await writeJson(`ready/${m[1]}.json`, { at: new Date().toISOString(), source: 'webhook' });
      }
    }
  } catch (e) {
    console.error('webhook livekit:', e);
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2:** `worker/README.md` — seção nova documentando: o worker processa um MP4 quando existe `ready/<id>.json` **ou** quando o arquivo está sem modificação há `EGRESS_MIN_AGE_SECONDS` (default 120s); para o caminho rápido, configurar no servidor LiveKit:

```yaml
webhook:
  api_key: <LIVEKIT_API_KEY>
  urls:
    - https://meet.legacyexecutoria.com.br/api/livekit/webhook
```

- [ ] **Step 3:** typecheck + lint + `pnpm test` + commit `feat(infra): webhook do LiveKit (participantes confiáveis + egress_ended libera transcrição)`.

---

## Verificação final

- [ ] `pnpm test` — todos verdes.
- [ ] `pnpm exec tsc --noEmit` — sem erros.
- [ ] `pnpm lint` — sem erros novos.
- [ ] `pnpm build` — build de produção OK.

## Self-Review (feito na escrita)

- Cobertura: todas as causas-raiz do diagnóstico têm task (participantes contaminados→T1, string livre→T2, chunks independentes→T3, corte cego→T4, sem normalização→T5, race/loop/scripts→T6, DisconnectReason/retry→T7, Krisp→T8, cleanup/cookie→T9, dtx/screenshare/codec→T10, auth CAUTION→T11, webhook→T12).
- Tipos consistentes: `Utterance` vem de `worker/lib/text.ts` no worker e `lib/recordings.ts` no app; `verifyRoomToken` definida em T11 e usada apenas em T11; markers `ready/`+`attempts/` definidos em T6, consumidos em T6/T12.
- Fora de escopo (registrado para depois): migração da diarização para faixas de áudio por participante (TrackEgress) — mudança de arquitetura maior, planejar separadamente.
