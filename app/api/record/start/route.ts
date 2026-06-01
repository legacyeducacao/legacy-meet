import { EgressClient, EncodedFileOutput, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { meetingTypeFromRoomName } from '@/lib/meeting-types';

export async function GET(req: NextRequest) {
  try {
    const roomName = req.nextUrl.searchParams.get('roomName');

    /**
     * CAUTION:
     * for simplicity this implementation does not authenticate users and therefore allows anyone with knowledge of a roomName
     * to start/stop recordings for that room.
     * DO NOT USE THIS FOR PRODUCTION PURPOSES AS IS
     */

    if (roomName === null) {
      return new NextResponse('Missing roomName parameter', { status: 403 });
    }

    const {
      LIVEKIT_API_KEY,
      LIVEKIT_API_SECRET,
      LIVEKIT_URL,
      S3_KEY_ID,
      S3_KEY_SECRET,
      S3_BUCKET,
      S3_BUCKET_COMERCIAL,
      S3_BUCKET_EXECUTORIA,
      S3_ENDPOINT,
      S3_REGION,
    } = process.env;

    // O tipo da reunião está codificado no prefixo do nome da sala
    // (ex: "comercial-...", "executoria-...") e define em qual bucket gravar.
    const meetingType = meetingTypeFromRoomName(roomName);
    const bucketByType: Record<typeof meetingType, string | undefined> = {
      comercial: S3_BUCKET_COMERCIAL,
      executoria: S3_BUCKET_EXECUTORIA,
    };
    const bucket = bucketByType[meetingType] ?? S3_BUCKET;

    if (!bucket) {
      return new NextResponse(
        `Bucket não configurado para reuniões do tipo "${meetingType}"`,
        { status: 500 },
      );
    }

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Meeting is already being recorded', { status: 409 });
    }

    const fileOutput = new EncodedFileOutput({
      filepath: `${meetingType}/${new Date(Date.now()).toISOString()}-${roomName}.mp4`,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: S3_ENDPOINT,
          accessKey: S3_KEY_ID,
          secret: S3_KEY_SECRET,
          region: S3_REGION,
          bucket,
        }),
      },
    });

    await egressClient.startRoomCompositeEgress(
      roomName,
      {
        file: fileOutput,
      },
      {
        layout: 'speaker',
      },
    );

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
