import { useIsRecording } from '@livekit/components-react';
import * as React from 'react';

/**
 * Selo discreto e fixo indicando que a reunião está sendo gravada,
 * visível durante toda a duração (enquanto houver gravação ativa).
 */
export function RecordingIndicator() {
  const isRecording = useIsRecording();

  if (!isRecording) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: '0.75rem',
        left: '0.75rem',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '0.45rem',
        padding: '0.35rem 0.75rem',
        borderRadius: '999px',
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
        color: '#fff',
        fontSize: '0.75rem',
        pointerEvents: 'none',
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: '#f91f31',
          animation: 'lk-rec-pulse 1.6s ease-in-out infinite',
        }}
      />
      Esta reunião está sendo gravada
    </div>
  );
}
