import { getCurrentUser } from '@/lib/auth';
import { randomString } from '@/lib/client-utils';
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
    let randomParticipantPostfix = request.cookies.get(COOKIE_KEY)?.value;
    if (livekitServerUrl === undefined) {
      throw new Error('Invalid region');
    }

    if (typeof roomName !== 'string') {
      return new NextResponse('Missing required query parameter: roomName', { status: 400 });
    }
    if (participantName === null) {
      return new NextResponse('Missing required query parameter: participantName', { status: 400 });
    }

    // Host = link de anfitrião assinado (hostKey) OU membro interno logado (MASTER/EXECUTOR).
    const hostKey = request.nextUrl.searchParams.get('hostKey');
    let isHost = verifyHostKey(roomName, hostKey);
    if (!isHost) {
      const user = await getCurrentUser();
      isHost = !!user && user.isStaff;
    }

    // Generate participant token
    if (!randomParticipantPostfix) {
      randomParticipantPostfix = randomString(4);
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
    return new NextResponse(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${COOKIE_KEY}=${randomParticipantPostfix}; Path=/; HttpOnly; SameSite=Strict; Secure; Expires=${getCookieExpirationTime()}`,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(userInfo: AccessTokenOptions, roomName: string, isHost: boolean) {
  const at = new AccessToken(API_KEY, API_SECRET, userInfo);
  at.ttl = '5m';
  // Host: pode tudo + admin (admitir/remover). Convidado: entra na "sala de espera"
  // sem publicar nem assinar mídia até o host autorizar (server concede depois).
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
        canUpdateOwnMetadata: true,
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

function getCookieExpirationTime(): string {
  var now = new Date();
  var time = now.getTime();
  var expireTime = time + 60 * 120 * 1000;
  now.setTime(expireTime);
  return now.toUTCString();
}
