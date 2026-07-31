'use client';

import React from 'react';
import toast from 'react-hot-toast';
import { decodePassphrase, isLowPowerDevice } from '@/lib/client-utils';
import { DebugMode } from '@/lib/Debug';
import { KeyboardShortcuts } from '@/lib/KeyboardShortcuts';
import { RecordingIndicator } from '@/lib/RecordingIndicator';
import { SettingsMenu } from '@/lib/SettingsMenu';
import { ConnectionDetails } from '@/lib/types';
import { formatChatMessageLinks, LocalUserChoices, PreJoin, RoomContext } from '@livekit/components-react';
import { LegacyVideoConference } from '@/lib/LegacyVideoConference';
import { HostLobbyPanel } from '@/lib/HostLobbyPanel';
import { NoiseFilterBoot } from '@/lib/NoiseFilterBoot';
import {
  DisconnectReason,
  ExternalE2EEKeyProvider,
  RoomOptions,
  ScreenSharePresets,
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
    // VP9 comprime melhor (menos banda), mas CODIFICAR custa bem mais CPU. Em
    // máquina fraca, H.264 (aceleração por hardware quase universal) mantém a
    // chamada fluida — prioridade para quem tem computador ruim.
    if (videoCodec === 'vp9' && typeof navigator !== 'undefined' && isLowPowerDevice()) {
      videoCodec = 'h264';
    }
    if (e2eeEnabled && (videoCodec === 'av1' || videoCodec === 'vp9')) {
      videoCodec = undefined;
    }
    const videoCaptureDefaults: VideoCaptureOptions = {
      deviceId: props.userChoices.videoDeviceId ?? undefined,
      resolution: props.options.hq ? VideoPresets.h1080 : VideoPresets.h540,
    };
    const publishDefaults: TrackPublishDefaults = {
      // DTX: para de mandar pacotes de áudio durante o silêncio — economia real
      // de banda sem perda perceptível (o bug antigo do SDK que motivou desligar
      // já foi corrigido nas versões atuais).
      dtx: true,
      videoSimulcastLayers: props.options.hq
        ? [VideoPresets.h1080, VideoPresets.h720]
        : [VideoPresets.h540, VideoPresets.h216],
      red: !e2eeEnabled,
      videoCodec,
      // Tela compartilhada: 1080p15 + camada baixa de simulcast — texto legível
      // para quem tem banda e algo utilizável para quem não tem.
      screenShareEncoding: ScreenSharePresets.h1080fps15.encoding,
      screenShareSimulcastLayers: [ScreenSharePresets.h360fps3],
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
      // pixelDensity 'screen': em telas de alta densidade pede a resolução que o
      // monitor realmente mostra; nos demais casos economiza banda de descida.
      adaptiveStream: { pixelDensity: 'screen' },
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
      // Rede ruim: mais tentativas de sinalização e mais tempo para o ICE fechar
      // antes de desistir da conexão.
      maxRetries: 3,
      peerConnectionTimeout: 20_000,
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
    // Registra o próprio nome no meta já no JOIN (antes só acontecia ao sair —
    // fechar a aba perdia o nome e a transcrição ficava sem os participantes).
    const myName = (props.userChoices.username ?? '').trim();
    if (myName) {
      fetch(`/api/record/participants?roomName=${encodeURIComponent(room.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [myName] }),
        keepalive: true,
      }).catch(() => {});
    }
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
    room.on(RoomEvent.Reconnecting, handleReconnecting);
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.EncryptionError, handleEncryptionError);
    room.on(RoomEvent.MediaDevicesError, handleMediaError);
    room.on(RoomEvent.Connected, handleConnected);
    room.on(RoomEvent.ParticipantConnected, collectParticipants);
    room.on(RoomEvent.ParticipantPermissionsChanged, handlePermissions);

    if (e2eeSetupComplete) {
      connectRoom().catch((error) => {
        handleError(error);
        setConnectionLost('failed');
      });
    }
    return () => {
      room.off(RoomEvent.Disconnected, handleOnLeave);
      room.off(RoomEvent.Reconnecting, handleReconnecting);
      room.off(RoomEvent.Reconnected, handleReconnected);
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

  // Navegação client-side (ex.: /obrigado) desmonta o componente sem fechar a
  // conexão — o Room ficava órfão consumindo rede até o servidor perceber.
  // O `room` é estável (useMemo sem deps), então este cleanup roda só no unmount.
  React.useEffect(() => {
    return () => {
      room.disconnect().catch(() => {});
    };
  }, [room]);

  // Fechar a aba de forma abrupta perdia os nomes dos participantes (o fetch de
  // saída não completava) → transcrição sem participantes → "Pessoa N".
  // sendBeacon sobrevive ao fechamento da página.
  React.useEffect(() => {
    const onPageHide = () => {
      collectParticipants();
      const names = [...participantNamesRef.current];
      if (!names.length) return;
      const blob = new Blob([JSON.stringify({ names })], { type: 'application/json' });
      navigator.sendBeacon(
        `/api/record/participants?roomName=${encodeURIComponent(room.name)}`,
        blob,
      );
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [room, collectParticipants]);

  const router = useRouter();

  // Envia os nomes dos participantes para o meta sidecar (identificação de speakers)
  const sendParticipants = React.useCallback(() => {
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
  }, [room, collectParticipants]);

  const goToThanks = React.useCallback(() => {
    // host=1 quando é anfitrião OU co-anfitrião → o /obrigado NÃO mostra o NPS
    // (NPS é só do cliente/convidado, não da equipe).
    const isTeam = isHost || isCohost;
    router.push(`/obrigado?room=${encodeURIComponent(room.name)}${isTeam ? '&host=1' : ''}`);
  }, [router, room, isHost, isCohost]);

  // null = conectado; 'failed' = queda sem reconexão automática; 'reconnecting'
  // = tentativa manual em andamento.
  const [connectionLost, setConnectionLost] = React.useState<null | 'reconnecting' | 'failed'>(
    null,
  );

  const handleOnLeave = React.useCallback(
    (reason?: DisconnectReason) => {
      sendParticipants();
      // Saída pelo botão, remoção pelo host ou sala encerrada → fluxo normal de
      // pós-reunião. Queda de rede/servidor → oferece reconectar (o token vale
      // 12h) em vez de ejetar o usuário para o /obrigado.
      const voluntary =
        reason === undefined ||
        reason === DisconnectReason.CLIENT_INITIATED ||
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.DUPLICATE_IDENTITY;
      if (voluntary) {
        goToThanks();
      } else {
        setConnectionLost('failed');
      }
    },
    [sendParticipants, goToThanks],
  );

  // Feedback visual da reconexão automática do SDK.
  const reconnectingToastId = React.useRef<string | null>(null);
  const handleReconnecting = React.useCallback(() => {
    if (!reconnectingToastId.current) {
      reconnectingToastId.current = toast.loading('Conexão instável — reconectando…');
    }
  }, []);
  const handleReconnected = React.useCallback(() => {
    if (reconnectingToastId.current) {
      toast.dismiss(reconnectingToastId.current);
      reconnectingToastId.current = null;
    }
    toast.success('Conexão restabelecida');
  }, []);

  // Conexão com retry: em rede ruim, a primeira tentativa falhar é comum —
  // tenta 3x com espera progressiva antes de desistir.
  const connectRoom = React.useCallback(async () => {
    const attempts = 3;
    for (let i = 1; i <= attempts; i++) {
      try {
        await room.connect(
          props.connectionDetails.serverUrl,
          props.connectionDetails.participantToken,
          connectOptions,
        );
        return;
      } catch (e) {
        if (i === attempts) throw e;
        await new Promise((r) => setTimeout(r, 1000 * i));
      }
    }
  }, [room, props.connectionDetails, connectOptions]);

  const handleManualReconnect = React.useCallback(async () => {
    setConnectionLost('reconnecting');
    try {
      await connectRoom();
      setConnectionLost(null);
      toast.success('Conexão restabelecida');
    } catch (e) {
      console.error(e);
      setConnectionLost('failed');
      toast.error('Ainda sem conexão. Verifique sua internet e tente de novo.');
    }
  }, [connectRoom]);

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
            {/* Com o menu de configurações ligado, quem gerencia o Krisp é o
                MicrophoneSettings — duas instâncias do hook disputariam o
                processor do microfone. */}
            {!SHOW_SETTINGS_MENU && <NoiseFilterBoot />}
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
        {connectionLost !== null && (
          <ConnectionLostOverlay
            reconnecting={connectionLost === 'reconnecting'}
            onReconnect={handleManualReconnect}
            onLeave={goToThanks}
          />
        )}
      </RoomContext.Provider>
    </div>
  );
}

function ConnectionLostOverlay(props: {
  reconnecting: boolean;
  onReconnect: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
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
      <h1 style={{ margin: 0, fontSize: '1.35rem', fontWeight: 700, color: '#fff' }}>
        Conexão perdida
      </h1>
      <p style={{ margin: 0, maxWidth: 420, fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)' }}>
        Sua conexão com a reunião caiu. Verifique sua internet e tente reconectar — a reunião
        continua acontecendo.
      </p>
      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={props.onReconnect}
          disabled={props.reconnecting}
          style={{
            cursor: props.reconnecting ? 'wait' : 'pointer',
            border: 'none',
            background: '#2f6fb2',
            color: '#fff',
            borderRadius: '0.625rem',
            padding: '0.7rem 1.4rem',
            fontSize: '0.9rem',
            fontWeight: 600,
            opacity: props.reconnecting ? 0.7 : 1,
          }}
        >
          {props.reconnecting ? 'Reconectando…' : 'Reconectar'}
        </button>
        <button
          type="button"
          onClick={props.onLeave}
          style={{
            cursor: 'pointer',
            border: '1px solid rgba(255,255,255,0.25)',
            background: 'transparent',
            color: '#fff',
            borderRadius: '0.625rem',
            padding: '0.7rem 1.4rem',
            fontSize: '0.9rem',
            fontWeight: 600,
          }}
        >
          Sair da reunião
        </button>
      </div>
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
