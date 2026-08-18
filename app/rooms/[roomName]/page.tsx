import * as React from 'react';
import { PageClientImpl } from './PageClientImpl';
import { isVideoCodec } from '@/lib/types';
import { getCurrentUser } from '@/lib/auth';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ roomName: string }>;
  searchParams: Promise<{
    // FIXME: We should not allow values for regions if in playground mode.
    region?: string;
    hq?: string;
    codec?: string;
    singlePC?: string;
    name?: string;
    title?: string;
    rec?: string;
    tx?: string;
    h?: string;
  }>;
}) {
  const _params = await params;
  const _searchParams = await searchParams;
  const codec =
    typeof _searchParams.codec === 'string' && isVideoCodec(_searchParams.codec)
      ? _searchParams.codec
      : 'vp9';
  const hq = _searchParams.hq === 'true' ? true : false;
  const singlePC = _searchParams.singlePC !== 'false';
  const urlName = typeof _searchParams.name === 'string' ? _searchParams.name : '';
  // Usuário logado: o nome CADASTRADO tem prioridade e já vem preenchido no
  // PreJoin. Grafia canônica (a mesma do banco) — evita variações de nome que
  // confundem a identificação de speakers na transcrição. Convidado sem login
  // segue o fluxo atual (nome da URL ou digitado).
  const user = await getCurrentUser();
  const hostName = (user?.name ?? '').trim() || urlName;
  const title = typeof _searchParams.title === 'string' ? _searchParams.title : '';
  const record = _searchParams.rec !== '0';
  const transcribe = record && _searchParams.tx !== '0';
  const hostKey = typeof _searchParams.h === 'string' ? _searchParams.h : '';

  return (
    <PageClientImpl
      roomName={_params.roomName}
      region={_searchParams.region}
      hq={hq}
      codec={codec}
      singlePeerConnection={singlePC}
      hostName={hostName}
      title={title}
      record={record}
      transcribe={transcribe}
      hostKey={hostKey}
    />
  );
}
