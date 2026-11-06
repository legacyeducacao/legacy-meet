import { timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';

export const WORKER_SECRET_HEADER = 'x-execscore-worker-secret';

/** Chamada do worker de transcrição: header precisa bater com EXECSCORE_WORKER_SECRET. */
export function isWorkerCall(req: NextRequest): boolean {
  const secret = process.env.EXECSCORE_WORKER_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get(WORKER_SECRET_HEADER) ?? '');
  const want = Buffer.from(secret);
  return got.length === want.length && timingSafeEqual(got, want);
}
