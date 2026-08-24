import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { deleteDriveFile, getDriveAccessToken } from './drive';
import { chunkArray } from './chunk';
import { createAdminSupabase } from '@/lib/supabase/admin';

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
}

export interface RecordingManifest {
  id: string;
  title?: string;
  roomName: string;
  createdAt: string;
  durationSeconds: number;
  storage: 's3' | 'gdrive';
  videoKey: string | null;
  gdriveFileId: string | null;
  gdriveFolderId?: string | null;
  transcriptTxtKey: string;
  transcriptionStatus: 'complete' | 'pending' | 'failed';
  model?: string;
  participants?: string[];
  skippedChunks?: number[];
  skippedChunkDetails?: Array<{ chunk: number; offsetSeconds: number; reason: string }>;
  utterances: Utterance[];
}

/** Resumo para listagem (sem as utterances). */
export type RecordingSummary = Omit<RecordingManifest, 'utterances' | 'skippedChunks'> & {
  utteranceCount: number;
  /** Nome do host vindo do meta/<room>.json (fallback quando não há dono no banco). */
  metaHost?: string | null;
};

const S3_BUCKET = process.env.S3_BUCKET ?? 'legacy-meet';
const MANIFEST_PREFIX = process.env.MANIFEST_PREFIX ?? 'manifests/';

let client: S3Client | null = null;
function s3(): S3Client {
  if (!client) {
    const { S3_ENDPOINT, S3_KEY_ID, S3_KEY_SECRET, S3_REGION } = process.env;
    if (!S3_ENDPOINT || !S3_KEY_ID || !S3_KEY_SECRET) {
      throw new Error('S3 não configurado (S3_ENDPOINT / S3_KEY_ID / S3_KEY_SECRET)');
    }
    client = new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION ?? 'us-east-1',
      credentials: { accessKeyId: S3_KEY_ID, secretAccessKey: S3_KEY_SECRET },
      forcePathStyle: true,
    });
  }
  return client;
}

export const bucket = () => S3_BUCKET;

async function streamToString(body: unknown): Promise<string> {
  // Body é um stream (Node) — transformToString existe no SDK v3
  const anyBody = body as { transformToString?: () => Promise<string> };
  if (typeof anyBody?.transformToString === 'function') {
    return anyBody.transformToString();
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function getManifest(id: string): Promise<RecordingManifest | null> {
  try {
    const res = await s3().send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: `${MANIFEST_PREFIX}${id}.json` }),
    );
    return JSON.parse(await streamToString(res.Body)) as RecordingManifest;
  } catch {
    return null;
  }
}

export async function listRecordings(): Promise<RecordingSummary[]> {
  const ids: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: MANIFEST_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key && obj.Key.endsWith('.json')) {
        ids.push(obj.Key.slice(MANIFEST_PREFIX.length).replace(/\.json$/, ''));
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);

  const manifests = (await Promise.all(ids.map((id) => getManifest(id)))).filter(
    (m): m is RecordingManifest => m !== null,
  );
  // Lê o meta de cada sala para trazer o nome do host (usado no filtro por usuário).
  const summaries = await Promise.all(
    manifests.map(async ({ utterances, skippedChunks, ...rest }) => {
      const meta = await readJson<MeetingMeta>(metaKey(rest.roomName));
      return {
        ...rest,
        utteranceCount: utterances?.length ?? 0,
        metaHost: meta?.host?.trim() || null,
      };
    }),
  );
  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getSignedVideoUrl(key: string): Promise<string> {
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }), {
    expiresIn: 3600,
  });
}

export async function getObjectText(key: string): Promise<string | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return await streamToString(res.Body);
  } catch {
    return null;
  }
}

// ---------- Metadados da reunião (título, host, participantes) ----------
const META_PREFIX = 'meta/';
export const metaKey = (roomName: string) => `${META_PREFIX}${roomName}.json`;

export interface MeetingMeta {
  title?: string;
  host?: string;
  createdAt?: string;
  participants?: string[];
  /** Última escrita em `participants` — distingue a sessão atual de uma antiga na mesma sala. */
  participantsUpdatedAt?: string;
}

/** Janela em que nomes já registrados na sala contam como "desta sessão". */
export const PARTICIPANTS_SESSION_WINDOW_MS = 10 * 60 * 1000;

export async function readJson<T = unknown>(key: string): Promise<T | null> {
  const text = await getObjectText(key);
  if (text == null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeJson(key: string, obj: unknown): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(obj),
      ContentType: 'application/json',
    }),
  );
}

async function deleteObject(key: string): Promise<void> {
  try {
    await s3().send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
  } catch (e) {
    console.error('Falha ao apagar objeto', key, e);
  }
}

// ---------- Dono/setor da reunião por room_name ----------

export type RoomOwner = {
  roomName: string;
  hostId: string | null;
  hostName: string | null;
  sector: string | null;
  /** Título cadastrado da reunião (agenda ou ao iniciar). Fonte da verdade do nome. */
  title: string | null;
  /** Reunião marcada como no-show na Agenda (cliente não compareceu). */
  noShow: boolean;
};

export async function getRoomOwners(roomNames: string[]): Promise<Map<string, RoomOwner>> {
  const out = new Map<string, RoomOwner>();
  if (!roomNames.length) return out;
  const admin = createAdminSupabase();
  // O PostgREST manda o .in() na URL da requisição: acima de algumas centenas
  // de salas a URL estoura o limite e a consulta INTEIRA falha com Bad Request
  // — o mapa voltava vazio e usuários não-admin ficavam sem NENHUMA gravação.
  // Lotes de 100 mantêm a URL pequena em qualquer volume.
  const results = await Promise.all(
    chunkArray(roomNames, 100).map((batch) =>
      admin
        .from('meetings')
        .select(
          'room_name, title, host_id, status, users:host_id(name), meet_meeting_sector(sector)',
        )
        .in('room_name', batch),
    ),
  );
  const data: unknown[] = [];
  for (const r of results) {
    if (r.error) console.error('getRoomOwners', r.error);
    else data.push(...(r.data ?? []));
  }
  for (const m of (data ?? []) as Array<{
    room_name: string;
    title?: string | null;
    host_id: string | null;
    status?: string | null;
    users?: { name?: string | null } | null;
    meet_meeting_sector?: { sector?: string | null } | null;
  }>) {
    out.set(m.room_name, {
      roomName: m.room_name,
      hostId: m.host_id,
      hostName: m.users?.name ?? null,
      sector: m.meet_meeting_sector?.sector ?? null,
      title: m.title?.trim() || null,
      noShow: m.status === 'no_show',
    });
  }
  return out;
}

export async function canAccessRecording(
  id: string,
  user: { id: string; isAdmin: boolean; sector?: string | null } | null,
): Promise<boolean> {
  if (!user) return false;
  if (user.isAdmin) return true;
  const roomName = id.split('__')[0];
  const owners = await getRoomOwners([roomName]);
  const o = owners.get(roomName);
  if (!o) return false;
  if (o.hostId === user.id) return true;
  // Comercial vê (abre) todas as reuniões do comercial.
  if (user.sector === 'comercial' && o.sector === 'comercial') return true;
  return false;
}

const SOURCE_PREFIX = 'com-transcricao/';

/**
 * Reenfileira uma gravação para transcrição (usado no "Transcrever novamente").
 * Garante o .mp4 em `com-transcricao/<id>.mp4` (baixando do Drive se preciso) e
 * remove o manifesto + txt — assim o worker reprocessa no próximo ciclo. O
 * arquivamento no Drive é idempotente (não duplica o vídeo).
 */
export async function requeueTranscription(id: string): Promise<void> {
  const manifest = await getManifest(id);
  if (!manifest) throw new Error('Gravação não encontrada');

  // Atualiza título/host no meta a partir do banco — assim, ao reprocessar, o
  // worker nomeia a pasta do Drive com o título cadastrado (não com o nome da sala).
  const roomName = id.split('__')[0];
  const owner = (await getRoomOwners([roomName])).get(roomName);
  if (owner?.title) {
    const meta = (await readJson<MeetingMeta>(metaKey(roomName))) ?? {};
    await writeJson(metaKey(roomName), {
      ...meta,
      title: owner.title,
      host: meta.host || owner.hostName || '',
    });
  }

  const sourceKey = `${SOURCE_PREFIX}${id}.mp4`;

  // O .mp4 já está na pasta de origem?
  let hasSource = false;
  try {
    await s3().send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: sourceKey }));
    hasSource = true;
  } catch {
    hasSource = false;
  }

  if (!hasSource) {
    if (manifest.storage === 'gdrive' && manifest.gdriveFileId) {
      // Arquivada no Drive: baixa em STREAM (sem carregar o vídeo inteiro na
      // memória do app) e devolve para a pasta de origem.
      const token = await getDriveAccessToken();
      const resp = await fetch(
        `https://www.googleapis.com/drive/v3/files/${manifest.gdriveFileId}?alt=media&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!resp.ok || !resp.body) {
        throw new Error(`drive_download_failed ${resp.status}`);
      }
      const contentLength = Number(resp.headers.get('content-length'));
      await s3().send(
        new PutObjectCommand({
          Bucket: S3_BUCKET,
          Key: sourceKey,
          Body:
            contentLength > 0
              ? (Readable.fromWeb(resp.body as never) as Readable)
              : Buffer.from(await resp.arrayBuffer()),
          ...(contentLength > 0 ? { ContentLength: contentLength } : {}),
          ContentType: 'video/mp4',
        }),
      );
    } else if (manifest.videoKey && manifest.videoKey !== sourceKey) {
      // Ainda no MinIO, mas em outra chave: copia para a pasta de origem.
      await s3().send(
        new CopyObjectCommand({
          Bucket: S3_BUCKET,
          CopySource: `${S3_BUCKET}/${manifest.videoKey}`,
          Key: sourceKey,
        }),
      );
    } else if (!manifest.videoKey) {
      throw new Error('Vídeo não disponível para reprocessar (sem cópia no Drive nem no MinIO).');
    }
  }

  // Vídeo já seguro em com-transcricao/. Se estava no Drive, remove a pasta
  // antiga — o worker vai re-arquivar com o nome/título correto, evitando pasta
  // duplicada e órfã quando o título muda.
  if (manifest.storage === 'gdrive' && manifest.gdriveFolderId) {
    try {
      await deleteDriveFile(manifest.gdriveFolderId);
    } catch (e) {
      console.error('requeue: falha ao remover pasta antiga do Drive', e);
    }
  }

  // Remove manifesto + txt: o worker só reprocessa quem não tem manifesto.
  await deleteObject(`${MANIFEST_PREFIX}${id}.json`);
  if (manifest.transcriptTxtKey) await deleteObject(manifest.transcriptTxtKey);

  // O vídeo acabou de ser garantido em com-transcricao/ — o marker libera o
  // worker imediatamente (sem ele, esperaria o arquivo "esfriar"). Zera também
  // a contagem de tentativas para o retry manual ter fôlego novo.
  await writeJson(`ready/${id}.json`, { at: new Date().toISOString(), source: 'requeue' });
  await deleteObject(`attempts/${id}.json`);
}

/** Apaga uma gravação: vídeo (Drive ou MinIO), transcrição, meta e manifesto. */
export async function deleteRecording(id: string): Promise<void> {
  const manifest = await getManifest(id);
  if (manifest) {
    if (manifest.storage === 'gdrive') {
      const driveId = manifest.gdriveFolderId || manifest.gdriveFileId;
      if (driveId) {
        try {
          await deleteDriveFile(driveId);
        } catch (e) {
          console.error('Falha ao apagar do Drive', e);
        }
      }
    } else if (manifest.videoKey) {
      await deleteObject(manifest.videoKey);
    }
    if (manifest.transcriptTxtKey) await deleteObject(manifest.transcriptTxtKey);
    if (manifest.roomName) await deleteObject(metaKey(manifest.roomName));
  }
  await deleteObject(`${MANIFEST_PREFIX}${id}.json`);
}
