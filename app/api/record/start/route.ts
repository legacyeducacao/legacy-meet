import { EgressClient, EncodedFileOutput, EncodingOptions, S3Upload } from 'livekit-server-sdk';
import { NextRequest, NextResponse } from 'next/server';
import { getRoomOwners, metaKey, readJson, writeJson, type MeetingMeta } from '@/lib/recordings';

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
      S3_ENDPOINT,
      S3_REGION,
    } = process.env;

    if (!S3_BUCKET) {
      return new NextResponse('Bucket de gravação (S3_BUCKET) não configurado', { status: 500 });
    }

    // Se a reunião deve ser transcrita, gravamos numa pasta separada para que o
    // worker de transcrição (pós-reunião) saiba quais arquivos processar.
    const shouldTranscribe = req.nextUrl.searchParams.get('transcribe') === '1';
    const folder = shouldTranscribe ? 'com-transcricao' : 'gravacoes';

    // id URL-safe: "<sala>__<timestamp>". O worker deriva sala/data a partir dele.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const recordingId = `${roomName}__${stamp}`;

    const hostURL = new URL(LIVEKIT_URL!);
    hostURL.protocol = 'https:';

    const egressClient = new EgressClient(hostURL.origin, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);

    const existingEgresses = await egressClient.listEgress({ roomName });
    if (existingEgresses.length > 0 && existingEgresses.some((e) => e.status < 2)) {
      return new NextResponse('Meeting is already being recorded', { status: 409 });
    }

    const fileOutput = new EncodedFileOutput({
      filepath: `${folder}/${recordingId}.mp4`,
      output: {
        case: 's3',
        value: new S3Upload({
          endpoint: S3_ENDPOINT,
          accessKey: S3_KEY_ID,
          secret: S3_KEY_SECRET,
          region: S3_REGION,
          bucket: S3_BUCKET,
          // MinIO atrás do EasyPanel: o certificado vale só para o host base,
          // não para "<bucket>.host". Path-style evita o erro de TLS no upload.
          forcePathStyle: true,
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
        // 480p + 24fps: reuniões são "cabeça falante", então isso mantém boa
        // legibilidade gastando bem menos CPU/memória por gravação (mais
        // gravações simultâneas no mesmo host) e gerando arquivos menores.
        encodingOptions: new EncodingOptions({
          width: 854,
          height: 480,
          framerate: 24,
          videoBitrate: 1000,
          audioBitrate: 128,
        }),
      },
    );

    // Metadados da reunião (título/host/participantes) para o worker usar no
    // nome da pasta do Drive e na identificação dos speakers. Não falha a gravação.
    try {
      const title = req.nextUrl.searchParams.get('title') ?? '';
      const host = req.nextUrl.searchParams.get('host') ?? '';
      // Título/host CADASTRADOS na reunião (agenda/instant) — fonte da verdade.
      // Sem isso, o worker nomeia a pasta do Drive com o nome da sala (meet_<uuid>).
      const owner = (await getRoomOwners([roomName])).get(roomName);
      const dbTitle = (owner?.title ?? '').trim();
      const dbHost = (owner?.hostName ?? '').trim();
      // Mescla com o que já existe (ex.: título/host definidos pelo CRM ao agendar),
      // sem sobrescrever com valores vazios quando o convidado entra primeiro.
      const existing = (await readJson<MeetingMeta>(metaKey(roomName))) ?? {};
      await writeJson(metaKey(roomName), {
        title: title || dbTitle || existing.title || '',
        host: host || dbHost || existing.host || '',
        createdAt: existing.createdAt || new Date().toISOString(),
        participants: existing.participants?.length
          ? existing.participants
          : host
            ? [host]
            : dbHost
              ? [dbHost]
              : [],
      });
    } catch (e) {
      console.error('Falha ao gravar metadados da reunião:', e);
    }

    return new NextResponse(null, { status: 200 });
  } catch (error) {
    if (error instanceof Error) {
      return new NextResponse(error.message, { status: 500 });
    }
  }
}
