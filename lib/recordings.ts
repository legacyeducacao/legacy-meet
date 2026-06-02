import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
  transcriptionStatus: 'complete' | 'pending';
  model?: string;
  participants?: string[];
  skippedChunks?: number[];
  utterances: Utterance[];
}

/** Resumo para listagem (sem as utterances). */
export type RecordingSummary = Omit<RecordingManifest, 'utterances' | 'skippedChunks'> & {
  utteranceCount: number;
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

  const manifests = await Promise.all(ids.map((id) => getManifest(id)));
  return manifests
    .filter((m): m is RecordingManifest => m !== null)
    .map(({ utterances, skippedChunks, ...rest }) => ({
      ...rest,
      utteranceCount: utterances?.length ?? 0,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
