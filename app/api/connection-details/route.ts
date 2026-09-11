import { getCurrentUser } from '@/lib/auth';
import { newSignedPostfix, verifySignedPostfix } from '@/lib/participantIdentity';
import { getLiveKitURL } from '@/lib/getLiveKitURL';
import { verifyHostKey } from '@/lib/hostLink';
import { ConnectionDetails } from '@/lib/types';
import {
  AccessToken,
  AccessTokenOptions,
  RoomConfiguration,
  VideoGrant,
} from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';

const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;

const COOKIE_KEY = 'random-participant-postfix';
const ROOM_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;
const hostCookieName = (roomName: string) => `lm-host-${roomName}`;
// 12h, alinhado ao TTL do token. SameSite=None: o Meet roda embutido no CRM
// (iframe de outro site) e cookies Strict/Lax não são enviados nesse contexto.
const COOKIE_OPTS = {
  httpOnly: true,
  secure: true,
  sameSite: 'none' as const,
  path: '/',
  maxAge: 12 * 60 * 60,
};

export async function GET(request: NextRequest) {
  try {
    // Parse query parameters
    const roomName = request.nextUrl.searchParams.get('roomName');
    const participantName = request.nextUrl.searchParams.get('participantName');
    const metadata = request.nextUrl.searchParams.get('metadata') ?? '';
    const region = request.nextUrl.searchParams.get('region');
    if (!LIVEKIT_URL) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    const livekitServerUrl = region ? getLiveKitURL(LIVEKIT_URL, region) : LIVEKIT_URL;
    // Sufixo da identidade vem de cookie ASSINADO: sem assinatura qualquer um
    // forjava a identidade de outro participante (nome + sufixo visíveis na
    // sala) e o derrubava com DUPLICATE_IDENTITY.
    let randomParticipantPostfix = verifySignedPostfix(request.cookies.get(COOKIE_KEY)?.value);
    let postfixCookieValue: string | null = null;
    if (livekitServerUrl === undefined) {
      throw new Error('Invalid region');
    }

    if (typeof roomName !== 'string' || !ROOM_NAME_RE.test(roomName)) {
      return new NextResponse('Missing or invalid query parameter: roomName', { status: 400 });
    }
    if (participantName === null) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }

    // Host = link de anfitrião assinado (hostKey) OU membro interno logado (MASTER/EXECUTOR).
    // A chave `h` é apagada da URL pelo cliente (para não vazar ao copiar o
    // link); sem este cookie, um F5 ou a reconexão do host sem login (CRM)
    // virava convidado e ele ficava preso na própria sala de espera.
    const hostKeyFromUrl = request.nextUrl.searchParams.get('hostKey');
    const hostKeyFromCookie = request.cookies.get(hostCookieName(roomName))?.value;
    const hostKeyUsed = verifyHostKey(roomName, hostKeyFromUrl)
      ? hostKeyFromUrl
      : verifyHostKey(roomName, hostKeyFromCookie)
        ? hostKeyFromCookie
        : null;
    let isHost = !!hostKeyUsed;
    if (!isHost) {
      const user = await getCurrentUser();
      isHost = !!user && user.isStaff;
    }

    // Generate participant token
    if (!randomParticipantPostfix) {
      const fresh = newSignedPostfix();
      randomParticipantPostfix = fresh.postfix;
      postfixCookieValue = fresh.cookieValue;
    }
    const participantToken = await createParticipantToken(
      {
        identity: `${participantName}__${randomParticipantPostfix}`,
        name: participantName,
        metadata,
      },
      roomName,
      isHost,
    );

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: livekitServerUrl,
      roomName: roomName,
      participantToken: participantToken,
      participantName: participantName,
      isHost,
    };
    const res = NextResponse.json(data);
    if (postfixCookieValue) res.cookies.set(COOKIE_KEY, postfixCookieValue, COOKIE_OPTS);
    if (hostKeyUsed) res.cookies.set(hostCookieName(roomName), hostKeyUsed, COOKIE_OPTS);
    return res;
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string, isHost: boolean) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  // TTL longo: o token não pode expirar no meio da reunião — senão a reconexão
  // refaz a identidade (nome__postfix) e o CarouselLayout do LiveKit quebra
  // ("Element not part of the array"). A sala fecha sozinha pelo departureTimeout.
  at.ttl = '12h';
  // Host: pode tudo + admin (admitir/remover). Convidado: entra na "sala de espera"
  // sem publicar nem assinar mídia até o host autorizar (server concede depois).
  // Convidado também NÃO atualiza os próprios atributos: era por aí que ele se
  // marcava como co-anfitrião. A admissão (/api/room/admit) libera depois.
  const grant: VideoGrant = isHost
    ? {
        room: roomName,
        roomJoin: true,
        canPublish: true,
        canPublishData: true,
        canSubscribe: true,
        canUpdateOwnMetadata: true,
        roomAdmin: true,
      }
    : {
        room: roomName,
        roomJoin: true,
        canPublish: false,
        canPublishData: false,
        canSubscribe: false,
        canUpdateOwnMetadata: false,
      };
  at.addGrant(grant);
  // Fecha a sala logo após o último participante sair, para a gravação (egress)
  // finalizar rápido e a transcrição começar quase em seguida.
  at.roomConfig = new RoomConfiguration({
    name: roomName,
    emptyTimeout: 60, // sala criada e nunca acessada fecha em 60s
    departureTimeout: 2, // fecha ~2s após o último sair
  });
  return at.toJwt();
}

