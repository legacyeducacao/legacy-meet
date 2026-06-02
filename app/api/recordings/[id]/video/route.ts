import { NextRequest, NextResponse } from 'next/server';
import { getManifest, getSignedVideoUrl } from '@/lib/recordings';
import { getDriveAccessToken } from '@/lib/drive';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const manifest = await getManifest(id);
  if (!manifest) {
    return new NextResponse('Gravação não encontrada', { status: 404 });
  }

  // No MinIO: redireciona para uma URL assinada (suporta range/seek nativamente).
  if (manifest.storage === 's3' && manifest.videoKey) {
    const url = await getSignedVideoUrl(manifest.videoKey);
    return NextResponse.redirect(url);
  }

  // No Google Drive: faz proxy do conteúdo, repassando o header Range para permitir seek.
  if (manifest.storage === 'gdrive' && manifest.gdriveFileId) {
    const token = await getDriveAccessToken();
    const range = req.headers.get('range') ?? undefined;
    const driveResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${manifest.gdriveFileId}?alt=media&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}`, ...(range ? { Range: range } : {}) } },
    );
    if (!driveResp.ok && driveResp.status !== 206) {
      return new NextResponse(`Drive ${driveResp.status}`, { status: 502 });
    }
    const headers = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = driveResp.headers.get(h);
      if (v) headers.set(h, v);
    }
    if (!headers.has('content-type')) headers.set('content-type', 'video/mp4');
    return new NextResponse(driveResp.body, { status: driveResp.status, headers });
  }

  return new NextResponse('Vídeo indisponível', { status: 404 });
}
