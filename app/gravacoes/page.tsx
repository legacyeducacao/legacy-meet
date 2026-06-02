import Link from 'next/link';
import { listRecordings, type RecordingSummary } from '@/lib/recordings';
import styles from '@/styles/Recordings.module.css';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.round(seconds / 60);
  return `${m} min`;
}

export default async function GravacoesPage() {
  let items: RecordingSummary[] = [];
  let error = '';
  try {
    items = await listRecordings();
  } catch (e) {
    error = e instanceof Error ? e.message : 'erro ao listar gravações';
  }

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <h1>Gravações</h1>
      </div>

      {error && <p className={styles.empty}>Não foi possível carregar: {error}</p>}

      {!error && items.length === 0 && (
        <p className={styles.empty}>Nenhuma gravação transcrita ainda.</p>
      )}

      <div className={styles.grid}>
        {items.map((rec) => (
          <Link key={rec.id} href={`/gravacoes/${encodeURIComponent(rec.id)}`} className={styles.card}>
            <p className={styles.cardTitle}>Reunião · {rec.roomName}</p>
            <div className={styles.cardMeta}>
              <span>{formatDate(rec.createdAt)}</span>
              <span>· {formatDuration(rec.durationSeconds)}</span>
              {rec.storage === 'gdrive' && <span className={styles.badge}>Google Drive</span>}
              {rec.transcriptionStatus === 'complete' && (
                <span className={styles.badge}>{rec.utteranceCount} falas</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
