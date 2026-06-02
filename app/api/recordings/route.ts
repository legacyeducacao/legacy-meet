import { NextResponse } from 'next/server';
import { listRecordings } from '@/lib/recordings';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await listRecordings());
  } catch (error) {
    return new NextResponse(error instanceof Error ? error.message : 'erro', { status: 500 });
  }
}
