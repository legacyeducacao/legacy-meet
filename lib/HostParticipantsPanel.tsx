'use client';

import * as React from 'react';
import { useParticipants, useRoomContext } from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';

const box: React.CSSProperties = {
  width: 'min(92vw, 320px)',
  background: 'rgba(15, 39, 66, 0.96)',
  color: '#fff',
  border: '1px solid rgba(151, 198, 255, 0.3)',
  borderRadius: '0.85rem',
  boxShadow: '0 16px 40px rgba(0, 0, 0, 0.45)',
  backdropFilter: 'blur(4px)',
  overflow: 'hidden',
};
const smallBtn = (bg: string, border = 'none'): React.CSSProperties => ({
  cursor: 'pointer',
  border,
  borderRadius: '0.5rem',
  padding: '0.3rem 0.6rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: bg,
  color: '#fff',
});

// Painel do anfitrião (e co-anfitrião) para gerenciar participantes da reunião:
// mutar microfone e (só o anfitrião principal) promover a co-anfitrião.
export function HostParticipantsPanel({
  hostKey,
  participantToken,
  canPromote,
}: {
  hostKey?: string;
  participantToken?: string;
  canPromote?: boolean;
}) {
  const room = useRoomContext();
  const participants = useParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.TrackPublished,
    ],
  });
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  // Participantes admitidos (fora da sala de espera, sem o robô de gravação).
  const people = participants.filter(
    (p) => !p.isLocal && p.attributes?.lobby !== 'true' && !p.identity.startsWith('EG_'),
  );

  const post = React.useCallback(
    async (path: 'mute' | 'promote', payload: Record<string, unknown>, key: string) => {
      setBusy(key);
      try {
        const resp = await fetch(`/api/room/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomName: room.name, hostKey, participantToken, ...payload }),
        });
        if (!resp.ok) {
          const msg = await resp.text().catch(() => '');
          alert(`Ação não permitida.${msg ? ` ${msg}` : ''}`);
        }
      } catch (e) {
        console.error(e);
      } finally {
        setBusy(null);
      }
    },
    [room, hostKey, participantToken],
  );

  return (
    <div style={box}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
          color: '#fff',
          fontWeight: 700,
          fontSize: '0.85rem',
          padding: '0.7rem 0.9rem',
        }}
      >
        👥 Participantes ({people.length}) {open ? '▾' : '▸'}
      </button>
      {open && people.length > 0 && (
        <div style={{ padding: '0 0.9rem 0.8rem' }}>
          {people.map((p) => {
            const mic = p.getTrackPublication(Track.Source.Microphone);
            const muted = mic?.isMuted ?? true;
            const isCohost = p.attributes?.cohost === 'true';
            return (
              <div
                key={p.identity}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.4rem',
                  marginTop: '0.55rem',
                }}
              >
                <span
                  style={{
                    fontSize: '0.82rem',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                  }}
                  title={p.name || p.identity}
                >
                  {p.name || p.identity}
                  {isCohost ? ' ⭐' : ''}
                </span>
                <span style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }}>
                  <button
                    type="button"
                    disabled={busy === p.identity || !mic?.trackSid || muted}
                    title={
                      muted
                        ? 'Microfone mutado — só o próprio participante pode reativar'
                        : !mic?.trackSid
                          ? 'Sem microfone publicado'
                          : 'Mutar microfone'
                    }
                    onClick={() =>
                      post(
                        'mute',
                        { identity: p.identity, trackSid: mic!.trackSid, muted: true },
                        p.identity,
                      )
                    }
                    style={{
                      ...smallBtn(muted ? 'transparent' : '#7a3030', '1px solid rgba(255,255,255,0.25)'),
                      opacity: !mic?.trackSid || muted ? 0.5 : 1,
                    }}
                  >
                    {muted ? 'Mutado' : 'Mutar'}
                  </button>
                  {canPromote && (
                    <button
                      type="button"
                      disabled={busy === p.identity}
                      onClick={() =>
                        post('promote', { identity: p.identity, demote: isCohost }, p.identity)
                      }
                      style={smallBtn(isCohost ? '#555' : '#2f6f8f')}
                    >
                      {isCohost ? 'Remover' : 'Tornar anfitrião'}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
