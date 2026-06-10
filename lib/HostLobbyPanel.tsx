'use client';

import * as React from 'react';
import { useParticipants, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

// Painel exibido apenas para o anfitrião: lista convidados aguardando na "sala de
// espera" (atributo lobby='true') e permite Admitir ou Recusar cada um.
export function HostLobbyPanel({ hostKey }: { hostKey?: string }) {
  const room = useRoomContext();
  const participants = useParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantAttributesChanged,
    ],
  });
  const [busy, setBusy] = React.useState<string | null>(null);

  const waiting = participants.filter(
    (p) => !p.isLocal && p.attributes?.lobby === 'true',
  );

  // Notificação sonora quando um NOVO convidado entra na sala de espera.
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const prevWaitingRef = React.useRef<Set<string>>(new Set());
  const waitingKey = waiting
    .map((p) => p.identity)
    .sort()
    .join(',');

  React.useEffect(() => {
    if (typeof Audio !== 'undefined' && !audioRef.current) {
      const a = new Audio('/correct-bell-twinkle-jam-fx-1-00-05.mp3');
      a.volume = 0.7;
      a.preload = 'auto';
      audioRef.current = a;
    }
  }, []);

  React.useEffect(() => {
    const current = new Set(waiting.map((p) => p.identity));
    const isNew = [...current].some((id) => !prevWaitingRef.current.has(id));
    if (isNew && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {
        /* autoplay bloqueado — host ainda não interagiu; ignora */
      });
    }
    prevWaitingRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingKey]);

  const act = React.useCallback(
    async (path: 'admit' | 'reject', identity: string) => {
      setBusy(identity);
      try {
        const resp = await fetch(`/api/room/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: room.name, identity, hostKey }),
        });
        if (!resp.ok) {
          const msg = await resp.text().catch(() => '');
          console.error(`Falha ao ${path === 'admit' ? 'admitir' : 'recusar'} (${resp.status}):`, msg);
          alert(
            `Não foi possível ${path === 'admit' ? 'admitir' : 'recusar'} o convidado.` +
              (msg ? ` ${msg}` : ''),
          );
        }
      } catch (e) {
        console.error(`Falha ao ${path === 'admit' ? 'admitir' : 'recusar'} convidado:`, e);
      } finally {
        setBusy(null);
      }
    },
    [room, hostKey],
  );

  if (waiting.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: '0.75rem',
        right: '0.75rem',
        zIndex: 30,
        width: 'min(92vw, 320px)',
        background: 'rgba(15, 39, 66, 0.96)',
        color: '#fff',
        border: '1px solid rgba(151, 198, 255, 0.3)',
        borderRadius: '0.85rem',
        padding: '0.9rem 0.95rem',
        boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.7rem' }}>
        Aguardando para entrar ({waiting.length})
      </div>
      {waiting.map((p) => (
        <div
          key={p.identity}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            marginBottom: '0.55rem',
          }}
        >
          <span
            style={{
              fontSize: '0.85rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}
            title={p.name || p.identity}
          >
            {p.name || p.identity}
          </span>
          <span style={{ display: 'flex', gap: '0.35rem', flexShrink: 0 }}>
            <button
              type="button"
              disabled={busy === p.identity}
              onClick={() => act('admit', p.identity)}
              style={{
                cursor: busy === p.identity ? 'default' : 'pointer',
                border: 'none',
                borderRadius: '0.5rem',
                padding: '0.35rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: '#2f8f4e',
                color: '#fff',
                opacity: busy === p.identity ? 0.6 : 1,
              }}
            >
              Admitir
            </button>
            <button
              type="button"
              disabled={busy === p.identity}
              onClick={() => act('reject', p.identity)}
              style={{
                cursor: busy === p.identity ? 'default' : 'pointer',
                border: '1px solid rgba(255, 255, 255, 0.25)',
                borderRadius: '0.5rem',
                padding: '0.35rem 0.7rem',
                fontSize: '0.78rem',
                fontWeight: 600,
                background: 'transparent',
                color: '#fff',
                opacity: busy === p.identity ? 0.6 : 1,
              }}
            >
              Recusar
            </button>
          </span>
        </div>
      ))}
    </div>
  );
}
