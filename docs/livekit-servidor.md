# Servidor LiveKit — diagnóstico e configuração recomendada

Levantamento de 2026-09-11, a partir de relatos de "reconectando" frequente e erros de
câmera/microfone. O que foi medido de fora:

| Item | Valor |
|---|---|
| Host | `livekit.legacyexecutoria.com.br` → 159.65.45.186 (DigitalOcean, Nova Jersey/EUA) |
| Latência ida e volta a partir do Brasil | ~129 ms |
| ICE-TCP 7881 | aberta |
| UDP de mídia | não testável de fora — **conferir** (ver "Checagem de 2 minutos") |
| App Next.js | ~36 ms (perto) |
| MinIO | ~490 ms para conectar (longe) |

## Por que "Conexão restabelecida" aparece

O SDK entra em *reconnecting* quando o WebSocket de sinalização cai ou o ICE detecta perda
de pacotes por alguns segundos. Latência alta e estável **não** causa isso; perda de pacote
e CPU saturada no servidor causam.

A latência piora o efeito de cada perda: a recuperação de um pacote perdido custa cerca de
uma viagem de ida e volta. Com 129 ms, o buffer de jitter esvazia antes de o pacote chegar
e o usuário vê o congelamento; com 20 ms, a mesma perda é invisível.

## Checagem de 2 minutos (faça antes de qualquer mudança)

Durante uma reunião, abra `chrome://webrtc-internals`, procure o par de candidatos ICE
selecionado (`selected candidate pair`) e veja o protocolo:

- `udp` → a mídia está no caminho certo; o problema é CPU/distância.
- `tcp` ou `relay` → **toda a mídia está passando por TCP**. Em TCP, um pacote perdido
  trava todos os seguintes (head-of-line blocking) e a chamada trava e reconecta o tempo
  todo. É a explicação mais provável do sintoma e a correção é de firewall, não de código.

Em paralelo, rode `docker stats` durante uma reunião **gravada** e veja se o container do
egress encosta no total de CPU da máquina.

## Problemas no docker-compose atual

### 1. Faixa de 201 portas UDP publicada pela rede bridge

```yaml
ports:
  - "50000-50200:50000-50200/udp"
```

O Docker sobe, por padrão, **um processo `docker-proxy` por porta publicada**. São ~201
processos no caminho dos pacotes de mídia, com NAT em cada um. Consome memória, CPU e
atrasa o tráfego que mais precisa de prioridade. A faixa também limita a concorrência a
~200 conexões simultâneas.

**Correção: UDP mux.** O LiveKit aceita uma porta UDP única para toda a mídia. A própria
documentação diz que o mux "consolida o tráfego para reduzir uso de CPU", e que
`rtc.port_range_start/end` deixam de ser usados quando `rtc.udp_port` está definido.

Em `/etc/livekit/livekit.yaml`:

```yaml
rtc:
  udp_port: 7882          # porta única de mídia (substitui a faixa)
  tcp_port: 7881          # fallback por TCP
  use_external_ip: true   # OBRIGATÓRIO em nuvem/bridge: anuncia o IP público via STUN
  # port_range_start / port_range_end: remover (ignorados com udp_port)
```

No compose:

```yaml
ports:
  - "7880:7880"
  - "7881:7881"
  - "7882:7882/udp"       # no lugar das 201
```

E abra **UDP 7882** no firewall da DigitalOcean. Sem isso, nada de mídia passa por UDP.

### 2. Egress sem limite de CPU na mesma máquina do SFU

A documentação da LiveKit diz que uma gravação *room composite* usa **de 2 a 6 CPUs** e
recomenda **pelo menos 4 CPUs e 4 GB por instância de egress**. Como todas as reuniões
são gravadas, o egress está sempre ativo e hoje pode consumir a máquina inteira,
derrubando o SFU junto.

```yaml
egress:
  deploy:
    resources:
      limits:
        cpus: '6'
        memory: 8G
```

O limite não deixa a gravação sufocar o SFU: na pior hipótese a gravação fica mais lenta,
a chamada continua boa. O inverso (hoje) é a chamada cair para preservar a gravação.

### 3. Imagens sem versão fixa

`livekit/livekit-server:latest` e `livekit/egress:latest` mudam sozinhas no próximo
restart, e servidor e egress precisam ser compatíveis. Fixe as versões que estão rodando
hoje (`docker inspect --format '{{.Config.Image}} {{.Image}}' <container>`).

## Compose recomendado

```yaml
services:
  redis:
    image: redis:7-alpine
    # LiveKit usa o Redis só como barramento de mensagens: sem persistência.
    command: redis-server --save "" --appendonly no
    restart: unless-stopped

  livekit:
    image: livekit/livekit-server:<versão fixa>
    command: --config /etc/livekit.yaml
    restart: unless-stopped
    depends_on: [redis]
    ports:
      - "7880:7880"        # sinalização (o proxy do EasyPanel termina o TLS aqui)
      - "7881:7881"        # ICE/TCP
      - "7882:7882/udp"    # mídia (UDP mux)
    volumes:
      - /etc/livekit/livekit.yaml:/etc/livekit.yaml

  egress:
    image: livekit/egress:<versão fixa>
    restart: unless-stopped
    depends_on: [redis, livekit]
    environment:
      - EGRESS_CONFIG_FILE=/etc/egress.yaml
    volumes:
      - /etc/livekit/egress.yaml:/etc/egress.yaml
    cap_add: [SYS_ADMIN]   # exigido desde a 1.7.6 (Chrome headless)
    deploy:
      resources:
        limits:
          cpus: '6'
          memory: 8G
```

Portas a abrir no firewall: **7880/TCP**, **7881/TCP**, **7882/UDP**.

## Opcionais, depois que o básico estiver de pé

**Rede `host` no container do LiveKit** elimina também o NAT da porta única. Dá o melhor
desempenho possível, mas o roteamento automático do EasyPanel (que hoje termina o TLS e
encaminha para o serviço pelo nome) deixa de funcionar e precisa apontar para o IP do
host. Só vale se o UDP mux sozinho não resolver.

**TURN sobre TLS** (`turn.enabled: true`, `turn.tls_port: 5349`, `turn.udp_port: 3478`,
`turn.domain` igual ao certificado) atende usuários em rede corporativa que só liberam
tráfego TLS de saída. Hoje o fallback desses usuários é a porta 7881, que muitos firewalls
corporativos bloqueiam por ser fora do padrão. `turn.enabled` vem `false` por padrão.

**Região.** Mudar para São Paulo reduz o RTT de ~129 ms para 10–30 ms e diminui muito o
efeito de cada perda de pacote. A DigitalOcean não tem região no Brasil; há Vultr,
Akamai/Linode, AWS `sa-east-1` e GCP `southamerica-east1`. Ao dimensionar, lembre que o
SFU é limitado por **banda**, não por CPU: uma reunião de 10 pessoas gera na ordem de
20 Mbps de entrada e 135 Mbps de saída no servidor. Confirme a banda garantida e a
cobrança por tráfego de saída antes de fechar. O MinIO deveria ficar na mesma região.

**LiveKit Cloud** é a alternativa a operar o servidor: borda em São Paulo, egress fora da
sua VPS e o cancelamento de ruído Krisp funcionando (hoje desligado no cliente porque é
licenciado só para o Cloud — ver `NEXT_PUBLIC_NOISE_FILTER`). Custo por minuto de
participante.

## Ordem sugerida

1. Checagem de 2 minutos (webrtc-internals + `docker stats`).
2. UDP mux + abrir UDP 7882 + limite de CPU no egress + fixar versões. Tudo isso é
   reversível: guarde o compose e o `livekit.yaml` atuais antes.
3. Coletar uma semana de telemetria do app e comparar.
4. Só então decidir sobre região/Cloud, com dado em vez de suposição.

## O que o app passou a registrar

`POST /api/telemetry` recebe do cliente: `reconnecting`/`reconnected` (com duração da
queda), `reconnect_gave_up`, `connect_failed`, `connection_quality` (poor/lost),
`media_error`, `device_enable_failed`, `prejoin_error`, `iframe_permissions_blocked`,
com navegador, núcleos, tipo de rede (`effectiveType`, `rtt`, `downlink`) e se está
embutido em iframe.

O evento **`ice_transport`** responde sozinho a pergunta da "checagem de 2 minutos",
para todos os usuários em vez de um: 15 s após entrar, o cliente lê o par de candidatos
ICE em uso e envia `protocol` (`udp`/`tcp`), `candidateType` (`host`/`srflx`/`relay`),
`roundTripTimeMs` e `degraded`. Endereços IP não são enviados. Se `degraded` vier `true`
para todo mundo, a mídia está em TCP/TURN e o problema é firewall, não internet do
usuário. Fica no log do app (`"telemetry":true`) e em `telemetry/<dia>/` no
MinIO. Para consultar, entre no app como admin e abra **Diagnóstico** no menu lateral
(`/admin/diagnostico`): a tela escolhe o dia, resume o caminho da mídia com um veredito em
português, mostra quedas e erros de dispositivo e lista os eventos. A API crua continua em
`GET /api/telemetry?date=YYYY-MM-DD`.

Com uma semana de dados dá para separar "rede do usuário" (rtt alto, 3G, `poor`
recorrente para uma pessoa) de "servidor" (todo mundo reconectando ao mesmo tempo).
