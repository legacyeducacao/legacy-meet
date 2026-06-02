'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { RecordingManifest } from '@/lib/recordings';
import styles from '@/styles/Recordings.module.css';

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className={styles.mark}>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function RecordingDetail({ manifest }: { manifest: RecordingManifest }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [query, setQuery] = useState('');
  const utterances = manifest.utterances ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return utterances;
    return utterances.filter(
      (u) => u.text.toLowerCase().includes(q) || u.speaker.toLowerCase().includes(q),
    );
  }, [query, utterances]);

  const seek = (t: number) => {
    const v = videoRef.current;
    if (v) {
      v.currentTime = t;
      v.play().catch(() => {});
    }
  };

  const downloadTxt = () => {
    const text = utterances
      .map((u) => `[${formatTimestamp(u.start)}] ${u.speaker}: ${u.text}`)
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${manifest.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <Link className={styles.back} href="/gravacoes" aria-label="Voltar">
          ←
        </Link>
        <div>
          <h1>Reunião · {manifest.roomName}</h1>
          <div className={styles.subtitle}>
            {new Date(manifest.createdAt).toLocaleString('pt-BR')}
          </div>
        </div>
      </div>

      <div className={styles.detail}>
        <div className={styles.videoCard}>
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            ref={videoRef}
            className={styles.video}
            controls
            preload="metadata"
            src={`/api/recordings/${encodeURIComponent(manifest.id)}/video`}
          />
          <div className={styles.videoFooter}>
            <span>
              {manifest.storage === 'gdrive'
                ? 'Arquivada no Google Drive'
                : 'Armazenada no MinIO'}
            </span>
            <button className={styles.download} onClick={downloadTxt} type="button">
              Transcrição (.txt)
            </button>
          </div>
        </div>

        <div className={styles.transcriptCard}>
          <p className={styles.transcriptHeader}>Transcrição</p>
          <input
            className={styles.search}
            placeholder="Buscar na transcrição…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={styles.utterances}>
            {filtered.length === 0 && (
              <p className={styles.subtitle}>Nenhuma fala encontrada.</p>
            )}
            {filtered.map((u, i) => (
              <div className={styles.utterance} key={`${u.start}-${i}`}>
                <div className={styles.utteranceHead}>
                  <span className={styles.speaker}>{u.speaker}</span>
                  <span
                    className={styles.timestamp}
                    onClick={() => seek(u.start)}
                    role="button"
                    tabIndex={0}
                  >
                    {formatTimestamp(u.start)}
                  </span>
                </div>
                <p className={styles.uttText}>{highlight(u.text, query)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
