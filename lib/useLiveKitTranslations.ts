'use client';

import * as React from 'react';

/**
 * Os componentes da `@livekit/components-react` (ControlBar, Chat, prompts de
 * áudio, etc.) têm os textos fixos em inglês e não expõem props de tradução.
 * Este hook instala um MutationObserver que substitui essas strings por
 * português dentro do documento, cobrindo também os textos renderizados
 * dinamicamente (chat, menus de dispositivo, prompts).
 */
const TRANSLATIONS: Record<string, string> = {
  Camera: 'Câmera',
  Microphone: 'Microfone',
  'Share screen': 'Compartilhar tela',
  'Stop screen share': 'Parar compartilhamento',
  Chat: 'Chat',
  Leave: 'Sair',
  Settings: 'Configurações',
  Messages: 'Mensagens',
  Send: 'Enviar',
  'Enter a message...': 'Digite uma mensagem...',
  'Join Room': 'Entrar na reunião',
  Username: 'Seu nome',
  'Allow Audio': 'Permitir áudio',
  'Start Audio': 'Permitir áudio',
  Encrypted: 'Criptografado',
};

const ATTRS = ['placeholder', 'aria-label', 'title'];

/** Retorna a string traduzida (preservando espaços ao redor) ou null se não houver tradução. */
function translate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const replacement = TRANSLATIONS[trimmed];
  if (replacement === undefined) return null;
  return value.replace(trimmed, replacement);
}

function translateAttributes(el: Element): void {
  for (const attr of ATTRS) {
    const val = el.getAttribute(attr);
    if (val) {
      const next = translate(val);
      if (next !== null) el.setAttribute(attr, next);
    }
  }
}

function translateTree(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    const next = node.textContent ? translate(node.textContent) : null;
    if (next !== null) node.textContent = next;
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const el = node as Element;
  translateAttributes(el);
  el.querySelectorAll('[placeholder],[aria-label],[title]').forEach(translateAttributes);

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let textNode: Node | null;
  while ((textNode = walker.nextNode())) {
    const next = textNode.textContent ? translate(textNode.textContent) : null;
    if (next !== null) textNode.textContent = next;
  }
}

export function useLiveKitTranslations(): void {
  React.useEffect(() => {
    const root = document.body;
    translateTree(root);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData') {
          const next = mutation.target.textContent
            ? translate(mutation.target.textContent)
            : null;
          if (next !== null) mutation.target.textContent = next;
        } else if (mutation.type === 'attributes') {
          if (mutation.target.nodeType === Node.ELEMENT_NODE && mutation.attributeName) {
            const el = mutation.target as Element;
            const val = el.getAttribute(mutation.attributeName);
            if (val) {
              const next = translate(val);
              if (next !== null) el.setAttribute(mutation.attributeName, next);
            }
          }
        } else {
          mutation.addedNodes.forEach(translateTree);
        }
      }
    });

    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });

    return () => observer.disconnect();
  }, []);
}
