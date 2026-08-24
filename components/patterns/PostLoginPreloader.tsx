'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Preloader de marca exibido logo após o login: a tela de login grava uma
 * flag em sessionStorage e redireciona com reload completo; este componente
 * consome a flag no boot do app. Logo com preenchimento líquido + auroras;
 * a saída faz o símbolo crescer e "virar" a tela, revelando o app por baixo.
 * Autocontido: sem flag, renderiza null e não custa nada.
 *
 * Snapshot 2026-08-12 de `components/PostLoginPreloader.tsx` do app — o SVG
 * embutido é o logo "Legacy Plan" (wordmark "Legacy Plan" + seta gradiente);
 * troque `ARROW_PATH_1`/`ARROW_PATH_2`/`LEGACY_PATH`/`PLAN_PATH` pelo SVG do
 * seu logo em outro produto (mantendo os grupos `lp-symbol`/`lp-name` e as
 * classes `lp-base*`/`lp-fill*`/`lp-trace` para preservar a animação).
 *
 * Uso — grave a flag antes do redirect pós-login:
 * ```ts
 * try { sessionStorage.setItem(POST_LOGIN_PRELOADER_FLAG, '1'); } catch {}
 * window.location.href = '/';
 * ```
 * E monte `<PostLoginPreloader />` uma vez no boot do app (ex.: junto do
 * root React), sem props — ele mesmo lê e limpa a flag.
 */
export const POST_LOGIN_PRELOADER_FLAG = 'legacy_post_login_preloader';

const SHOW_MS = 2200;  // tempo de exibição antes da saída
const EXIT_MS = 1300;  // duração da animação de saída

const ARROW_PATH_1 = 'M26.4602 131.48V130.965C43.8877 125.597 67.2505 113.77 83.6131 105.223C99.2266 96.2517 113.648 86.9554 128.74 77.4928C131.904 75.5911 134.238 73.0718 137.213 74.0765C144.713 79.2853 117.536 110.985 124.152 112.608C132.563 115.387 177.366 54.5464 170.025 46.4338C155.638 33.7077 88.9661 57.9217 89.0648 65.1307C90.3455 73.7586 128.152 55.581 129.35 65.3602C129.35 73.9489 78.8187 98.3987 69.883 101.787C66.0919 103.303 53.8827 109.261 50.6561 109.333C50.6561 107.732 84.9355 49.2368 91.5018 38.4339C92.6062 36.1495 101.736 21.2576 102.085 20.1795C103.135 16.9287 103.198 16.9215 103.117 13.5841C101.94 3.11181 91.6449 -3.11584 81.1945 1.59737C75.4381 5.34698 59.9941 33.1732 57.1786 38.0878C38.0918 68.833 19.1346 99.6017 1.41358 131.143C-7.86903 158.187 31.2433 149.12 40.8228 144.304C55.4224 138.248 119.933 101.786 131.479 82.0359C129.953 83.1229 99.7666 101.245 86.3487 108.475C75.631 114.04 37.3799 131.48 26.4602 131.48V131.48Z';
const ARROW_PATH_2 = 'M45.9204 149.722H167.778C181.905 149.722 185.724 135.591 177.119 123.855L156.31 90.9541C151.653 97.2804 146.583 103.573 141.189 109.175L148.197 122.418C151.228 128.372 148.713 129.845 144.425 129.783H82.0945C75.7762 133.629 69.3716 137.347 62.9083 140.92C57.5159 143.902 51.6568 147.152 45.9204 149.723V149.722Z';
const LEGACY_PATH = 'M193.063 54.9341V40.9196H195.066V53.1922H202.653V54.9339H193.063V54.9341ZM204.956 54.9341V40.9196H214.846V42.6615H206.958V53.1922H215.126V54.9339H204.956V54.9341ZM206.778 48.6677V46.9659H213.985V48.6677H206.778ZM224.676 55.0944C223.595 55.0944 222.6 54.9174 221.693 54.5638C220.785 54.21 219.998 53.7095 219.331 53.0623C218.663 52.4148 218.143 51.6575 217.769 50.79C217.395 49.9223 217.209 48.968 217.209 47.9271C217.209 46.8861 217.395 45.9317 217.769 45.0642C218.143 44.1965 218.667 43.4391 219.341 42.7917C220.015 42.1445 220.805 41.644 221.713 41.2904C222.621 40.9366 223.622 40.7595 224.716 40.7595C225.824 40.7595 226.838 40.9399 227.759 41.3002C228.68 41.6605 229.461 42.2011 230.102 42.9217L228.86 44.1631C228.287 43.6023 227.663 43.1919 226.988 42.9317C226.315 42.6715 225.584 42.5413 224.796 42.5413C223.996 42.5413 223.251 42.6748 222.564 42.9417C221.877 43.2088 221.283 43.5825 220.782 44.0629C220.282 44.5434 219.895 45.1139 219.621 45.7747C219.348 46.4353 219.21 47.1528 219.21 47.9271C219.21 48.6878 219.347 49.3983 219.621 50.0591C219.895 50.7197 220.282 51.2938 220.782 51.781C221.283 52.2683 221.873 52.6453 222.554 52.9122C223.235 53.1791 223.976 53.3126 224.776 53.3126C225.524 53.3126 226.241 53.196 226.929 52.9624C227.616 52.7289 228.254 52.3384 228.841 51.7912L229.982 53.3129C229.288 53.9003 228.477 54.3442 227.549 54.6443C226.622 54.9446 225.664 55.0949 224.676 55.0949L224.676 55.0944ZM229.981 53.3124L228.06 53.0522V47.8468H229.981V53.3124ZM231.683 54.9341L238.029 40.9196H240.012L246.378 54.9341H244.276L238.61 42.041H239.411L233.745 54.9341H231.683H231.683ZM234.386 51.4305L234.926 49.829H242.814L243.395 51.4305H234.386ZM254.526 55.0944C253.459 55.0944 252.474 54.9174 251.573 54.5638C250.673 54.21 249.892 53.7095 249.231 53.0623C248.57 52.4148 248.053 51.6575 247.679 50.79C247.306 49.9223 247.119 48.968 247.119 47.9271C247.119 46.8861 247.306 45.9317 247.679 45.0642C248.053 44.1965 248.574 43.4391 249.241 42.7917C249.908 42.1445 250.693 41.644 251.593 41.2904C252.494 40.9366 253.479 40.7595 254.546 40.7595C255.628 40.7595 256.625 40.9432 257.539 41.3102C258.454 41.6772 259.231 42.2209 259.872 42.9417L258.57 44.2032C258.037 43.6424 257.436 43.2253 256.769 42.9518C256.101 42.6782 255.387 42.5415 254.627 42.5415C253.839 42.5415 253.108 42.6751 252.434 42.942C251.76 43.2091 251.176 43.5827 250.683 44.0632C250.188 44.5436 249.805 45.1141 249.531 45.7749C249.258 46.4355 249.121 47.153 249.121 47.9273C249.121 48.7014 249.257 49.4186 249.531 50.0794C249.805 50.74 250.188 51.3108 250.683 51.7912C251.176 52.2717 251.76 52.6456 252.434 52.9124C253.108 53.1793 253.839 53.3129 254.627 53.3129C255.387 53.3129 256.101 53.1762 256.769 52.9026C257.436 52.6291 258.037 52.2053 258.57 51.6314L259.872 52.8926C259.231 53.6131 258.454 54.1605 257.539 54.5344C256.625 54.908 255.621 55.0949 254.526 55.0949L254.526 55.0944ZM265.678 54.9343V49.5689L266.138 50.8103L260.112 40.92H262.254L267.32 49.2688H266.159L271.244 40.92H273.226L267.22 50.8103L267.66 49.5689V54.9343H265.678H265.678Z';
const PLAN_PATH = 'M193.063 126.723H210.712V108.529H219.536C235.274 108.529 246.828 100.615 246.828 85.5134V85.3315C246.828 71.3218 236.457 63.0436 220.446 63.0436H193.063V126.723ZM210.712 94.7015V77.8719H219.081C225.358 77.8719 229.27 80.6919 229.27 86.1502V86.332C229.27 91.3355 225.358 94.7015 219.172 94.7015H210.712ZM252.768 126.723H269.961V60.3145H252.768V126.723ZM292.822 127.815C299.281 127.815 303.92 125.268 307.377 121.538V126.723H324.389V98.4315C324.389 91.5176 322.842 86.423 319.113 82.7843C315.201 78.8727 309.197 76.7803 300.372 76.7803C291.912 76.7803 285.999 78.3269 280.45 80.601L283.998 92.7001C288.455 91.0626 292.458 89.9708 297.644 89.9708C304.284 89.9708 307.468 92.8821 307.468 98.0674V98.8861C304.648 97.7943 300.191 96.9756 295.642 96.9756C284.089 96.9756 276.356 102.161 276.356 112.441V112.623C276.356 122.357 283.452 127.815 292.822 127.815ZM299.008 116.989C295.46 116.989 292.913 114.988 292.913 111.622V111.44C292.913 107.71 295.824 105.345 300.827 105.345C303.375 105.345 305.831 105.891 307.65 106.619V108.893C307.65 113.806 304.102 116.99 299.008 116.99V116.989ZM332.239 126.723H349.524V100.069C349.524 94.6108 352.617 91.6995 356.802 91.6995C360.986 91.6995 363.806 94.6108 363.806 100.069V126.723H381V94.5196C381 83.3301 374.723 76.4162 364.261 76.4162C357.256 76.4162 352.708 80.3278 349.524 84.4216V77.5078H332.239V126.723Z';

const STYLES = `
#lp-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:#0f1729}
#lp-overlay .lp-bg{position:absolute;inset:0;overflow:hidden}
#lp-overlay .lp-bg::before{content:"";position:absolute;inset:0;background:radial-gradient(1200px 780px at 50% 42%, #14213f 0%, #0f1830 44%, #0a1120 100%)}
#lp-overlay .lp-aurora{position:absolute;border-radius:50%;filter:blur(90px);opacity:.22;mix-blend-mode:screen}
#lp-overlay .lp-aurora.lp-a{width:480px;height:480px;left:16%;top:22%;background:radial-gradient(circle,#1552c8,transparent 60%);animation:lp-drift1 18s ease-in-out infinite}
#lp-overlay .lp-aurora.lp-b{width:420px;height:420px;right:14%;bottom:16%;background:radial-gradient(circle,#1f7ad6,transparent 60%);animation:lp-drift2 22s ease-in-out infinite}
@keyframes lp-drift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(50px,-26px) scale(1.1)}}
@keyframes lp-drift2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-44px,22px) scale(1.06)}}
#lp-overlay .lp-halo{position:absolute;left:50%;top:46%;width:600px;height:360px;transform:translate(-50%,-50%);background:radial-gradient(ellipse,rgba(60,140,235,.14),transparent 68%);animation:lp-pulse 6s ease-in-out infinite;filter:blur(10px)}
@keyframes lp-pulse{0%,100%{opacity:.4;transform:translate(-50%,-50%) scale(.97)}50%{opacity:.7;transform:translate(-50%,-50%) scale(1.03)}}
#lp-overlay .lp-bg::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 50% 48%, transparent 40%, rgba(5,9,18,.7) 100%)}
#lp-overlay .lp-stage{position:relative;z-index:1;overflow:visible}
#lp-overlay .lp-logo{width:min(320px,66vw);height:auto;display:block;overflow:visible;filter:drop-shadow(0 6px 30px rgba(0,0,0,.45)) drop-shadow(0 0 22px rgba(95,199,255,.14))}
#lp-overlay .lp-base{fill:rgba(120,165,255,.16)}
#lp-overlay .lp-base-brand{fill:rgba(225,238,255,.22)}
#lp-overlay .lp-fill{fill:url(#lp-flow)}
#lp-overlay .lp-fill-brand{fill:#ffffff}
#lp-overlay .lp-fill-brand-sub{fill:#eaf2ff}
#lp-overlay .lp-trace{fill:none;stroke:url(#lp-stroke);stroke-width:2;stroke-linecap:round;stroke-dasharray:210 1600;animation:lp-run 5s linear infinite}
@keyframes lp-run{to{stroke-dashoffset:-1810}}
@media (prefers-reduced-motion:reduce){#lp-overlay .lp-trace{animation:none}}
#lp-overlay .lp-symbol{transform-box:fill-box;transform-origin:center}
#lp-overlay .lp-name{transform-box:fill-box;transform-origin:center}
#lp-overlay.lp-exit .lp-name{animation:lp-name-out .45s cubic-bezier(.6,0,.35,1) forwards}
@keyframes lp-name-out{to{opacity:0;transform:translateY(-8px) scale(.96)}}
#lp-overlay.lp-exit .lp-symbol{animation:lp-symbol-grow .9s cubic-bezier(.66,0,.34,1) forwards;animation-delay:.15s}
@keyframes lp-symbol-grow{0%{transform:scale(1)}18%{transform:scale(.84)}100%{transform:scale(34)}}
#lp-overlay.lp-exit .lp-trace{animation:lp-trace-fade .3s ease forwards}
@keyframes lp-trace-fade{to{opacity:0}}
#lp-overlay.lp-exit{animation:lp-overlay-out .45s ease-in forwards;animation-delay:.78s}
@keyframes lp-overlay-out{to{opacity:0;visibility:hidden}}
#lp-overlay.lp-exit .lp-halo{animation:lp-halo-burst .8s ease-out forwards;animation-delay:.25s}
@keyframes lp-halo-burst{0%{opacity:.5;transform:translate(-50%,-50%) scale(1)}100%{opacity:.9;transform:translate(-50%,-50%) scale(2.6)}}
`;

const PostLoginPreloader: React.FC = () => {
  const [phase, setPhase] = useState<'hidden' | 'show' | 'exit'>(() => {
    try {
      if (sessionStorage.getItem(POST_LOGIN_PRELOADER_FLAG)) {
        sessionStorage.removeItem(POST_LOGIN_PRELOADER_FLAG);
        return 'show';
      }
    } catch { /* ignore */ }
    return 'hidden';
  });

  useEffect(() => {
    if (phase !== 'show') return;
    const t = setTimeout(() => setPhase('exit'), SHOW_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'exit') return;
    const t = setTimeout(() => setPhase('hidden'), EXIT_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === 'hidden') return null;

  return createPortal(
    <div id="lp-overlay" className={phase === 'exit' ? 'lp-exit' : undefined} role="status" aria-label="Carregando o Legacy Plan">
      <style>{STYLES}</style>
      <div className="lp-bg">
        <div className="lp-aurora lp-a" />
        <div className="lp-aurora lp-b" />
        <div className="lp-halo" />
      </div>

      <div className="lp-stage">
        <svg className="lp-logo" viewBox="0 0 381 150" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="lp-flow" x1="0" y1="75" x2="150" y2="75" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#0E59DE" />
              <stop offset="0.5" stopColor="#7FD6FF" />
              <stop offset="1" stopColor="#0E59DE" />
              <animate attributeName="x1" values="-150;381" dur="3.2s" repeatCount="indefinite" />
              <animate attributeName="x2" values="0;531" dur="3.2s" repeatCount="indefinite" />
            </linearGradient>
            <linearGradient id="lp-stroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5FC7FF" stopOpacity="0" />
              <stop offset="0.5" stopColor="#eaf6ff" />
              <stop offset="1" stopColor="#5FC7FF" stopOpacity="0" />
            </linearGradient>
            <mask id="lp-rise" maskUnits="userSpaceOnUse" x="0" y="0" width="381" height="150">
              <path fill="#fff" d="M-160 30 C -60 14,20 46,120 30 S 300 14,400 30 S 580 46,680 30 L680 300 L-160 300 Z">
                <animateTransform attributeName="transform" type="translate" values="-30 150; -260 -6; -30 150" dur="7s" repeatCount="indefinite" />
              </path>
              <path fill="#fff" opacity="0.9" d="M-160 38 C -60 54,20 22,120 38 S 300 56,400 38 S 580 22,680 38 L680 300 L-160 300 Z">
                <animateTransform attributeName="transform" type="translate" values="-260 150; -30 -6; -260 150" dur="7s" repeatCount="indefinite" />
              </path>
            </mask>
          </defs>

          <g className="lp-symbol">
            <path className="lp-base" d={ARROW_PATH_1} />
            <path className="lp-base" d={ARROW_PATH_2} />
            <g mask="url(#lp-rise)">
              <path className="lp-fill" d={ARROW_PATH_1} />
              <path className="lp-fill" d={ARROW_PATH_2} />
            </g>
            <path className="lp-trace" d={ARROW_PATH_1} />
          </g>

          <g className="lp-name">
            <path className="lp-base-brand" d={LEGACY_PATH} />
            <path className="lp-base-brand" d={PLAN_PATH} />
            <g mask="url(#lp-rise)">
              <path className="lp-fill-brand-sub" d={LEGACY_PATH} />
              <path className="lp-fill-brand" d={PLAN_PATH} />
            </g>
          </g>
        </svg>
      </div>
    </div>,
    document.body,
  );
};

export default PostLoginPreloader;
