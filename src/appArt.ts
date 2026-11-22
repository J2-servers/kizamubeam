// Example pictures of the toolbox tiles: what each tool makes, instead of a pictogram. They are drawn by
// scripts/build-app-art.ts (npm run build:app-art, sources in scripts/app-art/) into appArt.json: tile id → SVG
// elements for a field of 120 × 104 units. The elements only carry classes; style.css gives them their colours, so
// the pictures follow the theme. Loaded on demand like the built-in library: until then the tiles show their icon,
// and a tile without a picture (a tool from an extension) keeps it.

/** Drawing field of every picture (the shape of a tile) */
const FIELD = '0 0 120 104';

let art: Record<string, string> | null = null;
let pending: Promise<void> | null = null;

/** Load the pictures once; afterwards artSvg() answers */
export function loadArt(): Promise<void> {
  pending ??= import('./appArt.json')
    .then((m) => {
      art = m.default;
    })
    .catch(() => {
      art = {};
    });
  return pending;
}

/**
 * Markup of the picture of a tile, '' while loading or when the tile has none. The markup is built by the app's own
 * script (npm run test:apps checks that it holds nothing but shapes and classes), so it may go through h({ svg }).
 */
export function artSvg(id: string): string {
  const body = art?.[id];
  return body ? `<svg class="art" viewBox="${FIELD}" aria-hidden="true">${body}</svg>` : '';
}
