'use client';

import React from 'react';
import { toast } from '@/components/ui/custom-toast';
import { isLowPowerDevice } from '@/lib/client-utils';
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
  DefaultReconnectPolicy,
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
import { reportClientEvent, serializeError, setTelemetryContext } from '@/lib/telemetry';
import { describeMediaError, iframePermissionProblem } from '@/lib/mediaErrors';
import { isCohostIdentity } from '@/lib/cohosts';

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

  // Meet embutido (CRM) em iframe sem allow="camera; microphone": o navegador
  // nega os dispositivos sem perguntar. Avisa com orientação em vez de deixar
  // o usuário achar que a câmera dele quebrou.
  React.useEffect(() => {
    const problem = iframePermissionProblem();
    if (problem) {
      toast.error(problem, { duration: 15000 });
      reportClientEvent('iframe_permissions_blocked', { room: props.roomName });
    }
  }, [props.roomName]);

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
    try {
      const connectionDetailsResp = await fetch(url.toString());
      if (!connectionDetailsResp.ok) {
        const text = (await connectionDetailsResp.text().catch(() => '')).slice(0, 200);
        throw new Error(`connection-details ${connectionDetailsResp.status}: ${text}`);
      }
      const connectionDetailsData = (await connectionDetailsResp.json()) as ConnectionDetails;
      if (!connectionDetailsData?.serverUrl || !connectionDetailsData?.participantToken) {
        throw new Error('connection-details sem serverUrl/participantToken');
      }
      setConnectionDetails(connectionDetailsData);
    } catch (e) {
      // Sem isto o clique em "Entrar" falhava em silêncio e o usuário ficava
      // preso na tela de pré-entrada sem saber o motivo.
      console.error(e);
      reportClientEvent('connection_details_failed', { room: props.roomName, error: serializeError(e) });
      setPreJoinChoices(undefined);
      toast.error('Não foi possível preparar a entrada na reunião. Verifique sua internet e tente de novo.', {
        duration: 8000,
      });
    }
  }, [props.roomName, props.region, props.hostKey]);
  const handlePreJoinError = React.useCallback((e: any) => {
    console.error(e);
    reportClientEvent('prejoin_error', { room: props.roomName, error: serializeError(e) });
    toast.error(describeMediaError(e), { duration: 10000 });
  }, [props.roomName]);

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
  // Uma instância só: o Room guarda o provider da primeira renderização e é
  // nele que a chave precisa ser definida.
  const keyProvider = React.useMemo(() => new ExternalE2EEKeyProvider(), []);
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
      e2ee: e2eeEnabled && worker ? { keyProvider, worker } : undefined,
      singlePeerConnection: props.options.singlePeerConnection,
      // Reconexão automática mais longa: a política padrão do SDK desiste em
      // ~30 s, pouco para 4G/Wi-Fi ruim. ~2,5 min antes de cair no overlay
      // "Conexão perdida" (o token vale 12 h; a reunião continua no servidor).
      reconnectPolicy: new DefaultReconnectPolicy([
        0, 300, 1200, 2700, 4800, ...Array.from({ length: 20 }, () => 7000),
      ]),
    };
  }, [props.userChoices, props.options.hq, props.options.codec]);

  const room = React.useMemo(() => new Room(roomOptions), []);

  React.useEffect(() => {
    if (e2eeEnabled) {
      keyProvider
        .setKey(e2eePassphrase)
        .then(() => room.setE2EEEnabled(true))
        .catch((e) => {
          console.error(e);
          toast.error(
            e instanceof DeviceUnsupportedError
              ? 'Esta reunião é criptografada e seu navegador não tem suporte. Atualize-o e tente de novo.'
              : 'Falha ao ativar a criptografia da reunião.',
            { duration: 10000 },
          );
        })
        .finally(() => setE2eeSetupComplete(true));
    } else {
      setE2eeSetupComplete(true);
    }
  }, [e2eeEnabled, room, e2eePassphrase, keyProvider]);

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
  React.useEffect(() => {
    setTelemetryContext({
      room: props.connectionDetails.roomName,
      identity: props.connectionDetails.participantName,
      isHost,
    });
  }, [props.connectionDetails, isHost]);
  const handlePermissions = React.useCallback(() => {
    if (room.localParticipant.permissions?.canPublish) {
      setAdmitted(true);
    }
  }, [room]);

  // Co-anfitrião: o anfitrião principal promove e o SERVIDOR grava a identidade
  // nos metadados da sala; o cliente promovido passa a ver os painéis.
  const [isCohost, setIsCohost] = React.useState(false);
  React.useEffect(() => {
    const update = () =>
      setIsCohost(isCohostIdentity(room.metadata, room.localParticipant.identity));
    update();
    room.on(RoomEvent.RoomMetadataChanged, update);
    room.on(RoomEvent.Connected, update);
    return () => {
      room.off(RoomEvent.RoomMetadataChanged, update);
      room.off(RoomEvent.Connected, update);
    };
  }, [room]);

  // URL do registro de participantes com o token (o endpoint exige prova de
  // que quem chama está na sala). Usada no join, na saída e no pagehide.
  const participantToken = props.connectionDetails.participantToken;
  const participantsUrl = React.useMemo(
    () =>
      `/api/record/participants?roomName=${encodeURIComponent(room.name)}&token=${encodeURIComponent(participantToken)}`,
    [room, participantToken],
  );

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
      fetch(participantsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names: [myName] }),
        keepalive: true,
      }).catch(() => {});
    }
    // Gravação automática: só o anfitrião dispara (o endpoint exige roomAdmin).
    // Convidado disparando vencia a corrida com o host e gravava com os
    // parâmetros da própria URL (sem transcrição, sem título).
    const endpoint = process.env.NEXT_PUBLIC_LK_RECORD_ENDPOINT;
    if (!endpoint || !isHost || !props.options.record || recordingStartedRef.current) {
      return;
    }
    recordingStartedRef.current = true;
    const params = new URLSearchParams({
      roomName: room.name,
      transcribe: props.options.transcribe ? '1' : '0',
      title: props.options.title,
      host: props.userChoices.username ?? '',
      // Prova que o chamador é participante da sala (o endpoint exige).
      token: props.connectionDetails.participantToken,
    });
    fetch(`${endpoint}/start?${params.toString()}`).catch((error) =>
      console.error('Falha ao iniciar a gravação automática:', error),
    );
  }, [
    room,
    collectParticipants,
    props.options,
    props.userChoices.username,
    props.connectionDetails.participantToken,
    participantsUrl,
    isHost,
  ]);

  // Listeners do Room: registrados abaixo, depois de todos os handlers (ver
  // useRoomListeners), lendo sempre a versão mais recente de cada um.

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
            reportClientEvent('device_enable_failed', { source: 'camera', error: serializeError(error) });
            toast.error(`${describeMediaError(error, 'camera')} Você entrou sem vídeo.`, { duration: 8000 });
          }
        }
      })();
    }
    if (props.userChoices.audioEnabled) {
      (async () => {
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
        } catch {
          // Mesma corrida do PreJoin liberando o dispositivo: uma segunda tentativa.
          await new Promise((r) => setTimeout(r, 1000));
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
          } catch (error) {
            console.error('Falha ao habilitar o microfone (2 tentativas):', error);
            reportClientEvent('device_enable_failed', { source: 'microphone', error: serializeError(error) });
            toast.error(`${describeMediaError(error, 'microphone')} Você entrou sem áudio.`, {
              duration: 10000,
            });
          }
        }
      })();
    }
  }, [admitted, room, props.userChoices.videoEnabled, props.userChoices.audioEnabled]);

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
      navigator.sendBeacon(participantsUrl, blob);
    };
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [participantsUrl, collectParticipants]);

  const router = useRouter();

  // Envia os nomes dos participantes para o meta sidecar (identificação de speakers)
  const sendParticipants = React.useCallback(() => {
    collectParticipants();
    const names = [...participantNamesRef.current];
    if (names.length) {
      fetch(participantsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ names }),
        keepalive: true,
      }).catch(() => {});
    }
  }, [participantsUrl, collectParticipants]);

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
      // ATENÇÃO: o SDK emite Disconnected SEM motivo justamente quando a
      // reconexão automática desiste (RTCEngine "giving up") — "sem motivo" é
      // queda, nunca saída voluntária.
      const voluntary =
        reason === DisconnectReason.CLIENT_INITIATED ||
        reason === DisconnectReason.PARTICIPANT_REMOVED ||
        reason === DisconnectReason.ROOM_DELETED ||
        reason === DisconnectReason.DUPLICATE_IDENTITY;
      reportClientEvent(voluntary ? 'disconnected' : 'reconnect_gave_up', {
        reason: reason != null ? DisconnectReason[reason] : 'none',
      });
      if (voluntary) {
        goToThanks();
      } else {
        setConnectionLost('failed');
      }
    },
    [sendParticipants, goToThanks],
  );

  // Feedback visual da reconexão automática do SDK.
  const reconnectingToastId = React.useRef<string | number | null>(null);
  const reconnectingSinceRef = React.useRef<number | null>(null);
  const handleReconnecting = React.useCallback(() => {
    if (!reconnectingToastId.current) {
      reconnectingToastId.current = toast.loading('Conexão instável — reconectando…');
    }
    if (reconnectingSinceRef.current === null) {
      reconnectingSinceRef.current = Date.now();
      reportClientEvent('reconnecting');
    }
  }, []);
  const handleReconnected = React.useCallback(() => {
    if (reconnectingToastId.current) {
      toast.dismiss(reconnectingToastId.current);
      reconnectingToastId.current = null;
    }
    const since = reconnectingSinceRef.current;
    reconnectingSinceRef.current = null;
    reportClientEvent('reconnected', { outageMs: since ? Date.now() - since : null });
    toast.success('Conexão restabelecida');
  }, []);
  // Qualidade da conexão LOCAL caindo para "ruim"/"perdida" é a evidência mais
  // direta de rede fraca — registra com o que o navegador sabe da rede.
  const lastQualityRef = React.useRef<string>('');
  const handleQualityChanged = React.useCallback(
    (quality: string, participant: { isLocal?: boolean }) => {
      if (!participant?.isLocal || quality === lastQualityRef.current) return;
      lastQualityRef.current = quality;
      if (quality === 'poor' || quality === 'lost') reportClientEvent('connection_quality', { quality });
    },
    [],
  );

  // Conexão: as tentativas em rede ruim ficam por conta do SDK
  // (connectOptions.maxRetries) — uma única camada de retry.
  const connectRoom = React.useCallback(async () => {
    await room.connect(
      props.connectionDetails.serverUrl,
      props.connectionDetails.participantToken,
      connectOptions,
    );
  }, [room, props.connectionDetails, connectOptions]);

  // Conexão (re)estabelecida → some o overlay de "conexão perdida" (uma
  // tentativa que falhou antes da que deu certo já tinha ligado o overlay).
  const clearConnectionLost = React.useCallback(() => setConnectionLost(null), []);

  const handleManualReconnect = React.useCallback(async () => {
    setConnectionLost('reconnecting');
    // O token do convidado não carrega a admissão (ela é concedida pelo host
    // no servidor): ao reconectar ele volta para a sala de espera até ser
    // readmitido — o estado local precisa refletir isso.
    setAdmitted(isHost);
    try {
      await connectRoom();
      setConnectionLost(null);
      toast.success('Conexão restabelecida');
    } catch (e) {
      console.error(e);
      setConnectionLost('failed');
      toast.error('Ainda sem conexão. Verifique sua internet e tente de novo.');
    }
  }, [connectRoom, isHost]);

  const handleError = React.useCallback((error: Error) => {
    // Usado na falha de CONEXÃO com a sala — avisa sem popup nativo bloqueante.
    console.error(error);
    reportClientEvent('connect_failed', { error: serializeError(error) });
    toast.error('Não foi possível conectar à reunião. Verifique sua conexão e tente novamente.');
  }, []);
  // Erros de dispositivo de mídia (ex.: "Timeout starting video source") já são
  // tratados de forma amigável (retry + toast + ingresso sem vídeo) — aqui só
  // registramos no console, sem alert disruptivo.
  const lastMediaErrorRef = React.useRef<string>('');
  const handleMediaError = React.useCallback((error: Error) => {
    console.error('Erro de dispositivo de mídia:', error);
    reportClientEvent('media_error', { error: serializeError(error) });
    // Um toast por tipo de erro (o SDK pode repetir o mesmo erro em sequência).
    const key = `${error.name}:${error.message}`;
    if (key !== lastMediaErrorRef.current) {
      lastMediaErrorRef.current = key;
      toast.error(describeMediaError(error), { duration: 8000 });
    }
  }, []);
  const handleEncryptionError = React.useCallback((error: Error) => {
    console.error(error);
    alert(
      `Ocorreu um erro inesperado de criptografia, verifique o console para mais detalhes: ${error.message}`,
    );
  }, []);

  // Os handlers acima fecham sobre estado que muda durante a reunião (isCohost,
  // connectionLost…). Registrar o listener uma vez com a função da primeira
  // renderização fazia, por exemplo, o co-anfitrião promovido ver o NPS ao
  // sair. Um ref com a versão mais recente resolve sem re-registrar listeners.
  const latest = React.useRef({
    handleOnLeave,
    handleReconnecting,
    handleReconnected,
    clearConnectionLost,
    handleEncryptionError,
    handleMediaError,
    handleQualityChanged,
    handleConnected,
    collectParticipants,
    handlePermissions,
    connectRoom,
    handleError,
  });
  latest.current = {
    handleOnLeave,
    handleReconnecting,
    handleReconnected,
    clearConnectionLost,
    handleEncryptionError,
    handleMediaError,
    handleQualityChanged,
    handleConnected,
    collectParticipants,
    handlePermissions,
    connectRoom,
    handleError,
  };

  React.useEffect(() => {
    const L = latest;
    const onDisconnected = (reason?: DisconnectReason) => L.current.handleOnLeave(reason);
    const onReconnecting = () => L.current.handleReconnecting();
    const onReconnected = () => L.current.handleReconnected();
    const onConnected = () => {
      L.current.clearConnectionLost();
      L.current.handleConnected();
    };
    const onEncryptionError = (e: Error) => L.current.handleEncryptionError(e);
    const onMediaError = (e: Error) => L.current.handleMediaError(e);
    const onQuality = (q: string, p: { isLocal?: boolean }) => L.current.handleQualityChanged(q, p);
    const onParticipantConnected = () => L.current.collectParticipants();
    const onPermissions = () => L.current.handlePermissions();

    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.EncryptionError, onEncryptionError);
    room.on(RoomEvent.MediaDevicesError, onMediaError);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);
    room.on(RoomEvent.ParticipantPermissionsChanged, onPermissions);

    if (e2eeSetupComplete) {
      L.current.connectRoom().catch((error) => {
        L.current.handleError(error);
        setConnectionLost('failed');
      });
    }
    return () => {
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.EncryptionError, onEncryptionError);
      room.off(RoomEvent.MediaDevicesError, onMediaError);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      room.off(RoomEvent.ParticipantPermissionsChanged, onPermissions);
    };
  }, [e2eeSetupComplete, room]);

  React.useEffect(() => {
    if (lowPowerMode) {
      console.warn('Low power mode enabled');
    }
  }, [lowPowerMode]);

  // Wrapper estável do menu de configurações com o token embutido (os endpoints
  // de gravação passaram a exigir o token do participante).
  const SettingsWithToken = React.useMemo(() => {
    if (!SHOW_SETTINGS_MENU) return undefined;
    const Comp = () => <SettingsMenu participantToken={participantToken} />;
    return Comp;
  }, [participantToken]);

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
              SettingsComponent={SettingsWithToken}
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
