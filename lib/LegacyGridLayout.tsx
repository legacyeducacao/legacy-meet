'use client';

import * as React from 'react';
import {
  TrackLoop,
  useGridLayout,
  usePagination,
  useSwipe,
  type GridLayoutDefinition,
  type TrackReferenceOrPlaceholder,
} from '@livekit/components-react';

/**
 * Grades da reunião. As do LiveKit só liberam 2×2 a partir de 560px de
 * largura: num celular em pé cabiam 2 pessoas por tela e a 3ª ia para uma
 * "segunda página" que o cliente não descobria. Aqui o 2×2 vale a partir de
 * 300px e o celular em pé ganha 2×3 (até 6 pessoas na mesma tela); no
 * notebook, 5–6 pessoas ficam em 3×2 (quadros maiores que o 3×3).
 */
export const LEGACY_GRID_LAYOUTS: GridLayoutDefinition[] = [
  { columns: 1, rows: 1 },
  { columns: 1, rows: 2, orientation: 'portrait' },
  { columns: 2, rows: 1, orientation: 'landscape' },
  { columns: 2, rows: 2, minWidth: 300 },
  { columns: 2, rows: 3, minWidth: 300, orientation: 'portrait' },
  { columns: 3, rows: 2, minWidth: 560, orientation: 'landscape' },
  { columns: 3, rows: 3, minWidth: 700 },
  { columns: 4, rows: 4, minWidth: 960 },
  { columns: 5, rows: 5, minWidth: 1100 },
];

export function LegacyGridLayout({
  tracks,
  children,
}: {
  tracks: TrackReferenceOrPlaceholder[];
  children: React.ReactNode;
}) {
  const gridEl = React.useRef<HTMLDivElement>(null);
  const { layout } = useGridLayout(gridEl as React.RefObject<HTMLDivElement>, tracks.length, {
    gridLayouts: LEGACY_GRID_LAYOUTS,
  });
  const pagination = usePagination(layout.maxTiles, tracks);
  useSwipe(gridEl as React.RefObject<HTMLElement>, {
    onLeftSwipe: pagination.nextPage,
    onRightSwipe: pagination.prevPage,
  });
  const paged = pagination.totalPageCount > 1;

  return (
    <div ref={gridEl} className="lk-grid-layout" data-lk-pagination={paged}>
      <TrackLoop tracks={pagination.tracks}>{children}</TrackLoop>
      {paged && (
        // Bolinhas clicáveis (as do LiveKit eram só indicativas): no celular
        // o arrastar não é óbvio, tocar na bolinha é.
        <div className="lk-legacy-pages" role="tablist" aria-label="Páginas de participantes">
          {Array.from({ length: pagination.totalPageCount }, (_, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={pagination.currentPage === i + 1}
              aria-label={`Página ${i + 1} de ${pagination.totalPageCount}`}
              onClick={() => pagination.setPage(i + 1)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
