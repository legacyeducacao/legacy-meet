'use client';

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import styles from '@/styles/Recordings.module.css';

interface Rec {
  id: string;
  title?: string;
  roomName: string;
  createdAt: string;
  durationSeconds: number;
  storage: 's3' | 'gdrive';
  transcriptionStatus: string;
  utteranceCount: number;
}

const PAGE_SIZE = 9;

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
  return `${Math.round(seconds / 60)} min`;
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export default function GravacoesPage() {
  const [items, setItems] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch('/api/recordings');
        if (!res.ok) throw new Error(await res.text());
        if (active) setItems(await res.json());
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : 'erro');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((r) => {
      const title = (r.title || r.roomName).toLowerCase();
      if (q && !title.includes(q) && !r.roomName.toLowerCase().includes(q)) return false;
      const day = (r.createdAt || '').slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [items, query, from, to]);

  useEffect(() => {
    setPage(1);
  }, [query, from, to]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleDelete = async (rec: Rec) => {
    if (
      !confirm(
        `Excluir a gravação "${rec.title?.trim() || rec.roomName}"?\nIsso remove o vídeo e a transcrição permanentemente.`,
      )
    ) {
      return;
    }
    setDeletingId(rec.id);
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(rec.id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      setItems((prev) => prev.filter((r) => r.id !== rec.id));
    } catch (e) {
      alert('Falha ao excluir: ' + (e instanceof Error ? e.message : e));
    } finally {
      setDeletingId(null);
    }
  };

  const hasFilters = !!(query || from || to);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <h1>Gravações</h1>
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.toolbarSearch}
          placeholder="Buscar por título…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className={styles.dateField}>
          De
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className={styles.dateField}>
          Até
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        {hasFilters && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              setQuery('');
              setFrom('');
              setTo('');
            }}
          >
            Limpar
          </button>
        )}
      </div>

      {loading && <p className={styles.empty}>Carregando…</p>}
      {error && <p className={styles.empty}>Não foi possível carregar: {error}</p>}
      {!loading && !error && filtered.length === 0 && (
        <p className={styles.empty}>Nenhuma gravação encontrada.</p>
      )}

      <div className={styles.grid}>
        {pageItems.map((rec) => (
          <div key={rec.id} className={styles.card}>
            <button
              type="button"
              className={styles.deleteBtn}
              title="Excluir gravação"
              disabled={deletingId === rec.id}
              onClick={() => handleDelete(rec)}
            >
              <TrashIcon />
            </button>
            <Link href={`/gravacoes/${encodeURIComponent(rec.id)}`} className={styles.cardLink}>
              <p className={styles.cardTitle}>{rec.title?.trim() || `Reunião · ${rec.roomName}`}</p>
              <div className={styles.cardMeta}>
                <span>{formatDate(rec.createdAt)}</span>
                <span>· {formatDuration(rec.durationSeconds)}</span>
                {rec.storage === 'gdrive' && <span className={styles.badge}>Google Drive</span>}
                {rec.transcriptionStatus === 'failed' ? (
                  <span className={styles.badgeFail}>Transcrição falhou</span>
                ) : (
                  <span className={styles.badge}>{rec.utteranceCount} falas</span>
                )}
              </div>
            </Link>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div className={styles.pagination}>
          <button type="button" disabled={safePage <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Anterior
          </button>
          <span>
            {safePage} / {totalPages}
          </span>
          <button type="button" disabled={safePage >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}
