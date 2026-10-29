'use client';

import * as React from 'react';
import { Track, RoomEvent, ConnectionState, ScreenSharePresets, isLocalTrack } from 'livekit-client';
import { HostParticipantsPanel } from './HostParticipantsPanel';
import { LegacyChat } from './LegacyChat';
import { LegacyGridLayout } from './LegacyGridLayout';
import { toast } from '@/components/ui/custom-toast';
import { describeMediaError, type MediaSource } from './mediaErrors';
import { reportClientEvent, serializeError } from './telemetry';
import {
  ChatToggle,
  CarouselLayout,
  ConnectionStateToast,
  DisconnectButton,
  FocusLayout,
  FocusLayoutContainer,
  LayoutContextProvider,
  MediaDeviceMenu,
  ParticipantTile,
  RoomAudioRenderer,
  StartMediaButton,
  useConnectionState,
  useCreateLayoutContext,
  useLayoutContext,
  useLocalParticipant,
  useLocalParticipantPermissions,
  useParticipants,
  usePersistentUserChoices,
  usePinnedTracks,
  useTracks,
  useTrackToggle,
} from '@livekit/components-react';
import {
  Hand,
  Link,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreHorizontal,
  Settings,
  Sparkles,
  SwitchCamera,
  Video,
  VideoOff,
  Volume2,
} from 'lucide-react';
import type {
  MessageDecoder,
  MessageEncoder,
  MessageFormatter,
  TrackReferenceOrPlaceholder,
  WidgetState,
} from '@livekit/components-react';

const isWeb = () => typeof document !== 'undefined';

const browserSupportsScreenSharing =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  // @ts-ignore - getDisplayMedia pode não estar tipado em alguns ambientes
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

function trackSid(ref?: TrackReferenceOrPlaceholder): string | undefined {
  return (ref as any)?.publication?.trackSid;
}

function isSameTrack(a?: TrackReferenceOrPlaceholder, b?: TrackReferenceOrPlaceholder): boolean {
  if (!a || !b) return false;
  return (
    a.participant?.identity === b.participant?.identity &&
    a.source === b.source &&
    trackSid(a) === trackSid(b)
  );
}


/** Barra de controles da reunião com os rótulos em português. */
function LegacyControlBar(props: {
  controls?: { microphone?: boolean; camera?: boolean; screenShare?: boolean; chat?: boolean; settings?: boolean };
  onDeviceError?: (e: { source: Track.Source; error: Error }) => void;
  hostControls?: { hostKey?: string; participantToken?: string; canPromote?: boolean };
}) {
  const layoutContext = useLayoutContext();
  const permissions = useLocalParticipantPermissions();
  const { cameraTrack, localParticipant } = useLocalParticipant();
  const canPublish = permissions?.canPublish ?? true;
  const canPublishData = permissions?.canPublishData ?? true;

  const visible = {
    microphone: props.controls?.microphone ?? canPublish,
    camera: props.controls?.camera ?? canPublish,
    screenShare: (props.controls?.screenShare ?? canPublish) && browserSupportsScreenSharing,
    chat: props.controls?.chat ?? canPublishData,
    settings: props.controls?.settings ?? false,
    leave: true,
  };

  const {
    saveAudioInputEnabled,
    saveVideoInputEnabled,
    saveAudioInputDeviceId,
    saveVideoInputDeviceId,
  } = usePersistentUserChoices({ preventSave: false });

  const onMicChange = React.useCallback(
    (enabled: boolean, isUserInitiated: boolean) => (isUserInitiated ? saveAudioInputEnabled(enabled) : null),
    [saveAudioInputEnabled],
  );
  const onCamChange = React.useCallback(
    (enabled: boolean, isUserInitiated: boolean) => (isUserInitiated ? saveVideoInputEnabled(enabled) : null),
    [saveVideoInputEnabled],
  );

  const reportError = (source: Track.Source) => (error: Error) => {
    const kind: MediaSource =
      source === Track.Source.Camera
        ? 'camera'
        : source === Track.Source.Microphone
          ? 'microphone'
          : source === Track.Source.ScreenShare
            ? 'screenshare'
            : 'unknown';
    console.error(`Erro ao ativar ${kind}:`, error);
    reportClientEvent('media_error', { source: kind, viaButton: true, error: serializeError(error) });
    // Cancelar o seletor de tela não é erro para o usuário.
    if (!(kind === 'screenshare' && error.name === 'NotAllowedError')) {
      toast.error(describeMediaError(error, kind), { duration: 8000 });
    }
    props.onDeviceError?.({ source, error });
  };

  // Hook do toggle de microfone (preserva onChange + onDeviceError)
  const {
    buttonProps: micButtonProps,
    enabled: micEnabled,
  } = useTrackToggle({
    source: Track.Source.Microphone,
    onChange: onMicChange,
    onDeviceError: reportError(Track.Source.Microphone),
  });

  // Hook do toggle de câmera (preserva onChange + onDeviceError)
  const {
    buttonProps: camButtonProps,
    enabled: camEnabled,
  } = useTrackToggle({
    source: Track.Source.Camera,
    onChange: onCamChange,
    onDeviceError: reportError(Track.Source.Camera),
  });

  // Hook do toggle de compartilhamento de tela (preserva captureOptions + onDeviceError)
  const {
    buttonProps: screenShareButtonProps,
    enabled: screenShareEnabled,
  } = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: {
      audio: true,
      selfBrowserSurface: 'include',
      // 'detail' prioriza nitidez sobre fluidez — texto de tela compartilhada
      // fica legível mesmo com pouca banda (o codec sacrifica fps, não definição).
      contentHint: 'detail',
      resolution: ScreenSharePresets.h1080fps15.resolution,
    },
    onDeviceError: reportError(Track.Source.ScreenShare),
  });

  // Desfoque de fundo na câmera local
  const [blurEnabled, setBlurEnabled] = React.useState(false);
  const [blurPending, setBlurPending] = React.useState(false);
  const toggleBlur = React.useCallback(async () => {
    const track = cameraTrack?.track;
    if (!isLocalTrack(track)) return;
    setBlurPending(true);
    try {
      if (blurEnabled) {
        await track.stopProcessor();
        setBlurEnabled(false);
      } else {
        // Import dinâmico: o MediaPipe (~185 KB de JS + modelo) só é baixado
        // por quem usa o desfoque, não por todo participante ao entrar.
        const { BackgroundBlur } = await import('@livekit/track-processors');
        await track.setProcessor(BackgroundBlur());
        setBlurEnabled(true);
      }
    } catch (error) {
      console.error('Erro ao alternar o desfoque de fundo:', error);
    } finally {
      setBlurPending(false);
    }
  }, [cameraTrack, blurEnabled]);

  // Mão levantada (atributo do participante, sincroniza com os demais)
  const [handRaised, setHandRaised] = React.useState(
    localParticipant.attributes?.hand_raised === 'true',
  );
  const toggleHand = React.useCallback(() => {
    const next = !handRaised;
    setHandRaised(next);
    localParticipant.setAttributes({ hand_raised: next ? 'true' : '' });
  }, [handRaised, localParticipant]);

  // Copiar o link da reunião (sem os parâmetros de query do host)
  const [linkCopied, setLinkCopied] = React.useState(false);
  const copyLink = React.useCallback(() => {
    if (typeof window === 'undefined') return;
    const link = window.location.origin + window.location.pathname;
    navigator.clipboard
      ?.writeText(link)
      .then(() => {
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 2000);
      })
      .catch((error) => console.error('Não foi possível copiar o link:', error));
  }, []);

  // Celular: câmera frontal ↔ traseira. Reinicia a mesma faixa (sem
  // republicar), então quem está assistindo nem percebe a troca.
  const [flipping, setFlipping] = React.useState(false);
  const flipCamera = React.useCallback(async () => {
    const track = cameraTrack?.track;
    if (!isLocalTrack(track) || track.kind !== Track.Kind.Video) return;
    setFlipping(true);
    try {
      const current = track.mediaStreamTrack?.getSettings().facingMode;
      const next = current === 'environment' ? 'user' : 'environment';
      await (track as import('livekit-client').LocalVideoTrack).restartTrack({ facingMode: next });
    } catch (error) {
      console.error('Não foi possível virar a câmera:', error);
      toast.error('Não foi possível trocar de câmera neste aparelho.');
    } finally {
      setFlipping(false);
    }
  }, [cameraTrack]);

  // Celular: os controles secundários ficam numa folha "Mais" (a barra só
  // mostra o essencial, sem precisar arrastar para achar o botão de Sair).
  const [moreOpen, setMoreOpen] = React.useState(false);
  const closeMoreThen = (fn: () => unknown) => () => {
    setMoreOpen(false);
    void fn();
  };

  return (
    <div className="lk-control-bar">
      {visible.microphone && (
        <div className="lk-button-group">
          <button {...micButtonProps} className="lk-button">
            {micEnabled ? <Mic size={18} /> : <MicOff size={18} />}
            <span className="lk-btn-label">Microfone</span>
          </button>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="audioinput"
              onActiveDeviceChange={(_kind, deviceId) => saveAudioInputDeviceId(deviceId ?? 'default')}
            />
          </div>
        </div>
      )}

      {visible.camera && (
        <div className="lk-button-group">
          <button {...camButtonProps} className="lk-button">
            {camEnabled ? <Video size={18} /> : <VideoOff size={18} />}
            <span className="lk-btn-label">Câmera</span>
          </button>
          <div className="lk-button-group-menu">
            <MediaDeviceMenu
              kind="videoinput"
              onActiveDeviceChange={(_kind, deviceId) => saveVideoInputDeviceId(deviceId ?? 'default')}
            />
          </div>
        </div>
      )}

      {/* Seletor de saída de áudio (alto-falante / fone). Fora do celular:
          iOS e Android não deixam a página escolher a saída de áudio. */}
      <div className="lk-button-group lk-only-desktop">
        <span className="lk-button">
          <Volume2 size={18} />
          <span className="lk-btn-label">Alto-falante</span>
        </span>
        <div className="lk-button-group-menu">
          <MediaDeviceMenu kind="audiooutput" />
        </div>
      </div>

      {visible.screenShare && (
        <button {...screenShareButtonProps} className="lk-button lk-only-desktop">
          {screenShareEnabled ? <MonitorX size={18} /> : <MonitorUp size={18} />}
          <span className="lk-btn-label">
            {screenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
          </span>
        </button>
      )}

      {visible.camera && (
        <button
          className="lk-button lk-only-desktop"
          onClick={toggleBlur}
          aria-pressed={blurEnabled}
          disabled={blurPending || !isLocalTrack(cameraTrack?.track)}
          title="Desfocar o fundo da câmera"
        >
          <Sparkles size={18} />
          <span className="lk-btn-label">Desfoque</span>
        </button>
      )}

      <button
        className="lk-button lk-only-desktop"
        onClick={toggleHand}
        aria-pressed={handRaised}
        title={handRaised ? 'Baixar a mão' : 'Levantar a mão'}
      >
        <Hand size={18} />
        <span className="lk-btn-label">{handRaised ? 'Baixar mão' : 'Levantar mão'}</span>
      </button>

      <button className="lk-button lk-only-desktop" onClick={copyLink} title="Copiar link da reunião">
        <Link size={18} />
        <span className="lk-btn-label">{linkCopied ? 'Link copiado!' : 'Copiar link'}</span>
      </button>

      {props.hostControls && (
        <HostParticipantsPanel
          hostKey={props.hostControls.hostKey}
          participantToken={props.hostControls.participantToken}
          canPromote={props.hostControls.canPromote}
        />
      )}

      {visible.chat && (
        <ChatToggle className="lk-button">
          <MessageSquare size={18} />
          <span className="lk-btn-label">Chat</span>
        </ChatToggle>
      )}

      {visible.settings && (
        <button
          className="lk-button lk-only-desktop"
          onClick={() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' })}
        >
          <Settings size={18} />
          <span className="lk-btn-label">Configurações</span>
        </button>
      )}

      <button
        type="button"
        className="lk-button lk-only-mobile"
        onClick={() => setMoreOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-label="Mais opções"
        title="Mais opções"
      >
        <MoreHorizontal size={20} />
      </button>

      {visible.leave && (
        <DisconnectButton aria-label="Sair da reunião" title="Sair da reunião">
          <LogOut size={18} />
          <span className="lk-btn-label">Sair</span>
        </DisconnectButton>
      )}

      <StartMediaButton label="Permitir reprodução de mídia" />

      {moreOpen && (
        <div className="lk-more-backdrop" onClick={() => setMoreOpen(false)}>
          <div
            className="lk-more-sheet"
            role="dialog"
            aria-label="Mais opções"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="lk-more-grip" aria-hidden />
            <button type="button" className="lk-more-item" onClick={closeMoreThen(toggleHand)}>
              <Hand size={20} />
              {handRaised ? 'Baixar a mão' : 'Levantar a mão'}
            </button>
            {visible.camera && camEnabled && (
              <button
                type="button"
                className="lk-more-item"
                disabled={flipping}
                onClick={closeMoreThen(flipCamera)}
              >
                <SwitchCamera size={20} />
                Virar câmera (frontal / traseira)
              </button>
            )}
            {visible.camera && (
              <button
                type="button"
                className="lk-more-item"
                aria-pressed={blurEnabled}
                disabled={blurPending || !isLocalTrack(cameraTrack?.track)}
                onClick={closeMoreThen(toggleBlur)}
              >
                <Sparkles size={20} />
                {blurEnabled ? 'Tirar o desfoque do fundo' : 'Desfocar o fundo'}
              </button>
            )}
            <button type="button" className="lk-more-item" onClick={closeMoreThen(copyLink)}>
              <Link size={20} />
              Copiar link da reunião
            </button>
            {visible.screenShare && (
              <button
                type="button"
                className="lk-more-item"
                onClick={(e) => {
                  setMoreOpen(false);
                  screenShareButtonProps.onClick?.(e);
                }}
              >
                {screenShareEnabled ? <MonitorX size={20} /> : <MonitorUp size={20} />}
                {screenShareEnabled ? 'Parar compartilhamento' : 'Compartilhar tela'}
              </button>
            )}
            {visible.settings && (
              <button
                type="button"
                className="lk-more-item"
                onClick={closeMoreThen(() => layoutContext?.widget.dispatch?.({ msg: 'toggle_settings' }))}
              >
                <Settings size={20} />
                Configurações
              </button>
            )}
            <button type="button" className="lk-more-item lk-more-cancel" onClick={() => setMoreOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface LegacyVideoConferenceProps extends React.HTMLAttributes<HTMLDivElement> {
  chatMessageFormatter?: MessageFormatter;
  chatMessageEncoder?: MessageEncoder;
  chatMessageDecoder?: MessageDecoder;
  SettingsComponent?: React.ComponentType;
  hostControls?: { hostKey?: string; participantToken?: string; canPromote?: boolean };
}

/**
 * Réplica do `VideoConference` da LiveKit com a barra de controles em pt-BR.
 * Mantém o layout (grade/foco), o chat e o menu de configurações originais,
 * sem usar MutationObserver (que quebrava a árvore do React e abortava a conexão).
 */
export function LegacyVideoConference({
  chatMessageFormatter,
  chatMessageDecoder,
  chatMessageEncoder,
  SettingsComponent,
  hostControls,
  ...props
}: LegacyVideoConferenceProps) {
  const [widgetState, setWidgetState] = React.useState<WidgetState>({
    showChat: false,
    unreadMessages: 0,
    showSettings: false,
  });
  const lastAutoFocusedScreenShareTrack = React.useRef<TrackReferenceOrPlaceholder | null>(null);

  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const layoutContext = useCreateLayoutContext();

  const screenShareTracks = tracks
    .filter((t): t is TrackReferenceOrPlaceholder => !!(t as any).publication)
    .filter((t) => (t as any).publication.source === Track.Source.ScreenShare);

  // Participantes com a mão levantada (atributo sincronizado) e quem ainda
  // está na sala de espera (sem permissão de publicar até o anfitrião admitir).
  const participants = useParticipants({
    updateOnlyOn: [
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.ParticipantPermissionsChanged,
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
    ],
  });
  const raisedHands = participants.filter((p) => p.attributes?.hand_raised === 'true');
  // Quem está na sala de espera não entra na grade: virava um quadro preto que
  // ocupava meia tela do celular (o anfitrião já o vê no aviso "Aguardando").
  const waitingKey = participants
    .filter((p) => !p.isLocal && p.permissions?.canPublish === false)
    .map((p) => p.identity)
    .join('|');
  const visibleTracks = React.useMemo(() => {
    if (!waitingKey) return tracks;
    const waiting = new Set(waitingKey.split('|'));
    return tracks.filter((t) => !waiting.has(t.participant.identity));
  }, [tracks, waitingKey]);

  const focusTrack = usePinnedTracks(layoutContext)?.[0];
  const carouselTracks = visibleTracks.filter((track) => !isSameTrack(track, focusTrack));

  // Toca um som quando alguém NOVO levanta a mão (para todos na sala).
  const handAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const prevRaisedRef = React.useRef<Set<string>>(new Set());
  const raisedKey = raisedHands
    .map((p) => p.identity)
    .sort()
    .join(',');
  React.useEffect(() => {
    if (typeof Audio !== 'undefined' && !handAudioRef.current) {
      const a = new Audio('/levantada-de-mao.mp3');
      a.volume = 0.6;
      a.preload = 'auto';
      handAudioRef.current = a;
    }
  }, []);
  React.useEffect(() => {
    const current = new Set(raisedHands.map((p) => p.identity));
    const isNew = [...current].some((id) => !prevRaisedRef.current.has(id));
    if (isNew && handAudioRef.current) {
      handAudioRef.current.currentTime = 0;
      handAudioRef.current.play().catch(() => {
        /* autoplay bloqueado antes de interagir — ignora */
      });
    }
    prevRaisedRef.current = current;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raisedKey]);

  // Ao sair, a sala desconecta e os tracks ficam inconsistentes por um instante,
  // o que faz o GridLayout da LiveKit lançar erro de paginação. Não renderizamos
  // o layout quando já desconectado.
  const connectionState = useConnectionState();
  const showLayout = isWeb() && connectionState !== ConnectionState.Disconnected;

  React.useEffect(() => {
    const hasSubscribedShare = screenShareTracks.some((t) => (t as any).publication?.isSubscribed);
    if (hasSubscribedShare && lastAutoFocusedScreenShareTrack.current === null) {
      layoutContext.pin.dispatch?.({ msg: 'set_pin', trackReference: screenShareTracks[0] });
      lastAutoFocusedScreenShareTrack.current = screenShareTracks[0];
    } else if (
      lastAutoFocusedScreenShareTrack.current &&
      !screenShareTracks.some(
        (t) => trackSid(t) === trackSid(lastAutoFocusedScreenShareTrack.current ?? undefined),
      )
    ) {
      layoutContext.pin.dispatch?.({ msg: 'clear_pin' });
      lastAutoFocusedScreenShareTrack.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    screenShareTracks
      .map((t) => `${trackSid(t)}_${(t as any).publication?.isSubscribed}`)
      .join(),
    tracks,
  ]);

  return (
    <div className="lk-video-conference" {...props}>
      {raisedHands.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '0.75rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'center',
            padding: '0.4rem 0.9rem',
            borderRadius: '999px',
            backgroundColor: 'rgba(29, 58, 93, 0.92)',
            color: '#fff',
            fontSize: '0.85rem',
            border: '1px solid rgba(151, 198, 255, 0.4)',
            maxWidth: '90%',
          }}
        >
          <Hand size={16} />
          <span>
            {raisedHands.map((p) => p.name || p.identity).join(', ')}{' '}
            {raisedHands.length > 1 ? 'levantaram a mão' : 'levantou a mão'}
          </span>
        </div>
      )}
      {showLayout && (
        <LayoutContextProvider value={layoutContext} onWidgetChange={setWidgetState}>
          <div className="lk-video-conference-inner">
            {!focusTrack ? (
              <div className="lk-grid-layout-wrapper">
                <LegacyGridLayout tracks={visibleTracks}>
                  <ParticipantTile />
                </LegacyGridLayout>
              </div>
            ) : (
              <div className="lk-focus-layout-wrapper">
                <FocusLayoutContainer>
                  <CarouselLayout tracks={carouselTracks}>
                    <ParticipantTile />
                  </CarouselLayout>
                  {focusTrack && <FocusLayout trackRef={focusTrack} />}
                </FocusLayoutContainer>
              </div>
            )}
            <LegacyControlBar
              controls={{ chat: true, settings: !!SettingsComponent }}
              hostControls={hostControls}
            />
          </div>
          <LegacyChat
            style={{ display: widgetState.showChat ? 'grid' : 'none' }}
            messageFormatter={chatMessageFormatter}
            messageEncoder={chatMessageEncoder}
            messageDecoder={chatMessageDecoder}
          />
          {SettingsComponent && (
            <div
              className="lk-settings-menu-modal"
              style={{ display: widgetState.showSettings ? 'block' : 'none' }}
            >
              <SettingsComponent />
            </div>
          )}
        </LayoutContextProvider>
      )}
      <RoomAudioRenderer />
      <ConnectionStateToast />
    </div>
  );
}
