'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { decodePassphrase } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import { formatChatMessageLinks, LocalUserChoices, PreJoin, RoomContext } from '@livekit/components-react';
import { LegacyVideoConference } from '@/lib/LegacyVideoConference';
import { HostLobbyPanel } from '@/lib/HostLobbyPanel';
import {
  ExternalE2EEKeyProvider,
  RoomOptions,
  VideoCodec,
  VideoPresets,
  Room,
  DeviceUnsupportedError,
  RoomConnectOptions,
  RoomEvent,
  TrackPublishDefaults,
  VideoCaptureOptions,
} from 'livekit-client';
import { useRouter } from 'next/navigation';
import { useSetupE2EE } from '@/lib/useSetupE2EE';
import { useLowCPUOptimizer } from '@/lib/usePerfomanceOptimiser';

const CONN_DETAILS_ENDPOINT =
  process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT ?? '/api/connection-details';
const SHOW_SETTINGS_MENU = process.env.NEXT_PUBLIC_SHOW_SETTINGS_MENU == 'true';

export function PageClientImpl(props: {
  roomName: string;
  region?: string;
  hq: boolean;
  codec: VideoCodec;
  singlePeerConnection: boolean;
  hostName: string;
  title: string;
  record: boolean;
  transcribe: boolean;
  hostKey: string;
}) {
  const [preJoinChoices, setPreJoinChoices] = React.useState<LocalUserChoices | undefined>(
    undefined,
  );
  const preJoinDefaults = React.useMemo(() => {
    return {
      username: props.hostName,
      videoEnabled: true,
      audioEnabled: true,
    };
  }, [props.hostName]);
  const [connectionDetails, setConnectionDetails] = React.useState<ConnectionDetails | undefined>(
    undefined,
  );

  // Limpa a barra de endereços: remove `name` (nome do host) e `h` (chave de
  // anfitrião) da URL logo ao carregar. Os valores já foram lidos no servidor e
  // estão nas props, então o host segue pré-preenchido e com privilégio; mas se
  // ele copiar a URL da barra para convidar, o link não leva o nome dele (o
  // convidado digita o próprio) nem vira anfitrião por engano.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (url.searchParams.has('name') || url.searchParams.has('h')) {
      url.searchParams.delete('name');
      url.searchParams.delete('h');
      const qs = url.searchParams.toString();
      window.history.replaceState(null, '', url.pathname + (qs ? `?${qs}` : ''));
    }
  }, []);

  // Nome é obrigatório para entrar (vale para host e convidado).
  const handleValidate = React.useCallback(
    (values: LocalUserChoices) => !!values.username && values.username.trim().length > 0,
    [],
  );

  const handlePreJoinSubmit = React.useCallback(async (values: LocalUserChoices) => {
    setPreJoinChoices(values);
    const url = new URL(CONN_DETAILS_ENDPOINT, window.location.origin);
    url.searchParams.append('roomName', props.roomName);
    url.searchParams.append('participantName', values.username);
    if (props.region) {
      url.searchParams.append('region', props.region);
    }
    if (props.hostKey) {
      url.searchParams.append('hostKey', props.hostKey);
    }
    const connectionDetailsResp = await fetch(url.toString());
    const connectionDetailsData = await connectionDetailsResp.json();
    setConnectionDetails(connectionDetailsData);
  }, [props.roomName, props.region, props.hostKey]);
  const handlePreJoinError = React.useCallback((e: any) => console.error(e), []);

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      {connectionDetails === undefined || preJoinChoices === undefined ? (
        <div className="prejoin-stage">
          <div className="prejoin-card">
            <div className="prejoin-header">
              <img src="/favicon.svg" alt="Legacy Meet" width={52} height={52} />
              <h1>Entrar na reunião</h1>
              <p>Verifique sua câmera e microfone antes de entrar.</p>
            </div>
            <PreJoin
              defaults={preJoinDefaults}
              onSubmit={handlePreJoinSubmit}
              onError={handlePreJoinError}
              onValidate={handleValidate}
              joinLabel="Entrar na reunião"
              micLabel="Microfone"
              camLabel="Câmera"
              userLabel="Seu nome"
              // Não restaura o nome do localStorage: o host vem pré-preenchido pelo
              // parâmetro da URL; o convidado (link sem nome) digita o próprio.
              persistUserChoices={false}
            />
          </div>
        </div>
      ) : (
        <VideoConferenceComponent
          connectionDetails={connectionDetails}
          userChoices={preJoinChoices}
          options={{
            codec: props.codec,
            hq: props.hq,
            singlePeerConnection: props.singlePeerConnection,
            record: props.record,
            transcribe: props.transcribe,
            title: props.title,
            hostKey: props.hostKey,
          }}
        />
      )}
    </main>
  );
}

function VideoConferenceComponent(props: {
  userChoices: LocalUserChoices;
  connectionDetails: ConnectionDetails;
  options: {
    hq: boolean;
    codec: VideoCodec;
    singlePeerConnection: boolean;
    record: boolean;
    transcribe: boolean;
    title: string;
    hostKey: string;
  };
}) {
  const keyProvider = new ExternalE2EEKeyProvider();
  const { worker, e2eePassphrase } = useSetupE2EE();
  const e2eeEnabled = !!(e2eePassphrase && worker);

  const [e2eeSetupComplete, setE2eeSetupComplete] = React.useState(false);

  const roomOptions = React.useMemo((): RoomOptions => {
    let videoCodec: VideoCodec | undefined = props.options.codec ? props.options.codec : 'vp9';
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h1080 : VideoPresets.h540,
    };
    const publishDefaults: TrackPublishDefaults = {
      dtx: false,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
    };
    return {
      videoCaptureDefaults: videoCaptureDefaults,
      publishDefaults: publishDefaults,
      audioCaptureDefaults: {
        deviceId: props.userChoices.audioDeviceId ?? undefined,
        // Cancelamento de ruído + eco ligados; auto-ganho DESLIGADO (evita o volume
        // variar sozinho/"pumping"). O cancelamento de eco é mantido pra não gerar
        // microfonia em quem usa alto-falante.
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: false,
      },
      adaptiveStream: true,
      dynacast: true,
      e2ee: keyProvider && worker && e2eeEnabled ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(decodePassphrase(e2eePassphrase))
        .then(() => {
          room.setE2EEEnabled(true).catch((e) => {
            if (e instanceof DeviceUnsupportedError) {
              alert(
                `Você está tentando entrar em uma reunião criptografada, mas seu navegador não tem suporte. Atualize-o para a versão mais recente e tente novamente.`,
              );
              console.error(e);
            } else {
              throw e;
            }
          });
        })
        .then(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase]);

  const connectOptions = React.useMemo((): RoomConnectOptions => {
    return {
      autoSubscribe: true,
    };
  }, []);

  // Sala de espera: o host (equipe logada) entra direto; o convidado entra "admitido"
  // somente quando o host autoriza (o servidor concede canPublish/canSubscribe).
  const isHost = props.connectionDetails.isHost;
  const [admitted, setAdmitted] = React.useState(isHost);
  const handlePermissions = React.useCallback(() => {
    if (room.localParticipant.permissions?.canPublish) {
      setAdmitted(true);
    }
  }, [room]);

  // Co-anfitrião: o anfitrião principal pode promover (atributo cohost='true');
  // o cliente promovido passa a ver os painéis de anfitrião.
  const [isCohost, setIsCohost] = React.useState(false);
  React.useEffect(() => {
    const update = () => setIsCohost(room.localParticipant.attributes?.cohost === 'true');
    update();
    room.on(RoomEvent.ParticipantAttributesChanged, update);
    room.on(RoomEvent.Connected, update);
    return () => {
      room.off(RoomEvent.ParticipantAttributesChanged, update);
      room.off(RoomEvent.Connected, update);
    };
  }, [room]);

  // Coleta os nomes de quem participou (para identificar os speakers na transcrição)
  const participantNamesRef = React.useRef<Set<string>>(new Set());
  const collectParticipants = React.useCallback(() => {
    const add = (n?: string) => {
      if (n && n.trim()) participantNamesRef.current.add(n.trim());
    };
    add(room.localParticipant?.name);
    room.remoteParticipants.forEach((p) => add(p.name));
  }, [room]);

  // Gravação automática ao entrar; bucket/pasta definidos no /api/record/start.
  const recordingStartedRef = React.useRef(false);
  const handleConnected = React.useCallback(() => {
    collectParticipants();
    // Convidado: sinaliza que está na sala de espera para o host autorizar.
    if (!isHost) {
      room.localParticipant.setAttributes({ lobby: 'true' }).catch(() => {});
    }
    const endpoint = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT;
    if (!endpoint || !props.options.record || recordingStartedRef.current) {
      return;
    }
    recordingStartedRef.current = true;
    const params = new URLSearchParams({
      roomName: room.name,
      transcribe: props.options.transcribe ? '1' : '0',
      title: props.options.title,
      host: props.userChoices.username ?? '',
    });
    fetch(`${endpoint}/start?${params.toString()}`).catch((error) =>
      console.error('Falha ao iniciar a gravação automática:', error),
    );
  }, [room, collectParticipants, props.options, props.userChoices.username, isHost]);

  React.useEffect(() => {
    room.on(RoomEvent.Disconnected, handleOnLeave);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleMediaError);
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.ParticipantConnected, collectParticipants);
    room.on(RoomEvent.ParticipantPermissionsChanged, handlePermissions);

    if (e2eeSetupComplete) {
      room
        .connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        )
        .catch((error) => {
          handleError(error);
        });
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.EncryptionError, handleEncryptionError);
      room.off(RoomEvent.MediaDevicesError, handleMediaError);
      room.off(RoomEvent.Connected, handleConnected);
      room.off(RoomEvent.ParticipantConnected, collectParticipants);
      room.off(RoomEvent.ParticipantPermissionsChanged, handlePermissions);
    };
  }, [e2eeSetupComplete, room, props.connectionDetails, props.userChoices]);

  // Liga câmera/microfone somente quando admitido (host: imediatamente; convidado:
  // após o host autorizar). Convidado limpa o atributo de sala de espera ao entrar.
  React.useEffect(() => {
    if (!admitted) return;
    if (props.userChoices.videoEnabled) {
      // A câmera pode estar sendo liberada pelo PreJoin no instante do ingresso
      // ("Timeout starting video source") — tenta uma segunda vez antes de desistir.
      (async () => {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
          try {
            await room.localParticipant.setCameraEnabled(true);
          } catch (error) {
            console.error('Falha ao habilitar a câmera (2 tentativas):', error);
            toast.error(
              'Não foi possível iniciar a câmera (pode estar em uso por outro app). Você entrou sem vídeo — ative a câmera pela barra quando estiver livre.',
              { duration: 6000 },
            );
          }
        }
      })();
    }
    if (props.userChoices.audioEnabled) {
      room.localParticipant.setMicrophoneEnabled(true).catch((error) => {
        console.error('Falha ao habilitar o microfone:', error);
      });
    }
    if (!isHost) {
      room.localParticipant.setAttributes({ lobby: '' }).catch(() => {});
    }
  }, [admitted, room, props.userChoices.videoEnabled, props.userChoices.audioEnabled, isHost]);

  const lowPowerMode = useLowCPUOptimizer(room);

  const router = useRouter();
  const handleOnLeave = React.useCallback(() => {
    // envia os nomes dos participantes para o meta sidecar (identificação de speakers)
    collectParticipants();
    const names = [...participantNamesRef.current];
    if (names.length) {
      fetch(`/api/record/participants?roomName=${encodeURIComponent(room.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
        keepalive: true,
      }).catch(() => {});
    }
    // host=1 quando é anfitrião → o /obrigado NÃO mostra o NPS (NPS é só do cliente).
    router.push(`/obrigado?room=${encodeURIComponent(room.name)}${isHost ? '&host=1' : ''}`);
  }, [router, room, collectParticipants, isHost]);
  const handleError = React.useCallback((error: Error) => {
    // Usado na falha de CONEXÃO com a sala — avisa sem popup nativo bloqueante.
    console.error(error);
    toast.error('Não foi possível conectar à reunião. Verifique sua conexão e tente novamente.');
  }, []);
  // Erros de dispositivo de mídia (ex.: "Timeout starting video source") já são
  // tratados de forma amigável (retry + toast + ingresso sem vídeo) — aqui só
  // registramos no console, sem alert disruptivo.
  const handleMediaError = React.useCallback((error: Error) => {
    console.error('Erro de dispositivo de mídia:', error);
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Ocorreu um erro inesperado de criptografia, verifique o console para mais detalhes: ${error.message}`,
    );
  }, []);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  return (
    <div className="lk-room-container">
      <RoomContext.Provider value={room}>
        {admitted ? (
          <>
            <KeyboardShortcuts />
            <RecordingIndicator />
            <LegacyVideoConference
              chatMessageFormatter={formatChatMessageLinks}
              SettingsComponent={SHOW_SETTINGS_MENU ? SettingsMenu : undefined}
              hostControls={
                isHost || isCohost
                  ? {
                      hostKey: props.options.hostKey,
                      participantToken: props.connectionDetails.participantToken,
                      canPromote: isHost,
                    }
                  : undefined
              }
            />
            {(isHost || isCohost) && (
              <div
                style={{
                  position: 'absolute',
                  top: '0.75rem',
                  right: '0.75rem',
                  zIndex: 30,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  alignItems: 'flex-end',
                }}
              >
                <HostLobbyPanel
                  hostKey={props.options.hostKey}
                  participantToken={props.connectionDetails.participantToken}
                />
              </div>
            )}
            <DebugMode />
          </>
        ) : (
          <WaitingRoom name={props.userChoices.username} onLeave={() => room.disconnect()} />
        )}
      </RoomContext.Provider>
    </div>
  );
}

function WaitingRoom(props: { name?: string; onLeave: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '1.25rem',
        padding: '2rem',
        textAlign: 'center',
        background:
          'radial-gradient(circle at 50% 18%, rgba(39, 82, 134, 0.3) 0%, transparent 55%), linear-gradient(160deg, #061222 0%, #0a1c33 100%)',
      }}
    >
      <img
        src="/logo-legacy-meet.svg"
        alt="Legacy Meet"
        style={{ width: 64, height: 64, filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.45))' }}
      />
      <div
        style={{
          width: 36,
          height: 36,
          border: '3px solid rgba(151, 198, 255, 0.25)',
          borderTopColor: '#97c6ff',
          borderRadius: '50%',
          animation: 'lk-lobby-spin 0.9s linear infinite',
        }}
      />
      <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>
        Aguardando o anfitrião autorizar sua entrada
      </h1>
      <p style={{ margin: 0, maxWidth: 420, fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)' }}>
        {props.name ? `Olá, ${props.name}! ` : ''}
        Assim que o anfitrião permitir, você entrará na reunião automaticamente.
      </p>
      <button
        type="button"
        onClick={props.onLeave}
        style={{
          cursor: 'pointer',
          marginTop: '0.5rem',
          border: '1px solid rgba(255,255,255,0.25)',
          background: 'transparent',
          color: '#fff',
          borderRadius: '0.625rem',
          padding: '0.7rem 1.4rem',
          fontSize: '0.9rem',
          fontWeight: 600,
        }}
      >
        Sair
      </button>
    </div>
  );
}
