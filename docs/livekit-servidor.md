# Servidor LiveKit — diagnóstico e checklist de estabilidade

Levantamento de 2026-09-11, a partir de relatos de "reconectando" frequente e erros de
câmera/microfone. O que foi medido de fora:

| Item | Valor |
|---|---|
| Host | `livekit.legacyexecutoria.com.br` → 159.65.45.186 (DigitalOcean, Nova Jersey/EUA) |
| Latência ida e volta a partir do Brasil | ~129 ms |
| TURN/TLS 5349 e ICE-TCP 7881 | abertas |
| UDP 50000–60000 | não testável de fora — **conferir no firewall** |
| App Next.js | ~36 ms (perto) |
| MinIO | ~490 ms para conectar (longe) |

## Por que "Conexão restabelecida" aparece

O SDK entra em *reconnecting* quando o WebSocket de sinalização cai ou o ICE detecta perda
de pacotes por alguns segundos. Latência alta e estável **não** causa isso; perda de pacote e
CPU saturada no servidor causam. Suspeitos, em ordem:

1. **Egress (gravação) na mesma máquina do SFU.** O `room composite` abre um Chrome headless
   e codifica vídeo. Em VPS pequena isso satura a CPU e o SFU perde pacotes justamente
   enquanto grava (sempre). Verificar: `docker stats` durante uma reunião gravada.
2. **Mídia caindo em TCP.** Sem as portas UDP abertas no firewall da DigitalOcean, toda a
   mídia vai por TURN/TCP (443/5349): qualquer perda vira travamento e reconexão.
   Verificar em `chrome://webrtc-internals` → `selected candidate pair` deve ser `udp`.
3. **Distância.** 129 ms de RTT. Melhora muito com região em São Paulo, mas é o terceiro
   fator, não o primeiro.

## Checklist (ordem de custo/benefício)

- [ ] `livekit.yaml`: `rtc.port_range_start/end` (50000–60000) **abertos em UDP** no
      firewall; `rtc.use_external_ip: true`; `turn.enabled: true` com `tls_port: 5349`
      (já responde) e `udp_port: 3478`.
- [ ] Egress em container/máquina separada do SFU (ou VPS com CPU dedicada ≥ 4 vCPU).
      Alternativa: egress `audio_only`/`track` para reuniões só de áudio — hoje o
      composite é 854x480@24 fps, já enxuto.
- [ ] Versão do servidor ≥ 1.9 (o cliente usa `singlePeerConnection`; versões antigas
      ignoram, mas convém alinhar).
- [ ] Região: mover para São Paulo (Vultr, Akamai/Linode, AWS `sa-east-1`, GCP
      `southamerica-east1`; a DigitalOcean não tem região no Brasil), **ou** LiveKit
      Cloud (borda em São Paulo, egress fora da VPS, Krisp funcionando; custo por minuto
      de participante). O MinIO também deveria ficar na mesma região do egress.
- [ ] Relógio (NTP) e limites de arquivo (`ulimit -n`) no host do LiveKit.

## O que o app passou a registrar

`POST /api/telemetry` recebe do cliente: `reconnecting`/`reconnected` (com duração da
queda), `reconnect_gave_up`, `connect_failed`, `connection_quality` (poor/lost),
`media_error`, `device_enable_failed`, `prejoin_error`, `iframe_permissions_blocked`,
com navegador, núcleos, tipo de rede (`effectiveType`, `rtt`, `downlink`) e se está
embutido em iframe. Fica no log do app (`"telemetry":true`) e em `telemetry/<dia>/` no
MinIO; `GET /api/telemetry?date=YYYY-MM-DD` lista (admin).

Com uma semana de dados dá para separar "rede do usuário" (rtt alto, 3G, `poor`
recorrente para uma pessoa) de "servidor" (todo mundo reconectando ao mesmo tempo).
