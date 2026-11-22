// Example pictures of the options inside dialogs (kind of joint, bend pattern, warp …): what the chosen option
// makes, next to its name. Drawn by scripts/build-app-art.ts (npm run build:app-art, source
// scripts/app-art/options.ts) into optionArt.json: "<group>:<value of the option>" → SVG elements for a field of
// 96 × 64 units. Like the tile pictures (appArt.ts) the elements only carry classes, style.css gives the colours,
// and the file is loaded on demand: until then, and for an option without a picture, the box stays hidden.
import { h, setTrustedSvg } from './dom';

/** Drawing field of every option picture */
const FIELD = '0 0 96 64';

let art: Record<string, string> | null = null;
let pending: Promise<void> | null = null;

/** Load the pictures once; afterwards optionArtSvg() answers */
export function loadOptionArt(): Promise<void> {
  pending ??= import('./optionArt.json')
    .then((m) => {
      art = m.default;
    })
    .catch(() => {
      art = {};
    });
  return pending;
}

/**
 * Markup of the picture of an option, '' while loading or when the option has none. The markup is built by the app's
 * own script (npm run test:apps checks that it holds nothing but shapes and classes), so it may go through
 * setTrustedSvg().
 */
export function optionArtSvg(group: string, value: string): string {
  const body = art?.[`${group}:${value}`];
  return body ? `<svg class="art" viewBox="${FIELD}" aria-hidden="true">${body}</svg>` : '';
}

/**
 * Picture box for a control that chooses one option of a group: a select, or an element that holds the radios.
 * Shows the picture of the chosen option and changes it when the choice changes.
 */
export function optionPicture(control: HTMLElement, group: string): HTMLElement {
  const box = h('div', { class: 'opt-art' });
  box.hidden = true;
  const value = () =>
    control instanceof HTMLSelectElement ? control.value : (control.querySelector<HTMLInputElement>('input[type="radio"]:checked')?.value ?? '');
  const show = () => {
    const svg = optionArtSvg(group, value());
    box.hidden = !svg;
    setTrustedSvg(box, svg);
  };
  control.addEventListener('change', show);
  void loadOptionArt().then(show);
  show();
  return box;
}
