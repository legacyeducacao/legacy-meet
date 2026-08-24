import { useEffect, useRef, useState } from 'react';

/**
 * Shake de validação — chame `triggerShake()` no submit inválido de um form
 * (ou de um campo específico) e aplique `shakeClass` no wrapper. Usa
 * requestAnimationFrame pra garantir que a classe seja REMOVIDA e reaplicada
 * mesmo em disparos consecutivos (dois Enters seguidos com o form ainda
 * inválido) — sem isso o browser não reinicia a animação CSS porque a classe
 * nunca mudou de valor entre um shake e outro.
 *
 * O rAF e o timeout ficam em refs (mesmo padrão de cleanup do
 * useFlashOnChange abaixo): um trigger novo cancela o anterior — sem isso um
 * shake anterior ainda em voo podia zerar a classe por cima do novo — e o
 * cleanup no unmount evita setState num componente já desmontado se o
 * form fechar (ex.: dialog) enquanto a animação ainda está rodando.
 */
export function useShake() {
  const [shakeClass, setShakeClass] = useState('');
  const rafRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    };
  }, []);

  const triggerShake = () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
    setShakeClass('');
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      setShakeClass('mi-shake');
    });
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setShakeClass('');
    }, 320);
  };
  return { shakeClass, triggerShake };
}

/**
 * Pulso visual (`mi-flash-success` / `mi-flash-sky`) quando `dep` muda — feito
 * pra marcar "isto acabou de ser salvo/atualizado" numa célula ou linha.
 *
 * NUNCA pisca no primeiro render (guard `first`): crítico em listas/grids
 * grandes, onde cada linha nasce com sua própria instância do hook e o valor
 * inicial não é uma "mudança" — é só o estado carregando.
 */
export function useFlashOnChange(dep: unknown, variant: 'success' | 'sky' = 'success') {
  const [cls, setCls] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setCls(variant === 'sky' ? 'mi-flash-sky' : 'mi-flash-success');
    const t = setTimeout(() => setCls(''), 1100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dep]);
  return cls;
}

/**
 * Detecta a travessia de uma meta para >=100% DURANTE a sessão — usado pra
 * armar um <MiniBurst /> no card. A ref começa no valor do PRIMEIRO render
 * (o pct já carregado do servidor), então uma meta que chega em 100% no load
 * NUNCA dispara — só uma travessia <100→>=100 que acontece depois, com o
 * usuário olhando (ex.: editou um Realizado e o card cruzou 100%).
 *
 * Uma vez cruzado, o retorno fica `true` (não há "descruzar" sem remontar o
 * componente) — quem consome decide quando resetar seu próprio estado local
 * de disparo (ex.: no onDone do MiniBurst).
 *
 * `ready` (I3): clientes multi-filial resolvem `branches` DEPOIS do gate de
 * `isLoadingFull` (fetch separado) — o `pct` consolidado pode saltar de um
 * valor parcial pra >=100% nesse meio-tempo, com o usuário já olhando a
 * tela, e o hook interpretava isso como uma travessia real. Enquanto `ready`
 * é `false` o hook só re-semeia `prev` a cada render (nunca dispara); assim
 * que `ready` vira `true`, o valor corrente vira a nova baseline — só uma
 * travessia que aconteça DEPOIS disso conta.
 */
export function useCrossedGoal(pct: number, ready: boolean = true): boolean {
  const prev = useRef(pct);
  const [crossed, setCrossed] = useState(false);
  useEffect(() => {
    if (!ready) {
      prev.current = pct;
      return;
    }
    if (prev.current < 100 && pct >= 100) setCrossed(true);
    prev.current = pct;
  }, [pct, ready]);
  return crossed;
}
