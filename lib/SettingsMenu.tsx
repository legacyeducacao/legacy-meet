'use client';
import * as React from 'react';
import { Track } from 'livekit-client';
import {
  useMaybeLayoutContext,
  MediaDeviceMenu,
  TrackToggle,
  useRoomContext,
  useIsRecording,
} from '@livekit/components-react';
import styles from '../styles/SettingsMenu.module.css';
import { CameraSettings } from './CameraSettings';
import { MicrophoneSettings } from './MicrophoneSettings';
/**
 * @alpha
 */
export interface SettingsMenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Token do participante — exigido pelos endpoints de gravação (start/stop). */
  participantToken?: string;
}

/**
 * @alpha
 */
export function SettingsMenu({ participantToken, ...props }: SettingsMenuProps) {
  const layoutContext = useMaybeLayoutContext();
  const room = useRoomContext();
  const recordingEndpoint = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT;

  const settings = React.useMemo(() => {
    return {
      media: { camera: true, microphone: true, label: 'Dispositivos', speaker: true },
      recording: recordingEndpoint ? { label: 'Gravação' } : undefined,
    };
  }, []);

  const tabs = React.useMemo(
    () => Object.keys(settings).filter((t) => t !== undefined) as Array<keyof typeof settings>,
    [settings],
  );
  const [activeTab, setActiveTab] = React.useState(tabs[0]);

  const isRecording = useIsRecording();
  const [initialRecStatus, setInitialRecStatus] = React.useState(isRecording);
  const [processingRecRequest, setProcessingRecRequest] = React.useState(false);

  React.useEffect(() => {
    if (initialRecStatus !== isRecording) {
      setProcessingRecRequest(false);
    }
  }, [isRecording, initialRecStatus]);

  const toggleRoomRecording = async () => {
    if (!recordingEndpoint) {
      throw TypeError('Nenhum endpoint de gravação configurado');
    }
    if (room.isE2EEEnabled) {
      throw Error('A gravação de reuniões criptografadas ainda não é suportada');
    }
    setProcessingRecRequest(true);
    setInitialRecStatus(isRecording);
    const params = new URLSearchParams({ roomName: room.name });
    if (participantToken) params.set('token', participantToken);
    let response: Response;
    if (isRecording) {
      response = await fetch(`${recordingEndpoint}/stop?${params.toString()}`);
    } else {
      response = await fetch(`${recordingEndpoint}/start?${params.toString()}`);
    }
    if (response.ok) {
    } else {
      console.error(
        'Error handling recording request, check server logs:',
        response.status,
        response.statusText,
      );
      setProcessingRecRequest(false);
    }
  };

  return (
    <div className="settings-menu" style={{ width: '100%', position: 'relative' }} {...props}>
      <div className={styles.tabs}>
        {tabs.map(
          (tab) =>
            settings[tab] && (
              <button
                className={`${styles.tab} lk-button`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                aria-pressed={tab === activeTab}
              >
                {
                  // @ts-ignore
                  settings[tab].label
                }
              </button>
            ),
        )}
      </div>
      <div className="tab-content">
        {activeTab === 'media' && (
          <>
            {settings.media && settings.media.camera && (
              <>
                <h3>Câmera</h3>
                <section>
                  <CameraSettings />
                </section>
              </>
            )}
            {settings.media && settings.media.microphone && (
              <>
                <h3>Microfone</h3>
                <section>
                  <MicrophoneSettings />
                </section>
              </>
            )}
            {settings.media && settings.media.speaker && (
              <>
                <h3>Alto-falantes e fones</h3>
                <section className="lk-button-group">
                  <span className="lk-button">Saída de áudio</span>
                  <div className="lk-button-group-menu">
                    <MediaDeviceMenu kind="audiooutput"></MediaDeviceMenu>
                  </div>
                </section>
              </>
            )}
          </>
        )}
        {activeTab === 'recording' && (
          <>
            <h3>Gravar reunião</h3>
            <section>
              <p>
                {isRecording
                  ? 'A reunião está sendo gravada'
                  : 'Nenhuma gravação ativa nesta reunião'}
              </p>
              <button disabled={processingRecRequest} onClick={() => toggleRoomRecording()}>
                {isRecording ? 'Parar gravação' : 'Iniciar gravação'}
              </button>
            </section>
          </>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
        <button
          className={`lk-button`}
          onClick={() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })}
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
