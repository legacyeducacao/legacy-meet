import React from 'react';
import { useKrispNoiseFilter } from '@livekit/components-react/krisp';
import { TrackToggle } from '@livekit/components-react';
import { MediaDeviceMenu } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { isLowPowerDevice, KRISP_FILTER_OPTIONS } from './client-utils';

export function MicrophoneSettings() {
  const { isNoiseFilterEnabled, setNoiseFilterEnabled, isNoiseFilterPending } = useKrispNoiseFilter(
    { filterOptions: KRISP_FILTER_OPTIONS },
  );

  React.useEffect(() => {
    // Krisp por padrão fora de máquinas fracas (só funciona no LiveKit Cloud).
    setNoiseFilterEnabled(!isLowPowerDevice());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '10px',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <section className="lk-button-group">
        <TrackToggle source={Track.Source.Microphone}>Microfone</TrackToggle>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="audioinput" />
        </div>
      </section>

      <button
        className="lk-button"
        onClick={() => setNoiseFilterEnabled(!isNoiseFilterEnabled)}
        disabled={isNoiseFilterPending}
        aria-pressed={isNoiseFilterEnabled}
      >
        {isNoiseFilterEnabled
          ? 'Desativar cancelamento de ruído avançado'
          : 'Ativar cancelamento de ruído avançado'}
      </button>
    </div>
  );
}
