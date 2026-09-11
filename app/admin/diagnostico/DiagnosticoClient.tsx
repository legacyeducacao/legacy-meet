'use client';

import React from 'react';
import { Activity, RefreshCw, ShieldAlert, SignalHigh, Video } from 'lucide-react';
import { AppShell } from '@/components/AppShell';
import { PageHeader } from '@/components/patterns/PageHeader';
import { EmptyState } from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { summarizeTelemetry, verdictMessage, type TelemetrySummary } from '@/lib/telemetrySummary';
import type { TelemetryRecord } from '@/lib/telemetryStore';

const EVENT_LABEL: Record<string, string> = {
  ice_transport: 'Caminho da mídia',
  reconnecting: 'Reconectando',
  reconnected: 'Reconectou',
  reconnect_gave_up: 'Queda sem retorno',
  disconnected: 'Saiu da reunião',
  connection_quality: 'Qualidade ruim',
  media_error: 'Erro de dispositivo',
  device_enable_failed: 'Falha ao ligar dispositivo',
  prejoin_error: 'Erro na pré-entrada',
  iframe_permissions_blocked: 'Bloqueado dentro do CRM',
  connect_failed: 'Falha ao conectar',
  connection_details_failed: 'Falha ao preparar a entrada',
};

/** Eventos que merecem destaque visual por indicarem problema. */
const BAD_EVENTS = new Set([
  'reconnect_gave_up',
  'connect_failed',
  'connection_details_failed',
  'media_error',
  'device_enable_failed',
  'prejoin_error',
  'iframe_permissions_blocked',
]);

const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD no fuso local

function describeEvent(e: TelemetryRecord): string {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const error = d.error as { name?: string; message?: string } | undefined;
  switch (e.evt) {
    case 'ice_transport': {
      const via = d.candidateType === 'relay' ? 'via TURN' : String(d.protocol ?? '—');
      const rtt = typeof d.roundTripTimeMs === 'number' ? ` · ${d.roundTripTimeMs} ms` : '';
      return `${via}${rtt}`;
    }
    case 'reconnected':
      return typeof d.outageMs === 'number' ? `fora por ${(d.outageMs / 1000).toFixed(1)} s` : '';
    case 'reconnect_gave_up':
    case 'disconnected':
      return String(d.reason ?? '');
    case 'connection_quality':
      return String(d.quality ?? '');
    case 'device_enable_failed':
      return [d.source, error?.name].filter(Boolean).join(' · ');
    default:
      return [error?.name, error?.message].filter(Boolean).join(': ').slice(0, 120);
  }
}

function VerdictCard({ summary }: { summary: TelemetrySummary }) {
  const { verdict, transport } = summary;
  const tone =
    verdict === 'degradado'
      ? 'border-destructive/40 bg-destructive/5'
      : verdict === 'misto'
        ? 'border-amber-500/40 bg-amber-500/5'
        : 'border-border';
  const share = transport.total ? Math.round((transport.udp / transport.total) * 100) : 0;

  return (
    <Card className={`rounded-xl ${tone}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <SignalHigh className="h-4 w-4" />
          Caminho da mídia
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-extrabold tracking-tight tabular-nums">{share}%</span>
          <span className="text-sm text-muted-foreground">em UDP direto</span>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">{verdictMessage(verdict)}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary">UDP direto: {transport.udp}</Badge>
          <Badge variant="secondary">TCP: {transport.tcp}</Badge>
          <Badge variant="secondary">Via TURN: {transport.relay}</Badge>
          {transport.medianRttMs !== null && (
            <Badge variant="secondary">Latência mediana: {transport.medianRttMs} ms</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export default function DiagnosticoClient() {
  const [date, setDate] = React.useState(today());
  const [events, setEvents] = React.useState<TelemetryRecord[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async (day: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/telemetry?date=${encodeURIComponent(day)}`);
      if (!res.ok) throw new Error(await res.text());
      setEvents((await res.json()) as TelemetryRecord[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'erro ao carregar');
      setEvents(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load(date);
  }, [date, load]);

  const summary = React.useMemo(() => (events ? summarizeTelemetry(events) : null), [events]);
  // Mais recentes primeiro: é o que se olha ao investigar uma reclamação de agora.
  const recent = React.useMemo(() => (events ? [...events].reverse().slice(0, 200) : []), [events]);

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Diagnóstico"
          subtitle="O que os navegadores dos participantes relataram: caminho da mídia, quedas de conexão e erros de câmera e microfone."
          actions={
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={date}
                max={today()}
                onChange={(e) => setDate(e.target.value)}
                className="h-9 w-[10.5rem]"
                aria-label="Dia"
              />
              <Button variant="outline" size="sm" onClick={() => load(date)} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>
          }
        />

        {error && (
          <Card className="rounded-xl border-destructive/40 bg-destructive/5">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {loading && !events && (
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
            <Skeleton className="h-44 rounded-xl" />
          </div>
        )}

        {summary && summary.total === 0 && (
          <Card className="rounded-xl">
            <CardContent>
              <EmptyState
                icon={<Activity className="h-6 w-6" />}
                title="Nenhum evento neste dia"
                description="A telemetria só registra problemas e o caminho da mídia. Um dia sem eventos costuma ser um bom sinal; se o app acabou de subir, faça uma reunião de teste e fique pelo menos 20 segundos."
              />
            </CardContent>
          </Card>
        )}

        {summary && summary.total > 0 && (
          <>
            <div className="grid gap-4 lg:grid-cols-3">
              <VerdictCard summary={summary} />

              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Estabilidade
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <StatRow label="Reconexões iniciadas" value={summary.stability.reconnecting} />
                  <StatRow label="Reconexões concluídas" value={summary.stability.reconnected} />
                  <StatRow label="Quedas sem retorno" value={summary.stability.gaveUp} />
                  <StatRow label="Qualidade ruim ou perdida" value={summary.stability.poorQuality} />
                  <StatRow
                    label="Duração mediana da queda"
                    value={
                      summary.stability.medianOutageMs !== null
                        ? `${(summary.stability.medianOutageMs / 1000).toFixed(1)} s`
                        : '—'
                    }
                  />
                </CardContent>
              </Card>

              <Card className="rounded-xl">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Video className="h-4 w-4" />
                    Câmera e microfone
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <StatRow label="Erros de dispositivo" value={summary.devices.mediaErrors} />
                  <StatRow label="Falhas ao ligar" value={summary.devices.enableFailed} />
                  <StatRow label="Permissão negada" value={summary.devices.permissionDenied} />
                  <StatRow label="Bloqueado dentro do CRM" value={summary.devices.iframeBlocked} />
                  <StatRow label="Falhas ao conectar" value={summary.devices.connectFailed} />
                </CardContent>
              </Card>
            </div>

            {summary.devices.iframeBlocked > 0 && (
              <Card className="rounded-xl border-amber-500/40 bg-amber-500/5">
                <CardContent className="flex gap-3 py-4">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-amber-600" />
                  <p className="text-sm text-foreground/80">
                    Há participantes abrindo a reunião dentro de outro sistema que não libera câmera
                    e microfone. Peça para abrirem pelo link em uma aba própria do navegador, ou
                    libere o acesso no sistema que embute a sala.
                  </p>
                </CardContent>
              </Card>
            )}

            <Card className="rounded-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Eventos ({summary.total} em {summary.rooms} {summary.rooms === 1 ? 'sala' : 'salas'})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y">
                  {recent.map((e, i) => (
                    <div
                      key={`${e.receivedAt}-${i}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm"
                    >
                      <span className="text-xs text-muted-foreground tabular-nums w-16 shrink-0">
                        {new Date(e.at).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </span>
                      <Badge variant={BAD_EVENTS.has(e.evt) ? 'destructive' : 'secondary'}>
                        {EVENT_LABEL[e.evt] ?? e.evt}
                      </Badge>
                      <span className="text-foreground/80 min-w-0 flex-1 truncate">
                        {describeEvent(e)}
                      </span>
                      <span className="text-xs text-muted-foreground truncate max-w-[12rem]">
                        {e.identity ?? e.room ?? ''}
                      </span>
                    </div>
                  ))}
                </div>
                {summary.total > recent.length && (
                  <p className="px-4 py-3 text-xs text-muted-foreground border-t">
                    Mostrando os {recent.length} eventos mais recentes de {summary.total}.
                  </p>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
