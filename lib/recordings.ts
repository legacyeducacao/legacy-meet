import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { deleteDriveFile } from './drive';
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
}

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
};

export async function getRoomOwners(roomNames: string[]): Promise<Map<string, RoomOwner>> {
  const out = new Map<string, RoomOwner>();
  if (!roomNames.length) return out;
  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from('meetings')
    .select('room_name, host_id, users:host_id(name), meet_meeting_sector(sector)')
    .in('room_name', roomNames);
  if (error) console.error('getRoomOwners', error);
  for (const m of (data ?? []) as Array<{
    room_name: string;
    host_id: string | null;
    users?: { name?: string | null } | null;
    meet_meeting_sector?: { sector?: string | null } | null;
  }>) {
    out.set(m.room_name, {
      roomName: m.room_name,
      hostId: m.host_id,
      hostName: m.users?.name ?? null,
      sector: m.meet_meeting_sector?.sector ?? null,
    });
  }
  return out;
}

export async function canAccessRecording(
  id: string,
  user: { id: string; isAdmin: boolean } | null,
): Promise<boolean> {
  if (!user) return false;
  if (user.isAdmin) return true;
  const roomName = id.split('__')[0];
  const owners = await getRoomOwners([roomName]);
  const o = owners.get(roomName);
  return !!o && o.hostId === user.id;
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
