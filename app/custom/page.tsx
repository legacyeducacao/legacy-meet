import { videoCodecs } from 'livekit-client';
import { VideoConferenceClientImpl } from './VideoConferenceClientImpl';
import { isVideoCodec } from '@/lib/types';

export default async function CustomRoomConnection(props: {
  searchParams: Promise<{
    liveKitUrl?: string;
    token?: string;
    codec?: string;
    singlePC?: string;
  }>;
}) {
  const { liveKitUrl, token, codec, singlePC } = await props.searchParams;
  if (typeof liveKitUrl !== 'string') {
    return <h2>URL do LiveKit ausente</h2>;
  }
  if (typeof token !== 'string') {
    return <h2>Token do LiveKit ausente</h2>;
  }
  if (codec !== undefined && !isVideoCodec(codec)) {
    return <h2>Codec inválido; se definido, precisa ser um de [{videoCodecs.join(', ')}].</h2>;
  }

  return (
    <main data-lk-theme="default" style={{ height: '100%' }}>
      <VideoConferenceClientImpl
        liveKitUrl={liveKitUrl}
        token={token}
        codec={codec}
        singlePeerConnection={singlePC === 'true'}
      />
    </main>
  );
}
