'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import {
  ChatEntry,
  ChatToggle,
  useChat,
  useMaybeLayoutContext,
  type MessageDecoder,
  type MessageEncoder,
  type MessageFormatter,
} from '@livekit/components-react';

/**
 * Chat da reunião em português — cópia do `Chat` do LiveKit (que vem com
 * "Messages", "Enter a message..." e "Send" fixos em inglês), com a mesma
 * contagem de mensagens não lidas do botão de chat. No celular ele ocupa a
 * tela inteira (ver .lk-chat em globals.css), por isso o cabeçalho tem um
 * botão de fechar bem visível.
 */
export function LegacyChat({
  messageFormatter,
  messageDecoder,
  messageEncoder,
  style,
}: {
  messageFormatter?: MessageFormatter;
  messageDecoder?: MessageDecoder;
  messageEncoder?: MessageEncoder;
  style?: React.CSSProperties;
}) {
  const ulRef = React.useRef<HTMLUListElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const chatOptions = React.useMemo(
    () => ({ messageDecoder, messageEncoder }),
    [messageDecoder, messageEncoder],
  );
  const { chatMessages, send, isSending } = useChat(chatOptions);
  const layoutContext = useMaybeLayoutContext();
  const lastReadMsgAt = React.useRef<number>(0);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = inputRef.current?.value.trim();
    if (!text) return;
    await send(text);
    if (inputRef.current) {
      inputRef.current.value = '';
      inputRef.current.focus();
    }
  }

  React.useEffect(() => {
    ulRef.current?.scrollTo({ top: ulRef.current.scrollHeight });
  }, [chatMessages]);

  // Mesma regra do Chat original: com o chat aberto, tudo conta como lido;
  // fechado, o botão de chat mostra quantas chegaram desde a última leitura.
  React.useEffect(() => {
    if (!layoutContext || chatMessages.length === 0) return;
    const last = chatMessages[chatMessages.length - 1]?.timestamp;
    if (layoutContext.widget.state?.showChat && lastReadMsgAt.current !== last) {
      lastReadMsgAt.current = last;
      return;
    }
    const unread = chatMessages.filter(
      (m) => !lastReadMsgAt.current || m.timestamp > lastReadMsgAt.current,
    ).length;
    const { widget } = layoutContext;
    if (unread > 0 && widget.state?.unreadMessages !== unread) {
      widget.dispatch?.({ msg: 'unread_msg', count: unread });
    }
  }, [chatMessages, layoutContext?.widget]);

  return (
    <div className="lk-chat" style={style}>
      <div className="lk-chat-header">
        Chat
        {layoutContext && (
          <ChatToggle className="lk-close-button" aria-label="Fechar o chat" title="Fechar o chat">
            <X size={18} />
          </ChatToggle>
        )}
      </div>

      <ul className="lk-list lk-chat-messages" ref={ulRef}>
        {chatMessages.length === 0 && (
          <li className="lk-chat-empty">
            As mensagens aparecem aqui. Só quem está na sala recebe.
          </li>
        )}
        {chatMessages.map((msg, idx, all) => {
          const hideName = idx >= 1 && all[idx - 1].from === msg.from;
          const hideTimestamp = idx >= 1 && msg.timestamp - all[idx - 1].timestamp < 60_000;
          return (
            <ChatEntry
              key={msg.id ?? idx}
              hideName={hideName}
              hideTimestamp={hideName === false ? false : hideTimestamp}
              entry={msg}
              messageFormatter={messageFormatter}
            />
          );
        })}
      </ul>
      <form className="lk-chat-form" onSubmit={handleSubmit}>
        <input
          className="lk-form-control lk-chat-form-input"
          disabled={isSending}
          ref={inputRef}
          type="text"
          enterKeyHint="send"
          placeholder="Escreva uma mensagem…"
          aria-label="Mensagem"
          onInput={(ev) => ev.stopPropagation()}
          onKeyDown={(ev) => ev.stopPropagation()}
          onKeyUp={(ev) => ev.stopPropagation()}
        />
        <button type="submit" className="lk-button lk-chat-form-button" disabled={isSending}>
          Enviar
        </button>
      </form>
    </div>
  );
}
