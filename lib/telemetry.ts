'use client';

/**
 * Telemetria do cliente da sala: eventos raros e pequenos (erro de câmera/
 * microfone, falha/queda/reconexão) enviados para /api/telemetry com o
 * contexto do navegador. Antes disso os relatos dos usuários não deixavam
 * rastro nenhum no servidor — cada erro ficava só no console de quem viu.
 *
 * Usa sendBeacon quando existe (sobrevive ao fechamento da aba) e fetch
 * keepalive como fallback. Nunca lança: telemetria não pode quebrar a sala.
 */
export type TelemetryEvent =
  | 'prejoin_error'
  | 'connect_failed'
  | 'reconnecting'
  | 'reconnected'
  | 'reconnect_gave_up'
  | 'disconnected'
  | 'media_error'
  | 'device_enable_failed'
  | 'connection_quality'
  | 'iframe_permissions_blocked'
  | 'connection_details_failed';

export interface TelemetryContext {
  room?: string;
  identity?: string;
  isHost?: boolean;
}

let context: TelemetryContext = {};

export function setTelemetryContext(ctx: TelemetryContext) {
  context = { ...context, ...ctx };
}

type NetworkInformation = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

export function browserInfo() {
  if (typeof navigator === 'undefined') return {};
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return {
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    memoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    lang: navigator.language,
    online: navigator.onLine,
    net: conn
      ? { type: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt, saveData: conn.saveData }
      : undefined,
    embedded: typeof window !== 'undefined' && window.self !== window.top,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
    screen:
      typeof window !== 'undefined' ? `${window.screen?.width}x${window.screen?.height}` : undefined,
  };
}

export function serializeError(e: unknown): { name?: string; message: string } {
  if (e instanceof Error) return { name: e.name, message: e.message };
  return { message: String(e) };
}

export function reportClientEvent(evt: TelemetryEvent, data: Record<string, unknown> = {}) {
  try {
    if (typeof window === 'undefined') return;
    const payload = JSON.stringify({
      evt,
      at: new Date().toISOString(),
      ...context,
      browser: browserInfo(),
      data,
    });
    const url = '/api/telemetry';
    if (typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      if (ok) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // nunca propaga
  }
}
