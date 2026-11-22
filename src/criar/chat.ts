// Fenster „Produkt erstellen“: der Verlauf im Stil eines Agenten-Harness. Nachrichten des Nutzers mit Miniaturen,
// Antworten der KI, Etappen mit Status (läuft/fertig/Fehler) und ihren Schritten als aufklappbare Protokollzeilen,
// Karten der Zierteile, die Rückfrage der ersten Etappe (Bestätigen/Abbrechen) und das Ergebnis.
import { h } from '../dom';
import { locale, t, tn } from '../i18n';
import type { EngineEvent, Question } from './contract';

type StageEv = Extract<EngineEvent, { kind: 'stage' }>;
type StepEv = Extract<EngineEvent, { kind: 'step' }>;
type PartEv = Extract<EngineEvent, { kind: 'part' }>;
type ResultEv = Extract<EngineEvent, { kind: 'result' }>;

const time = () => new Date().toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
const secs = (ms: number) => (ms / 1000).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' s';

export interface UserTurn {
  text: string;
  images: string[];
  chips: string[];
}

interface StageRow {
  id: string;
  el: HTMLElement;
  icon: HTMLElement;
  detail: HTMLElement;
  clock: HTMLElement;
  steps: HTMLElement;
  toggle: HTMLButtonElement;
  parts: HTMLElement | null;
  n: number;
  t0: number;
  running: boolean;
  /** Vom Nutzer auf- oder zugeklappt: dann nicht mehr automatisch */
  manual: boolean;
}

export class ChatLog {
  readonly el = h('div', { class: 'cr-log', role: 'log', 'aria-live': 'polite' });
  private turn: HTMLElement | null = null;
  private stages: StageRow[] = [];
  private timer = 0;

  constructor() {
    this.el.append(this.welcome());
  }

  private welcome() {
    const tip = (icon: string, title: string, text: string) =>
      h('div', { class: 'cr-tip' }, h('span', { class: 'cr-tip-icon', icon }), h('div', {}, h('b', {}, title), h('div', { class: 'cr-muted' }, text)));
    return h(
      'div',
      { class: 'cr-welcome' },
      h('div', { class: 'cr-welcome-head' }, h('span', { class: 'cr-welcome-icon', icon: 'sparkle' }), h('h2', {}, t('Was möchtest du bauen?'))),
      h('p', { class: 'cr-muted' }, t('Die KI baut aus Fotos und deiner Beschreibung ein Produkt aus Laserteilen: sie versteht zuerst, was zu sehen ist, fragt nach, was unklar ist, und baut erst nach deiner Bestätigung.')),
      tip('image', t('Fotos'), t('Ein oder mehrere Fotos von vorne, von der Seite und von oben helfen am meisten.')),
      tip('ruler', t('Mindestens ein Maß'), t('Breite, Höhe oder Tiefe in mm: daraus ergeben sich alle anderen Maße.')),
      tip('export', t('An das Programm senden'), t('Wenn alles passt, öffnet ein Klick die Teile in einem neuen Tab des Hauptfensters. Dein offenes Projekt bleibt unberührt.')),
    );
  }

  private scroll() {
    const atEnd = this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 160;
    if (atEnd) requestAnimationFrame(() => (this.el.scrollTop = this.el.scrollHeight));
  }
  private add(node: HTMLElement, into: HTMLElement = this.turn ?? this.el) {
    into.append(node);
    this.scroll();
    return node;
  }

  user(u: UserTurn) {
    this.el.querySelector('.cr-welcome')?.remove();
    this.closeStages();
    this.stages = [];
    const msg = h(
      'div',
      { class: 'cr-msg cr-user' },
      h('div', { class: 'cr-who' }, h('span', { class: 'cr-who-name' }, t('Du')), h('span', { class: 'cr-time' }, time())),
      u.images.length ? h('div', { class: 'cr-thumbs' }, ...u.images.map((src) => h('img', { class: 'cr-thumb', src, alt: '' }))) : null,
      u.text ? h('div', { class: 'cr-text' }, u.text) : null,
      u.chips.length ? h('div', { class: 'cr-chips' }, ...u.chips.map((c) => h('span', { class: 'cr-chip' }, c))) : null,
    );
    this.el.append(msg);
    this.turn = h('div', { class: 'cr-turn' }, h('div', { class: 'cr-who' }, h('span', { class: 'cr-who-ai', icon: 'sparkle' }), h('span', { class: 'cr-who-name' }, t('KI')), h('span', { class: 'cr-time' }, time())));
    this.el.append(this.turn);
    requestAnimationFrame(() => (this.el.scrollTop = this.el.scrollHeight));
  }

  /** Laufende Etappe, an die Schritte und Teile gehängt werden */
  private current(): StageRow | null {
    for (let i = this.stages.length - 1; i >= 0; i--) if (this.stages[i].running) return this.stages[i];
    return this.stages[this.stages.length - 1] ?? null;
  }

  private setOpen(row: StageRow, open: boolean) {
    row.steps.hidden = !open;
    row.toggle.classList.toggle('open', open);
  }

  stage(e: StageEv) {
    let row = [...this.stages].reverse().find((r) => r.id === e.stage && r.running);
    if (!row && e.status !== 'start') row = [...this.stages].reverse().find((r) => r.id === e.stage);
    if (!row) {
      const icon = h('span', { class: 'cr-st-icon' });
      const detail = h('span', { class: 'cr-st-detail' });
      const clock = h('span', { class: 'cr-st-clock' });
      const steps = h('div', { class: 'cr-steps' });
      const toggle = h('button', { class: 'cr-st-toggle', hidden: true }) as HTMLButtonElement;
      const head = h('div', { class: 'cr-st-head' }, icon, h('span', { class: 'cr-st-title' }, e.title), detail, h('span', { class: 'cr-st-gap' }), toggle, clock);
      const el = h('div', { class: 'cr-stage' }, head, steps);
      const r: StageRow = { id: e.stage, el, icon, detail, clock, steps, toggle, parts: null, n: 0, t0: performance.now(), running: true, manual: false };
      toggle.addEventListener('click', () => {
        r.manual = true;
        this.setOpen(r, r.steps.hidden);
      });
      this.stages.push(r);
      this.add(el);
      row = r;
      this.tick();
    }
    row.el.classList.remove('start', 'done', 'error');
    row.el.classList.add(e.status);
    if (e.detail !== undefined) row.detail.textContent = e.detail.split('\n')[0];
    // Fehler: die Meldung wörtlich und vollständig (bei Anbieterfehlern deren eigene Antwort)
    if (e.status === 'error' && e.detail) {
      row.el.querySelector('.cr-st-literal')?.remove();
      row.el.insertBefore(h('pre', { class: 'cr-error-literal cr-st-literal' }, e.detail), row.steps);
    }
    if (e.status === 'start') {
      row.running = true;
      if (!row.manual) this.setOpen(row, true);
    } else {
      row.running = false;
      row.clock.textContent = secs(performance.now() - row.t0);
      // Fertige Etappen klappen ihre Schritte zu; mit Fehler bleiben sie offen
      if (!row.manual) this.setOpen(row, e.status === 'error');
    }
    this.scroll();
  }

  private tick() {
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      const live = this.stages.filter((r) => r.running);
      if (!live.length) return window.clearInterval(this.timer);
      for (const r of live) r.clock.textContent = secs(performance.now() - r.t0);
    }, 200);
  }

  /** Noch laufende Etappen beenden (Abbruch, Fehler oder neue Anfrage) */
  closeStages(status: 'done' | 'error' = 'error') {
    for (const r of this.stages)
      if (r.running) {
        r.running = false;
        r.el.classList.remove('start');
        r.el.classList.add(status === 'error' ? 'stopped' : 'done');
        r.clock.textContent = secs(performance.now() - r.t0);
      }
  }

  step(e: StepEv) {
    const row = this.current();
    const detail = e.detail?.trim();
    const line = h(
      'div',
      { class: 'cr-step' + (e.ok ? '' : ' bad') + (detail ? ' has-detail' : '') },
      h('span', { class: 'cr-step-dot' }, e.ok ? '●' : '✕'),
      h('span', { class: 'cr-step-label' }, e.label),
      detail ? h('span', { class: 'cr-step-more' }, '▸') : null,
    );
    const box = h('div', { class: 'cr-step-box' }, line);
    if (detail) {
      const pre = h('pre', { class: 'cr-step-detail', hidden: e.ok }, detail);
      line.addEventListener('click', () => {
        pre.hidden = !pre.hidden;
        line.classList.toggle('open', !pre.hidden);
      });
      line.classList.toggle('open', !pre.hidden);
      box.append(pre);
    }
    if (!row) return void this.add(box);
    row.steps.append(box);
    row.n++;
    row.toggle.hidden = false;
    row.toggle.textContent = tn('{n} Schritt', '{n} Schritte', row.n);
    this.scroll();
  }

  part(e: PartEv) {
    const row = this.current();
    const card = h(
      'div',
      { class: 'cr-part' + (e.accepted ? ' ok' : ' bad') },
      h('div', { class: 'cr-part-img' }, e.image ? h('img', { src: e.image, alt: e.name }) : h('span', { class: 'cr-part-noimg', icon: 'image' })),
      h(
        'div',
        { class: 'cr-part-body' },
        h('div', { class: 'cr-part-name', title: e.name }, e.name),
        h(
          'div',
          { class: 'cr-part-meta' },
          h('span', { class: 'cr-score', style: `--score:${Math.max(0, Math.min(10, e.score)) * 10}%` }, t('Note {n}/10', { n: (Math.round(e.score * 10) / 10).toLocaleString(locale) })),
          h('span', { class: 'cr-badge ' + (e.accepted ? 'ok' : 'bad') }, e.accepted ? t('Übernommen') : t('Verworfen')),
        ),
        h('div', { class: 'cr-part-src', title: e.source }, e.source),
      ),
    );
    if (!row) return void this.add(card);
    if (!row.parts) {
      row.parts = h('div', { class: 'cr-parts' });
      row.el.insertBefore(row.parts, row.steps);
    }
    row.parts.append(card);
    this.scroll();
  }

  assistant(text: string) {
    this.add(h('div', { class: 'cr-ai-text' }, text));
  }

  /** Rückfrage der ersten Etappe: Zusammenfassung, Fragen mit Antwortfeld, Annahmen; Bestätigen oder Abbrechen */
  confirm(summary: string, questions: Question[], assumptions: string[]): Promise<{ confirmed: boolean; answers: string[] }> {
    return new Promise((resolve) => {
      const inputs = questions.map((q) =>
        h('textarea', { class: 'cr-q-input', rows: 1, placeholder: q.blocks ? t('Antwort (nötig, ändert Maße oder Teile)') : t('Antwort (optional)') }) as HTMLTextAreaElement,
      );
      const err = h('div', { class: 'cr-confirm-err', hidden: true });
      const ok = h('button', { class: 'btn primary' }, t('Bestätigen und bauen')) as HTMLButtonElement;
      const cancel = h('button', { class: 'btn' }, t('Abbrechen')) as HTMLButtonElement;
      const card = h(
        'div',
        { class: 'cr-confirm' },
        h('div', { class: 'cr-confirm-head' }, h('span', { class: 'cr-confirm-icon', icon: 'check' }), h('b', {}, t('Habe ich das richtig verstanden?'))),
        h('div', { class: 'cr-confirm-summary' }, summary),
        questions.length
          ? h(
              'div',
              { class: 'cr-confirm-sec' },
              h('div', { class: 'cr-sec-title' }, tn('{n} Frage', '{n} Fragen', questions.length)),
              ...questions.map((q, i) =>
                h(
                  'label',
                  { class: 'cr-q' },
                  h('span', { class: 'cr-q-text' }, h('span', { class: 'cr-q-n' }, `${i + 1}`), q.question, q.blocks ? h('span', { class: 'cr-badge warn' }, t('ändert Maße oder Teile')) : null),
                  inputs[i],
                ),
              ),
            )
          : null,
        assumptions.length
          ? h(
              'div',
              { class: 'cr-confirm-sec' },
              h('div', { class: 'cr-sec-title' }, tn('{n} Annahme', '{n} Annahmen', assumptions.length)),
              h('ul', { class: 'cr-assume' }, ...assumptions.map((a) => h('li', {}, a))),
            )
          : null,
        err,
        h('div', { class: 'cr-confirm-btns' }, cancel, ok),
      );
      for (const i of inputs)
        i.addEventListener('input', () => {
          i.style.height = 'auto';
          i.style.height = `${i.scrollHeight + 2}px`;
        });
      const finish = (confirmed: boolean) => {
        const answers = inputs.map((i) => i.value.trim());
        if (confirmed) {
          const missing = questions.findIndex((q, i) => q.blocks && !answers[i]);
          if (missing >= 0) {
            err.hidden = false;
            err.textContent = t('Bitte beantworte Frage {n}: sie ändert Maße oder Teile.', { n: missing + 1 });
            inputs[missing].focus();
            return;
          }
        }
        inputs.forEach((i) => (i.readOnly = true));
        ok.remove();
        cancel.remove();
        err.remove();
        card.classList.add(confirmed ? 'answered' : 'cancelled');
        card.querySelector('.cr-confirm-btns')?.append(h('span', { class: 'cr-badge ' + (confirmed ? 'ok' : 'bad') }, confirmed ? t('Bestätigt') : t('Abgebrochen')));
        resolve({ confirmed, answers });
      };
      ok.addEventListener('click', () => finish(true));
      cancel.addEventListener('click', () => finish(false));
      this.add(card);
      requestAnimationFrame(() => {
        this.el.scrollTop = this.el.scrollHeight;
        (inputs[0] ?? ok).focus();
      });
    });
  }

  result(e: ResultEv, cost: string) {
    this.closeStages(e.ok ? 'done' : 'error');
    const list = (cls: string, title: string, items: string[]) =>
      items.length ? h('div', { class: 'cr-result-sec ' + cls }, h('div', { class: 'cr-sec-title' }, title), h('ul', {}, ...items.map((x) => h('li', {}, x)))) : null;
    this.add(
      h(
        'div',
        { class: 'cr-result ' + (e.ok ? 'ok' : 'bad') },
        h('div', { class: 'cr-result-head' }, h('span', { class: 'cr-result-icon' }, e.ok ? '✓' : '!'), h('b', {}, e.ok ? t('Fertig') : t('Nicht fertig geworden')), h('span', { class: 'cr-st-gap' }), h('span', { class: 'cr-muted' }, cost)),
        e.summary ? h('div', { class: 'cr-result-summary' }, e.summary) : null,
        list('cr-sec-warn', tn('{n} Warnung', '{n} Warnungen', e.warnings.length), e.warnings),
        list('cr-sec-open', t('Nicht geprüft'), e.notVerified),
      ),
    );
  }

  /** Fehler mit der wörtlichen Antwort des Anbieters (nie „unbekannter Fehler“) */
  error(title: string, literal: string, meta?: string) {
    this.closeStages('error');
    this.add(
      h(
        'div',
        { class: 'cr-error' },
        h('div', { class: 'cr-error-head' }, h('span', { class: 'cr-result-icon' }, '✕'), h('b', {}, title), meta ? h('span', { class: 'cr-muted' }, meta) : null),
        h('pre', { class: 'cr-error-literal' }, literal),
      ),
    );
  }

  note(text: string, kind: 'info' | 'ok' | 'warn' = 'info') {
    this.add(h('div', { class: 'cr-note ' + kind }, text), this.el);
  }
}
