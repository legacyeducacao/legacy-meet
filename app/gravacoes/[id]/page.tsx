import Link from 'next/link';
import { getManifest, canAccessRecording } from '@/lib/recordings';
import { getCurrentUser } from '@/lib/auth';
import { RecordingDetail } from './RecordingDetail';
import styles from '@/styles/Recordings.module.css';

export const dynamic = 'force-dynamic';

export default async function Page(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  // Isolamento por usuário: EXECUTOR só vê as suas; MASTER vê todas. Sem dono
  // ou de outro executor → trata como "não encontrada" (não revela conteúdo).
  const user = await getCurrentUser();
  const manifest = (await canAccessRecording(id, user)) ? await getManifest(id) : null;

  if (!manifest) {
    return (
      <div className={styles.page}>
        <div className={styles.topbar}>
          <Link className={styles.back} href="/gravacoes">
            ←
          </Link>
          <h1>Gravação não encontrada</h1>
        </div>
      </div>
    );
  }

  return <RecordingDetail manifest={manifest} />;
}
