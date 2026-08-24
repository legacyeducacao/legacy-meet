'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from '@/components/ui/custom-toast';
import { ArrowLeft, Download, RotateCcw, Search } from 'lucide-react';
import type { RecordingManifest } from '@/lib/recordings';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  return `${Math.round(seconds / 60)} min`;
}

function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-200 dark:bg-yellow-800 rounded-sm px-0.5">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function RecordingDetail({ manifest }: { manifest: RecordingManifest }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [query, setQuery] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [requeued, setRequeued] = useState(false);
  const utterances = manifest.utterances ?? [];
  const failed = manifest.transcriptionStatus === 'failed';
  // Transcrição INCOMPLETA = houve chunks descartados (buracos reais). Não usamos
  // "silêncio no fim" como sinal: uma reunião que só termina em silêncio daria
  // falso-positivo e sugeriria re-transcrever à toa (gasta créditos).
  const skippedCount = manifest.skippedChunks?.length ?? 0;
  const incomplete = !failed && skippedCount > 0;
  const needsRetry = failed || incomplete;

  const retryTranscription = async () => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(manifest.id)}/retry`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(await res.text());
      setRequeued(true);
      toast.success(
        'Reenviada para transcrição. Vai reprocessar em alguns minutos e reaparecer na lista já transcrita.',
      );
    } catch (e) {
      toast.error('Falha ao reenviar: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRetrying(false);
    }
  };

  // Botão de retranscrever reutilizado no banner e no rodapé (evita duplicar o JSX).
  const renderRetry = (size?: React.ComponentProps<typeof Button>['size']) => (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={retryTranscription}
      disabled={retrying || requeued}
      title="Reprocessa a transcrição desta reunião"
    >
      <RotateCcw className={`h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
      {requeued ? 'Reenviada ✓' : retrying ? 'Reenviando…' : 'Transcrever novamente'}
    </Button>
  );
  // Rodapé mostra o botão só quando a transcrição parece COMPLETA (não falha,
  // não incompleta, e não ainda processando) — o banner acima cobre os demais.
  const showFooterRetry = !needsRetry && manifest.transcriptionStatus === 'complete';

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
    <AppShell>
      <div className="space-y-6">
        {/* Back link + title */}
        <div className="space-y-2">
          <Link
            href="/gravacoes"
            aria-label="Voltar"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Voltar para Gravações
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {manifest.title?.trim() || `Reunião · ${manifest.roomName}`}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground">
                {new Date(manifest.createdAt).toLocaleString('pt-BR')}
              </span>
              <Badge variant="secondary">{formatDuration(manifest.durationSeconds)}</Badge>
              {manifest.storage === 'gdrive' ? (
                <Badge variant="secondary">Google Drive</Badge>
              ) : (
                <Badge variant="secondary">MinIO</Badge>
              )}
            </div>
          </div>
        </div>

        {needsRetry && (
          <Card className="rounded-xl border-destructive/40 bg-destructive/5">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-destructive">
                  {failed
                    ? 'A transcrição desta reunião falhou.'
                    : `Transcrição possivelmente incompleta${
                        skippedCount > 0 ? ` (${skippedCount} trecho${skippedCount > 1 ? 's' : ''} não transcrito${skippedCount > 1 ? 's' : ''})` : ''
                      }.`}
                </p>
                <p className="text-xs text-muted-foreground">
                  {requeued
                    ? 'Reenviada. Ela some da lista por alguns minutos e reaparece transcrita quando o worker concluir.'
                    : 'O vídeo continua salvo. Você pode reenviar para transcrever novamente.'}
                </p>
              </div>
              {renderRetry()}
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
          {/* Video card */}
          <Card className="overflow-hidden rounded-xl p-0 gap-0">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              ref={videoRef}
              className="w-full aspect-video bg-black"
              controls
              preload="metadata"
              src={`/api/recordings/${encodeURIComponent(manifest.id)}/video`}
            />
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t bg-muted/30">
              <span className="text-xs text-muted-foreground">
                {manifest.storage === 'gdrive'
                  ? 'Arquivada no Google Drive'
                  : 'Armazenada no MinIO'}
              </span>
              <div className="flex items-center gap-2">
                {/* Retranscrever no rodapé só quando parece completa (o banner
                    acima já mostra o botão nos casos de falha/incompleta). */}
                {showFooterRetry && renderRetry('sm')}
                <Button variant="outline" size="sm" onClick={downloadTxt} type="button">
                  <Download className="h-4 w-4" />
                  Transcrição (.txt)
                </Button>
              </div>
            </div>
          </Card>

          {/* Transcript card */}
          <Card className="rounded-xl flex flex-col gap-0 p-0">
            <CardHeader className="px-4 pt-4 pb-3 border-b">
              <CardTitle className="text-base">Transcrição</CardTitle>
              <div className="relative mt-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  className="pl-9 h-9"
                  placeholder="Buscar na transcrição…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </CardHeader>
            <CardContent className="p-0 flex-1">
              <ScrollArea className="h-[480px]">
                <div className="px-4 py-3 space-y-4">
                  {filtered.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      Nenhuma fala encontrada.
                    </p>
                  )}
                  {filtered.map((u, i) => (
                    <div key={`${u.start}-${i}`} className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{u.speaker}</span>
                        <span
                          className="text-xs text-muted-foreground hover:text-primary cursor-pointer transition-colors tabular-nums"
                          onClick={() => seek(u.start)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === 'Enter' && seek(u.start)}
                        >
                          {formatTimestamp(u.start)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground/80 leading-relaxed">
                        {highlight(u.text, query)}
                      </p>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
