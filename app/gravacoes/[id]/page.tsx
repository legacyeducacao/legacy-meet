import Link from 'next/link';
import { getManifest } from '@/lib/recordings';
import { RecordingDetail } from './RecordingDetail';
import styles from '@/styles/Recordings.module.css';

export const dynamic = 'force-dynamic';

export default async function Page(ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const manifest = await getManifest(id);

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
