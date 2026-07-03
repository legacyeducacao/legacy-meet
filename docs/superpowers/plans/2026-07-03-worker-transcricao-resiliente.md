# Worker de transcrição resiliente + recuperação de backlog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o worker de transcrição à prova de falha (timeouts, Drive nunca derruba o fluxo, sem loop de reprocesso, sem pastas duplicadas) e recuperar todo o backlog preso no MinIO, migrando pro Drive quando ele voltar.

**Architecture:** Extrair a lógica testável de `worker/transcribe.ts` para módulos pequenos em `worker/lib/` (`text.ts`, `http.ts`, `drive.ts`), adicionar vitest ao pacote do worker, e então reescrever `processRecording` + o loop principal para: arquivar no Drive dentro de try/catch com fallback `s3`, escrever o manifesto **sempre**, reaproveitar `transcricoes/{id}.txt` existente em vez de re-transcrever, e reconciliar/migrar gravações `s3` pro Drive a cada ciclo.

**Tech Stack:** Node 20, TypeScript (ESM, `type: module`), tsx, vitest, `@aws-sdk/client-s3`, OpenRouter (fetch), Google Drive REST (fetch), ffmpeg/ffprobe.

## Global Constraints

- Diretório de trabalho do worker: `worker/` (pacote npm próprio, `package-lock.json`; **não** é o pnpm da raiz).
- ESM: imports sem extensão (`./lib/text`), resolvidos por tsx/vitest/tsc (`moduleResolution: Bundler`).
- `transcribe.ts` roda `void main()` ao ser importado — **nenhum** teste pode importar `transcribe.ts`; testes importam só os módulos de `worker/lib/`.
- Logs em horário de São Paulo via `toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })` (padrão já existente).
- Bucket padrão `legacy-meet`; prefixos: origem `com-transcricao/`, saída `transcricoes/`, manifesto `manifests/`, meta `meta/`.
- Nome de pasta no Drive: `formatDateTimeBR(createdAt) - (title || roomName)` (padrão já existente).
- `transcriptionStatus` permanece `'complete' | 'failed'` (não introduzir `'partial'` — o tipo `RecordingManifest` em `lib/recordings.ts` e o front não mudam).
- Timeouts default: `OPENROUTER_TIMEOUT_MS=180000`, `DRIVE_TIMEOUT_MS=120000`.
- Após qualquer mudança em `worker/`, o typecheck `cd worker && npx tsc --noEmit` deve passar.

## File Structure

- Create: `worker/lib/text.ts` — `Utterance`, `utterancesToPlainText`, `parsePlainTextToUtterances` (puro).
- Create: `worker/lib/text.test.ts`
- Create: `worker/lib/http.ts` — `TimeoutError`, `fetchWithTimeout`.
- Create: `worker/lib/http.test.ts`
- Create: `worker/lib/drive.ts` — `getDriveAccessToken`, `driveCreateFolder`, `driveUploadFile`, `driveFindOrCreateFolder`, `driveFindFileInFolder` (todas param-based, usando `fetchWithTimeout`).
- Create: `worker/lib/drive.test.ts`
- Modify: `worker/package.json` — devDep `vitest`, script `test`.
- Modify: `worker/transcribe.ts` — importar de `./lib/*`, remover cópias locais, wire timeouts, reescrever `processRecording`, adicionar `reconcileS3Recordings` no loop.

---

### Task 1: Módulo `text.ts` (formatar/parsear transcrição) + testes

**Files:**
- Create: `worker/lib/text.ts`
- Create: `worker/lib/text.test.ts`
- Modify: `worker/package.json`
- Modify: `worker/transcribe.ts` (remover `Utterance` e `utterancesToPlainText` locais; importar de `./lib/text`)

**Interfaces:**
- Produces:
  - `interface Utterance { speaker: string; text: string; start: number; end: number }`
  - `function utterancesToPlainText(utts: Utterance[]): string`
  - `function parsePlainTextToUtterances(txt: string): Utterance[]`

- [ ] **Step 1: Adicionar vitest ao worker**

Editar `worker/package.json`, na seção `scripts` adicionar `"test": "vitest run"`, e em `devDependencies` adicionar `"vitest": "^3.2.4"`. Resultado do bloco `scripts` e `devDependencies`:

```json
  "scripts": {
    "start": "tsx transcribe.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
```

- [ ] **Step 2: Instalar**

Run: `cd worker && npm install`
Expected: instala `vitest`, sem erros.

- [ ] **Step 3: Escrever o teste que falha**

Create `worker/lib/text.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePlainTextToUtterances, utterancesToPlainText } from './text';

describe('utterancesToPlainText', () => {
  it('formata start com 1 casa, speaker e texto', () => {
    const out = utterancesToPlainText([{ speaker: 'Ana', text: 'Oi', start: 0, end: 1 }]);
    expect(out).toBe('[0.0s] Ana: Oi');
  });
});

describe('parsePlainTextToUtterances', () => {
  it('parseia uma linha simples (end = start na última)', () => {
    expect(parsePlainTextToUtterances('[0.0s] Ana: Olá')).toEqual([
      { start: 0, end: 0, speaker: 'Ana', text: 'Olá' },
    ]);
  });

  it('deriva end da próxima fala', () => {
    const r = parsePlainTextToUtterances('[0.0s] Ana: Oi\n[2.5s] Bruno: E aí');
    expect(r[0]).toEqual({ start: 0, end: 2.5, speaker: 'Ana', text: 'Oi' });
    expect(r[1]).toEqual({ start: 2.5, end: 2.5, speaker: 'Bruno', text: 'E aí' });
  });

  it('aceita speaker com espaços e texto com dois-pontos', () => {
    const r = parsePlainTextToUtterances('[3.0s] Márcio Pereira: link: http://x');
    expect(r[0].speaker).toBe('Márcio Pereira');
    expect(r[0].text).toBe('link: http://x');
  });

  it('ignora linhas malformadas e vazias', () => {
    expect(parsePlainTextToUtterances('lixo\n\n[1.0s] Zé: ok')).toEqual([
      { start: 1, end: 1, speaker: 'Zé', text: 'ok' },
    ]);
  });

  it('string vazia → []', () => {
    expect(parsePlainTextToUtterances('')).toEqual([]);
  });

  it('round-trip preserva start/speaker/text', () => {
    const utts = [
      { speaker: 'Ana', text: 'Oi', start: 0, end: 2.5 },
      { speaker: 'Bruno', text: 'E aí', start: 2.5, end: 4 },
    ];
    const parsed = parsePlainTextToUtterances(utterancesToPlainText(utts));
    expect(parsed.map((u) => [u.start, u.speaker, u.text])).toEqual([
      [0, 'Ana', 'Oi'],
      [2.5, 'Bruno', 'E aí'],
    ]);
  });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `cd worker && npm test`
Expected: FAIL — `Cannot find module './text'`.

- [ ] **Step 5: Implementar `text.ts`**

Create `worker/lib/text.ts`:

```ts
export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export function utterancesToPlainText(utts: Utterance[]): string {
  return utts.map((u) => `[${u.start.toFixed(1)}s] ${u.speaker}: ${u.text}`).join('\n');
}

// Inverte utterancesToPlainText. Cada linha: "[<start>s] <speaker>: <text>".
// O txt só guarda start; end é reconstruído como o start da fala seguinte
// (na última, end = start). Linhas fora do padrão são ignoradas.
export function parsePlainTextToUtterances(txt: string): Utterance[] {
  const out: Utterance[] = [];
  for (const line of txt.split('\n')) {
    const m = line.match(/^\[(\d+(?:\.\d+)?)s\]\s+([^:]+):\s+([\s\S]*)$/);
    if (!m) continue;
    const start = parseFloat(m[1]);
    out.push({ start, end: start, speaker: m[2].trim(), text: m[3].trim() });
  }
  for (let i = 0; i < out.length - 1; i++) out[i].end = out[i + 1].start;
  return out;
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd worker && npm test`
Expected: PASS (todos os testes de `text.test.ts`).

- [ ] **Step 7: Usar `text.ts` em `transcribe.ts`**

Em `worker/transcribe.ts`: remover a `interface Utterance { ... }` local (linhas ~101-106) e a função `utterancesToPlainText` local (linhas ~585-587). Adicionar o import junto aos demais imports do topo:

```ts
import { parsePlainTextToUtterances, utterancesToPlainText, type Utterance } from './lib/text';
```

- [ ] **Step 8: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: sem erros (sem `Utterance`/`utterancesToPlainText` duplicados ou não usados).

- [ ] **Step 9: Commit**

```bash
git add worker/package.json worker/package-lock.json worker/lib/text.ts worker/lib/text.test.ts worker/transcribe.ts
git commit -m "feat(worker): extrai text.ts com parse/format de transcrição + testes"
```

---

### Task 2: `fetchWithTimeout` + wire no OpenRouter

**Files:**
- Create: `worker/lib/http.ts`
- Create: `worker/lib/http.test.ts`
- Modify: `worker/transcribe.ts` (config `OPENROUTER_TIMEOUT_MS`; `transcribeChunkOnce` usa `fetchWithTimeout`)

**Interfaces:**
- Produces:
  - `class TimeoutError extends Error`
  - `function fetchWithTimeout(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<Response>`

- [ ] **Step 1: Escrever o teste que falha**

Create `worker/lib/http.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fetchWithTimeout, TimeoutError } from './http';

describe('fetchWithTimeout', () => {
  it('resolve quando o fetch responde antes do prazo', async () => {
    const fakeResp = new Response('ok');
    const fetchImpl = () => Promise.resolve(fakeResp);
    const r = await fetchWithTimeout('http://x', { fetchImpl } as never, 1000);
    expect(r).toBe(fakeResp);
  });

  it('lança TimeoutError quando estoura o prazo', async () => {
    // fetch que só rejeita quando o signal aborta
    const fetchImpl = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError')),
        );
      });
    await expect(
      fetchWithTimeout('http://x', { fetchImpl } as never, 20),
    ).rejects.toBeInstanceOf(TimeoutError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker && npm test -- http`
Expected: FAIL — `Cannot find module './http'`.

- [ ] **Step 3: Implementar `http.ts`**

Create `worker/lib/http.ts`. O parâmetro opcional `init.fetchImpl` permite injetar um fetch nos testes; em produção usa o `fetch` global.

```ts
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

type InitWithImpl = RequestInit & {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>;
};

// fetch com AbortController: se estourar timeoutMs, aborta e lança TimeoutError
// (retryável). Evita que uma requisição pendurada congele o worker.
export async function fetchWithTimeout(
  url: string,
  init: InitWithImpl | undefined,
  timeoutMs: number,
): Promise<Response> {
  const { fetchImpl, ...rest } = init ?? {};
  const doFetch = fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await doFetch(url, { ...rest, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new TimeoutError(`timeout após ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd worker && npm test -- http`
Expected: PASS.

- [ ] **Step 5: Wire no OpenRouter**

Em `worker/transcribe.ts`:

Adicionar import no topo:
```ts
import { fetchWithTimeout } from './lib/http';
```

Na seção Config (perto de `POLL_INTERVAL_SECONDS`), adicionar:
```ts
const OPENROUTER_TIMEOUT_MS = Number(env.OPENROUTER_TIMEOUT_MS ?? '180000');
```

Em `transcribeChunkOnce`, trocar a chamada `const resp = await fetch(OPENROUTER_URL, { ... });` por:
```ts
  const resp = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://meet.legacyexecutoria.com.br',
        'X-Title': 'Legacy Meet - Transcription Worker',
      },
      body: JSON.stringify(body),
    },
    OPENROUTER_TIMEOUT_MS,
  );
```

(O `TimeoutError` é retryável: `transcribeChunk` já faz retry de qualquer erro que não seja `NonRetryableChunkError`.)

- [ ] **Step 6: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add worker/lib/http.ts worker/lib/http.test.ts worker/transcribe.ts
git commit -m "feat(worker): fetchWithTimeout + timeout na chamada ao OpenRouter"
```

---

### Task 3: Módulo `drive.ts` idempotente + testes

**Files:**
- Create: `worker/lib/drive.ts`
- Create: `worker/lib/drive.test.ts`
- Modify: `worker/transcribe.ts` (remover `getDriveAccessToken`/`driveCreateFolder`/`driveUploadFile` locais; importar de `./lib/drive`; config `DRIVE_TIMEOUT_MS` + `DRIVE_CFG`)

**Interfaces:**
- Consumes: `fetchWithTimeout` (Task 2).
- Produces:
  - `interface DriveConfig { clientId: string; clientSecret: string; refreshToken: string }`
  - `function getDriveAccessToken(cfg: DriveConfig, timeoutMs: number): Promise<string>`
  - `function driveCreateFolder(token: string, name: string, parentId: string | undefined, timeoutMs: number): Promise<string>`
  - `function driveFindOrCreateFolder(token: string, name: string, parentId: string | undefined, timeoutMs: number): Promise<string>`
  - `function driveFindFileInFolder(token: string, name: string, folderId: string, timeoutMs: number): Promise<string | null>`
  - `function driveUploadFile(token: string, filePath: string, name: string, mimeType: string, parentId: string | undefined, timeoutMs: number): Promise<string>`

- [ ] **Step 1: Escrever o teste que falha**

Create `worker/lib/drive.test.ts` (testa só as funções de busca idempotente, com `fetch` global mockado):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { driveFindFileInFolder, driveFindOrCreateFolder } from './drive';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(obj: unknown) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('driveFindOrCreateFolder', () => {
  it('reusa a pasta existente sem criar', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'F1' }] }));
    vi.stubGlobal('fetch', fetchMock);
    const id = await driveFindOrCreateFolder('tok', 'Pasta X', 'PARENT', 5000);
    expect(id).toBe('F1');
    expect(fetchMock).toHaveBeenCalledTimes(1); // só o list, sem POST de criação
  });

  it('cria quando não existe', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [] })) // list vazio
      .mockResolvedValueOnce(jsonResponse({ id: 'F2' })); // create
    vi.stubGlobal('fetch', fetchMock);
    const id = await driveFindOrCreateFolder('tok', 'Nova', 'PARENT', 5000);
    expect(id).toBe('F2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('escapa aspas simples no nome da query', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'F3' }] }));
    vi.stubGlobal('fetch', fetchMock);
    await driveFindOrCreateFolder('tok', "O'Brien", 'PARENT', 5000);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(decodeURIComponent(calledUrl)).toContain("name='O\\'Brien'");
  });
});

describe('driveFindFileInFolder', () => {
  it('retorna o id quando o arquivo existe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ files: [{ id: 'V1' }] })));
    expect(await driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).toBe('V1');
  });

  it('retorna null quando não existe', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ files: [] })));
    expect(await driveFindFileInFolder('tok', 'a.mp4', 'F1', 5000)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd worker && npm test -- drive`
Expected: FAIL — `Cannot find module './drive'`.

- [ ] **Step 3: Implementar `drive.ts`**

Create `worker/lib/drive.ts` (move as 3 funções existentes para forma param-based + adiciona as 2 de busca; todas via `fetchWithTimeout`):

```ts
import { readFile } from 'node:fs/promises';
import { fetchWithTimeout } from './http';

export interface DriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export async function getDriveAccessToken(cfg: DriveConfig, timeoutMs: number): Promise<string> {
  const resp = await fetchWithTimeout(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
        grant_type: 'refresh_token',
      }),
    },
    timeoutMs,
  );
  const data: any = await resp.json();
  if (!data.access_token) {
    throw new Error(`drive_auth_failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data.access_token;
}

export async function driveCreateFolder(
  token: string,
  name: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const metadata: Record<string, unknown> = { name, mimeType: FOLDER_MIME };
  if (parentId) metadata.parents = [parentId];
  const resp = await fetchWithTimeout(
    `${DRIVE_FILES_URL}?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
    },
    timeoutMs,
  );
  if (!resp.ok) {
    throw new Error(`drive_folder_failed ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data: any = await resp.json();
  if (!data.id) throw new Error('drive_folder_no_id');
  return data.id;
}

// Busca por nome+pai; reusa se achar, senão cria. Sem parentId, cria direto
// (não dá pra desambiguar por pai). Elimina pastas duplicadas em reprocessos.
export async function driveFindOrCreateFolder(
  token: string,
  name: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  if (parentId) {
    const esc = name.replace(/'/g, "\\'");
    const q = `name='${esc}' and '${parentId}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const url =
      `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)` +
      `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
    if (resp.ok) {
      const data: any = await resp.json();
      if (data.files?.length) return data.files[0].id;
    }
  }
  return driveCreateFolder(token, name, parentId, timeoutMs);
}

// Retorna o id do arquivo com esse nome na pasta, ou null. Evita re-upload.
export async function driveFindFileInFolder(
  token: string,
  name: string,
  folderId: string,
  timeoutMs: number,
): Promise<string | null> {
  const esc = name.replace(/'/g, "\\'");
  const q = `name='${esc}' and '${folderId}' in parents and trashed=false`;
  const url =
    `${DRIVE_FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id)` +
    `&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const resp = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
  if (resp.ok) {
    const data: any = await resp.json();
    if (data.files?.length) return data.files[0].id;
  }
  return null;
}

export async function driveUploadFile(
  token: string,
  filePath: string,
  name: string,
  mimeType: string,
  parentId: string | undefined,
  timeoutMs: number,
): Promise<string> {
  const metadata: Record<string, unknown> = { name };
  if (parentId) metadata.parents = [parentId];

  const initResp = await fetchWithTimeout(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
      },
      body: JSON.stringify(metadata),
    },
    timeoutMs,
  );
  if (!initResp.ok) {
    throw new Error(`drive_init_failed ${initResp.status}: ${(await initResp.text()).slice(0, 300)}`);
  }
  const sessionUri = initResp.headers.get('location');
  if (!sessionUri) throw new Error('drive_init_no_session_uri');

  const fileBuffer = await readFile(filePath);
  const putResp = await fetchWithTimeout(
    sessionUri,
    {
      method: 'PUT',
      headers: { 'Content-Type': mimeType, 'Content-Length': String(fileBuffer.length) },
      body: fileBuffer,
    },
    timeoutMs,
  );
  if (!putResp.ok) {
    throw new Error(`drive_upload_failed ${putResp.status}: ${(await putResp.text()).slice(0, 300)}`);
  }
  const result: any = await putResp.json();
  if (!result.id) throw new Error(`drive_upload_no_id: ${JSON.stringify(result).slice(0, 300)}`);
  return result.id;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd worker && npm test -- drive`
Expected: PASS.

- [ ] **Step 5: Usar `drive.ts` em `transcribe.ts`**

Em `worker/transcribe.ts`:

1. Remover as funções locais `getDriveAccessToken` (linhas ~468-482), `driveCreateFolder` (~485-502) e `driveUploadFile` (~505-545).
2. Adicionar import no topo:
```ts
import {
  driveFindFileInFolder,
  driveFindOrCreateFolder,
  driveUploadFile,
  getDriveAccessToken,
  type DriveConfig,
} from './lib/drive';
```
3. Na seção Config, após as consts `GOOGLE_OAUTH_*`, adicionar:
```ts
const DRIVE_TIMEOUT_MS = Number(env.DRIVE_TIMEOUT_MS ?? '120000');
const DRIVE_CFG: DriveConfig = {
  clientId: GOOGLE_OAUTH_CLIENT_ID ?? '',
  clientSecret: GOOGLE_OAUTH_CLIENT_SECRET ?? '',
  refreshToken: GOOGLE_OAUTH_REFRESH_TOKEN ?? '',
};
```
4. A chamada existente `await getDriveAccessToken()` em `processRecording` passa a ser `await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS)`. As chamadas `driveCreateFolder(token, folderName, GOOGLE_DRIVE_FOLDER_ID)` e `driveUploadFile(token, ..., gdriveFolderId)` recebem os novos parâmetros — mas o corpo inteiro do arquivamento será reescrito na Task 4, então aqui basta deixar o arquivo **compilando**: substituir temporariamente o bloco `if (DRIVE_ENABLED && !transcriptionFailed) { ... }` pelas assinaturas novas (`getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS)`, `driveCreateFolder(token, folderName, GOOGLE_DRIVE_FOLDER_ID, DRIVE_TIMEOUT_MS)`, `driveUploadFile(token, videoPath, \`${id}.mp4\`, 'video/mp4', gdriveFolderId, DRIVE_TIMEOUT_MS)`, idem para o `.txt`).

- [ ] **Step 6: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: sem erros (nenhuma função de Drive duplicada/não usada).

- [ ] **Step 7: Rodar todos os testes**

Run: `cd worker && npm test`
Expected: PASS (text, http, drive).

- [ ] **Step 8: Commit**

```bash
git add worker/lib/drive.ts worker/lib/drive.test.ts worker/transcribe.ts
git commit -m "feat(worker): drive.ts idempotente (find-or-create) + timeout em todas as chamadas"
```

---

### Task 4: Reescrever `processRecording` (reuso de txt + Drive à prova de falha + manifesto sempre)

**Files:**
- Modify: `worker/transcribe.ts` (funções `processRecording` e nova helper `archiveVideoToDrive`)

**Interfaces:**
- Consumes: `parsePlainTextToUtterances`, `utterancesToPlainText` (Task 1); `driveFindOrCreateFolder`, `driveFindFileInFolder`, `driveUploadFile`, `getDriveAccessToken` (Task 3); `DRIVE_CFG`, `DRIVE_TIMEOUT_MS`.
- Produces:
  - `async function archiveVideoToDrive(token: string, videoPath: string, id: string, folderName: string, plainText: string, tmpDir: string): Promise<{ folderId: string; fileId: string }>`
  - `processRecording` com fluxo novo (mesma assinatura `(rec: RecordingObject): Promise<void>`).

- [ ] **Step 1: Adicionar helper de leitura de txt existente**

Em `worker/transcribe.ts`, junto aos helpers de S3 (perto de `getObjectText`... que está em `lib/recordings.ts`, não aqui — no worker usar `GetObjectCommand`). Adicionar:

```ts
async function getObjectTextOrNull(key: string): Promise<string | null> {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return await (res.Body as any).transformToString();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Adicionar `archiveVideoToDrive` (idempotente)**

Adicionar antes de `processRecording`:

```ts
// Sobe vídeo + txt pro Drive de forma idempotente (reusa pasta/arquivo se já
// existirem). Lança se o Drive falhar — o chamador trata com fallback s3.
async function archiveVideoToDrive(
  token: string,
  videoPath: string,
  id: string,
  folderName: string,
  plainText: string,
  tmpDir: string,
): Promise<{ folderId: string; fileId: string }> {
  const folderId = await driveFindOrCreateFolder(token, folderName, GOOGLE_DRIVE_FOLDER_ID, DRIVE_TIMEOUT_MS);
  let fileId = await driveFindFileInFolder(token, `${id}.mp4`, folderId, DRIVE_TIMEOUT_MS);
  if (!fileId) {
    fileId = await driveUploadFile(token, videoPath, `${id}.mp4`, 'video/mp4', folderId, DRIVE_TIMEOUT_MS);
  }
  if (!(await driveFindFileInFolder(token, `${id}.txt`, folderId, DRIVE_TIMEOUT_MS))) {
    const txtPath = path.join(tmpDir, 'transcricao.txt');
    await writeFile(txtPath, plainText, 'utf-8');
    await driveUploadFile(token, txtPath, `${id}.txt`, 'text/plain', folderId, DRIVE_TIMEOUT_MS);
  }
  return { folderId, fileId };
}
```

- [ ] **Step 3: Reescrever o corpo de `processRecording`**

Substituir o bloco a partir de `const chunks = await splitAudio(...)` até o `log(concluído ...)` (linhas ~617-706) por:

```ts
    const chunks = await splitAudio(audioPath, chunkDir, CHUNK_SECONDS);

    // Reuso de backlog: se já existe transcrição (txt) no MinIO de um run
    // anterior, reconstrói as falas dela em vez de re-transcrever (economiza
    // créditos). Gravação nova não tem txt → transcreve normalmente.
    const existingTxt = await getObjectTextOrNull(transcriptKey(id, 'txt'));
    const allUtts: Utterance[] = [];
    const skipped: number[] = [];

    if (existingTxt && existingTxt.trim()) {
      const reused = parsePlainTextToUtterances(existingTxt);
      allUtts.push(...reused);
      log(`reaproveitando transcrição existente do MinIO — ${reused.length} utterance(s)`);
    } else {
      for (let i = 0; i < chunks.length; i++) {
        const { path: chunkPath, offset } = chunks[i];
        log(`chunk ${i + 1}/${chunks.length} (offset=${offset}s)`);
        let utts: unknown[];
        try {
          utts = await transcribeChunk(chunkPath, participants);
        } catch (e) {
          log(`chunk ${i + 1} pulado: ${e instanceof Error ? e.message : String(e)}`);
          skipped.push(i + 1);
          continue;
        }
        let added = 0;
        for (const raw of utts as Array<Record<string, unknown>>) {
          const text = String(raw.text ?? '').trim();
          if (!text) continue;
          const start = Number(raw.start ?? 0) + offset;
          const end = Number(raw.end ?? start) + offset;
          const speaker = String(raw.speaker ?? 'Pessoa 1').trim();
          allUtts.push({ speaker, text, start, end });
          added += 1;
        }
        log(`chunk ${i + 1} → ${added} utterance(s)`);
      }
    }

    const transcriptionFailed = allUtts.length === 0 && skipped.length > 0;
    if (transcriptionFailed) {
      log(`transcrição falhou (chunks pulados: ${skipped.join(', ')}) — arquivando vídeo mesmo assim`);
    }

    // txt de referência no MinIO (regravado a partir das falas atuais).
    const plainText = utterancesToPlainText(allUtts);
    await uploadText(transcriptKey(id, 'txt'), plainText, 'text/plain; charset=utf-8');

    // Arquivamento no Drive à prova de falha: se falhar, cai em s3 (vídeo fica
    // no MinIO) e MESMO ASSIM grava o manifesto — nunca entra em loop.
    let storage: 's3' | 'gdrive' = 's3';
    let gdriveFileId: string | null = null;
    let gdriveFolderId: string | null = null;
    let videoKey: string | null = key;

    if (DRIVE_ENABLED) {
      const folderName = `${formatDateTimeBR(createdAt)} - ${title || roomName}`;
      try {
        log(`arquivando no Google Drive em "${folderName}"`);
        const token = await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS);
        const res = await archiveVideoToDrive(token, videoPath, id, folderName, plainText, tmp);
        gdriveFolderId = res.folderId;
        gdriveFileId = res.fileId;
        storage = 'gdrive';
        videoKey = null;
        log(`arquivado no Drive (pasta=${gdriveFolderId}, vídeo=${gdriveFileId})`);
      } catch (e) {
        log(`falha ao arquivar no Drive: ${e instanceof Error ? e.message : String(e)} — mantendo no MinIO (storage=s3)`);
      }
    }

    const manifest = {
      id,
      title,
      roomName,
      createdAt,
      durationSeconds,
      storage,
      videoKey,
      gdriveFileId,
      gdriveFolderId,
      transcriptTxtKey: transcriptKey(id, 'txt'),
      transcriptionStatus: transcriptionFailed ? ('failed' as const) : ('complete' as const),
      model: OPENROUTER_MODEL,
      participants,
      skippedChunks: skipped,
      utterances: allUtts,
    };
    await uploadText(manifestKey(id), JSON.stringify(manifest, null, 2), 'application/json');

    // Só remove o .mp4 do MinIO DEPOIS do manifesto e SÓ se foi pro Drive.
    if (storage === 'gdrive') {
      await deleteObject(key);
    }

    log(
      `concluído ${id} — ${allUtts.length} utterances, storage=${storage}${
        skipped.length ? ` (chunks pulados: ${skipped.join(', ')})` : ''
      }`,
    );
```

- [ ] **Step 4: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: sem erros. (Conferir que não sobrou referência às antigas vars `token`/`txtPath` fora de escopo.)

- [ ] **Step 5: Rodar testes**

Run: `cd worker && npm test`
Expected: PASS (as unidades puras seguem verdes; a mudança é orquestração).

- [ ] **Step 6: Verificação manual (smoke)**

Descrição (executar em ambiente com acesso ao MinIO/Drive, fora do CI):
1. Garanta que há um `.mp4` de teste em `com-transcricao/` sem manifesto.
2. `cd worker && npm start` e observe o log:
   - deve logar `arquivando no Google Drive`, depois `arquivado no Drive (...)`, `concluído ... storage=gdrive`;
   - a pasta no Drive **não** deve duplicar se você rodar de novo (idempotência).
3. Simule Drive fora (ex.: `GOOGLE_OAUTH_REFRESH_TOKEN` inválido): deve logar `falha ao arquivar no Drive ... storage=s3`, gravar manifesto, **manter** o `.mp4` no MinIO, e a gravação aparecer no front.

- [ ] **Step 7: Commit**

```bash
git add worker/transcribe.ts
git commit -m "feat(worker): arquivamento no Drive à prova de falha + reuso de txt + manifesto sempre"
```

---

### Task 5: `reconcileS3Recordings` — auto-migração pro Drive quando ele voltar

**Files:**
- Modify: `worker/transcribe.ts` (nova função `reconcileS3Recordings` + chamada no loop `main`)

**Interfaces:**
- Consumes: `getDriveAccessToken`, `archiveVideoToDrive` (Task 4); `getManifest`-equivalente local; `downloadToFile`, `deleteObject`, `uploadText`, `manifestKey`, `utterancesToPlainText`.
- Produces: `async function reconcileS3Recordings(): Promise<void>`

- [ ] **Step 1: Adicionar leitor de manifesto no worker**

Em `worker/transcribe.ts`, junto aos helpers de S3, adicionar (o worker ainda não lê manifestos):

```ts
async function listManifestIds(): Promise<string[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: MANIFEST_PREFIX, ContinuationToken: token }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith('.json')) {
        ids.push(obj.Key.slice(MANIFEST_PREFIX.length).replace(/\.json$/, ''));
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return ids;
}

async function readManifest(id: string): Promise<any | null> {
  const txt = await getObjectTextOrNull(manifestKey(id));
  if (txt == null) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Adicionar `reconcileS3Recordings`**

```ts
// Migra pro Drive as gravações que ficaram como storage=s3 (Drive estava fora
// quando processaram). Reusa as falas do manifesto — NÃO re-transcreve. Quando
// o Drive volta, tudo que acumulou migra sozinho.
async function reconcileS3Recordings(): Promise<void> {
  if (!DRIVE_ENABLED) return;
  let token: string | null = null;
  for (const id of await listManifestIds()) {
    if (shuttingDown) break;
    const m = await readManifest(id);
    if (!m || m.storage !== 's3' || !m.videoKey) continue;

    const tmp = await mkdtemp(path.join(tmpdir(), 'reconcile-'));
    try {
      const videoPath = path.join(tmp, 'recording.mp4');
      await downloadToFile(m.videoKey, videoPath);
      const plainText = utterancesToPlainText((m.utterances ?? []) as Utterance[]);
      const folderName = `${formatDateTimeBR(m.createdAt)} - ${m.title || m.roomName}`;
      if (!token) token = await getDriveAccessToken(DRIVE_CFG, DRIVE_TIMEOUT_MS);
      log(`migrando pro Drive: ${id} → "${folderName}"`);
      const res = await archiveVideoToDrive(token, videoPath, id, folderName, plainText, tmp);
      const updated = { ...m, storage: 'gdrive', videoKey: null, gdriveFolderId: res.folderId, gdriveFileId: res.fileId };
      await uploadText(manifestKey(id), JSON.stringify(updated, null, 2), 'application/json');
      await deleteObject(m.videoKey);
      log(`migrado pro Drive: ${id}`);
    } catch (e) {
      log(`migração adiada para ${id}: ${e instanceof Error ? e.message : String(e)}`);
      token = null; // força novo token na próxima (caso auth tenha expirado)
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}
```

- [ ] **Step 3: Chamar no loop `main`**

Em `main()`, dentro do `while (!shuttingDown)`, depois do bloco que processa `recordings` e antes do `if (!processedAny) await sleep(...)`, adicionar:

```ts
      if (!shuttingDown) await reconcileS3Recordings();
```

- [ ] **Step 4: Typecheck**

Run: `cd worker && npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Rodar testes**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 6: Verificação manual (smoke)**

1. Deixe uma gravação com manifesto `storage=s3` e `videoKey` apontando pra um `.mp4` presente no MinIO (resultado do fallback da Task 4 com Drive fora).
2. Restaure o Drive (token válido) e rode `npm start`.
3. Log deve mostrar `migrando pro Drive: <id>` e depois `migrado pro Drive: <id>`; o manifesto vira `storage=gdrive`; o `.mp4` some do MinIO; a pasta aparece no Drive (sem duplicar).

- [ ] **Step 7: Commit**

```bash
git add worker/transcribe.ts
git commit -m "feat(worker): reconcileS3Recordings — auto-migra gravações s3 pro Drive quando ele volta"
```

---

## Self-Review

**Spec coverage:**
- Timeouts em toda chamada de rede → Task 2 (OpenRouter) + Task 3 (todas as de Drive via `fetchWithTimeout`). ✅
- Novo fluxo `processRecording` (Drive try/catch, fallback s3, manifesto sempre, delete após manifesto) → Task 4. ✅
- Drive idempotente (find-or-create, sem duplicar) → Task 3 + uso em Task 4/5. ✅
- Recuperação do backlog reaproveitando txt → Task 4 (Step 3, ramo `existingTxt`). ✅
- Auto-migração pro Drive (Opção 2) + limpeza de órfão → Task 5 (migração; `videoKey` só apaga após manifesto gdrive na Task 4 cobre o órfão do fluxo normal). ✅
- `transcriptionStatus` só `complete`/`failed` → Task 4 (manifest). ✅
- Testes das unidades puras/arriscadas (parser, fetchWithTimeout, find-or-create) → Tasks 1-3. ✅
- Config de timeout → Task 2/3. ✅
- Ops: relógio NTP → fora de escopo de código (documentado no spec; lembrar no handoff). ✅

**Placeholder scan:** nenhum "TBD/TODO"; todo passo de código tem código completo. ✅

**Type consistency:** `Utterance` vem de `lib/text` em todos os usos; `archiveVideoToDrive` mesma assinatura em Task 4 e 5; funções de Drive com as assinaturas param-based declaradas na Task 3 e usadas idênticas depois. ✅

**Nota sobre órfãos:** o único órfão possível é um `.mp4` que sobra em `com-transcricao/` se o processo morrer entre gravar o manifesto (gdrive) e o `deleteObject`. Como o manifesto já existe, o loop pula o arquivo — o `.mp4` fica inofensivo. Se quiser varredura ativa desses órfãos, é uma melhoria futura (não incluída para manter o escopo).
