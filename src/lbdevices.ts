// Import from LightBurn: reads LightBurn's device profiles (DeviceList in prefs.ini, a .lbdev file or the .lbdev
// files inside a .lbzip bundle) and turns each one into a KizamuBeam device. Ruida, the GRBL family, Smoothieware,
// Marlin, FluidNC and xTool map onto the existing firmwares; JCZ galvo lasers ("JCZFiber", type LibUSB) become
// fw 'jcz' with the galvo settings of src/jcz/contract.ts. Every mapping reports what it took over, what it converted
// and what has no counterpart, so nothing is imported silently. No DOM here (the dialog is in lbdevicesDialog.ts).
import { unzipSync, strFromU8 } from 'fflate';
import { DEFAULT_DEVICE, DEFAULT_ROTARY, Device, Firmware, FIRMWARES, LaserModule, RuidaOrigin } from './gcode';
import { JczGalvo, JczSettings } from './jcz/contract';
import { t } from './i18n';

export type LbRaw = Record<string, unknown>;

/** Devices read from one LightBurn file */
export interface LbSource {
  /** Where the devices came from (file name or path of prefs.ini) */
  from: string;
  devices: LbRaw[];
  /** LightBurn DefaultDevice (index into devices; -1 = none) */
  defaultIndex: number;
}

/** A KizamuBeam device, also with the galvo firmware that src/jcz adds to Firmware */
export type ImportedDevice = Omit<Device, 'fw'> & { fw: Firmware | 'jcz'; jcz?: JczSettings };

export type NoteKind = 'taken' | 'converted' | 'missing';
export interface ImportNote {
  kind: NoteKind;
  text: string;
}

export interface LbImport {
  /** Name shown in LightBurn (DisplayName, else Name) */
  name: string;
  /** LightBurn device type as stored ("CDM", "LibUSB", "GRBL" …) */
  lbType: string;
  /** null: no KizamuBeam controller for this type; reason says why */
  device: ImportedDevice | null;
  reason?: string;
  notes: ImportNote[];
}

// ---------- reading ----------

const isObj = (v: unknown): v is LbRaw => !!v && typeof v === 'object' && !Array.isArray(v);
const looksLikeDevice = (v: unknown): v is LbRaw => isObj(v) && typeof v.Type === 'string' && ('Name' in v || 'DisplayName' in v);

/** Devices from the JSON text of prefs.ini or a .lbdev: {DeviceList:[…]}, one device object or an array of them */
export function parseLightburnJson(text: string, from: string): LbSource {
  let json: unknown;
  try {
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(t('{file}: kein LightBurn-Geräteprofil (JSON nicht lesbar: {error})', { file: from, error: (e as Error).message }));
  }
  const list = isObj(json) && Array.isArray(json.DeviceList) ? json.DeviceList : Array.isArray(json) ? json : looksLikeDevice(json) ? [json] : null;
  if (!list) throw new Error(t('{file}: keine LightBurn-Geräte gefunden (DeviceList fehlt)', { file: from }));
  const devices = list.filter(looksLikeDevice);
  const def = isObj(json) && typeof json.DefaultDevice === 'number' ? json.DefaultDevice : -1;
  return { from, devices, defaultIndex: def >= 0 && def < devices.length ? def : -1 };
}

/** Devices from a picked file: .lbzip (zip of .lbdev files), .lbdev, prefs.ini or a .json copy of them */
export function parseLightburnFile(name: string, bytes: Uint8Array): LbSource {
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(bytes);
    } catch (e) {
      throw new Error(t('{file}: Archiv nicht lesbar ({error})', { file: name, error: (e as Error).message }));
    }
    const devices: LbRaw[] = [];
    for (const [path, data] of Object.entries(files)) if (/\.lbdev$/i.test(path)) devices.push(...parseLightburnJson(strFromU8(data), path).devices);
    if (!devices.length) throw new Error(t('{file}: keine LightBurn-Geräte gefunden (DeviceList fehlt)', { file: name }));
    return { from: name, devices, defaultIndex: -1 };
  }
  return parseLightburnJson(strFromU8(bytes), name);
}

// ---------- mapping ----------

const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Keys of LightBurn's own window and editor (docks, grid, snapping, units, alignment): nothing for the machine */
const UI_KEY = /^(DockState_|Grid|ObjSnap|ClickSelTolerance$|Align[HV]$|Units$|AutoIncrementFilename$|overwriteFileByDefault$|PlayCompletionSound$|LastCamera|LastDevLibraryPath$|ProfilePath$|GUID$|PositionTimerEnable$|Info$|Checklist$|ControlUnits$)/;

/** What LightBurn device type becomes; null = no KizamuBeam controller */
export function firmwareFor(lbType: string): Firmware | 'jcz' | null {
  const ty = lbType.toLowerCase();
  if (/ruida|^cdm|rdc6|rdworks/.test(ty)) return 'ruida';
  if (/libusb|jcz|galvo|ezcad|bjjcz|lmc/.test(ty)) return 'jcz';
  if (/fluidnc/.test(ty)) return 'fluidnc';
  if (/grbl.?hal/.test(ty)) return 'grblhal';
  if (/xtool/.test(ty)) return 'xtool';
  if (/grbl/.test(ty)) return 'grbl';
  if (/smoothie/.test(ty)) return 'smoothie';
  if (/marlin/.test(ty)) return 'marlin';
  return null;
}

/** LightBurn MirrorX/MirrorY → corner of the Ruida machine zero (mirrored X = origin right, mirrored Y = origin at the back) */
export function originFromMirror(mirrorX: boolean, mirrorY: boolean): RuidaOrigin {
  return mirrorY ? (mirrorX ? 'top-right' : 'top-left') : mirrorX ? 'bottom-right' : 'bottom-left';
}

const ORIGIN_LABEL = (o: RuidaOrigin) =>
  o === 'top-right' ? t('Hinten rechts (Standard)') : o === 'top-left' ? t('Hinten links') : o === 'bottom-left' ? t('Vorne links') : t('Vorne rechts');

/**
 * LightBurn Laser_Type. Only 1 = Fiber is confirmed (the owner's JCZFiber LMC4). The other numbers follow the order of
 * LightBurn's galvo documentation (CO2, Fiber, UV, SPI), which is a list in a sentence, not the stored enum: the second
 * real device stores 2 together with an SPI simmer current, so for a device LightBurn calls "Fiber" an unconfirmed
 * number is taken as fiber and reported for checking.
 */
const JCZ_LASER_TYPES: JczSettings['laserType'][] = ['co2', 'fiber', 'uv', 'fiber'];
const JCZ_LASER_NAMES = ['CO2', 'Fiber', 'UV', 'SPI'];
const WAVELENGTH: Record<JczSettings['laserType'], number> = { co2: 10600, fiber: 1064, uv: 355 };

/** Network address of a device, if LightBurn stored one (Ethernet Ruida, GRBL over Telnet) */
function hostOf(raw: LbRaw, s: LbRaw, used: Set<string>): string {
  for (const o of [raw, s])
    for (const k of Object.keys(o))
      if (/^(ip|ipaddress|ipaddr|address|host|hostname|networkaddress|netaddress)$/i.test(k) && str(o[k]).trim()) {
        used.add(k);
        return str(o[k]).trim();
      }
  return '';
}

function baudOf(raw: LbRaw, s: LbRaw, used: Set<string>): number {
  for (const o of [raw, s])
    for (const k of Object.keys(o))
      if (/^baud(rate)?$/i.test(k) && num(o[k]) > 0) {
        used.add(k);
        return num(o[k]);
      }
  return 0;
}

const isSet = (v: unknown) => !(v === false || v === 0 || v === '' || v === null || v === undefined || (Array.isArray(v) && !v.length) || (isObj(v) && !Object.keys(v).length));
const show = (v: unknown) => (typeof v === 'number' ? fmt(v) : typeof v === 'string' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.length}]` : isObj(v) ? '{…}' : String(v));

/** One LightBurn device as a KizamuBeam device plus the report of what happened to each of its settings */
export function mapLightburnDevice(raw: LbRaw): LbImport {
  const s: LbRaw = isObj(raw.Settings) ? raw.Settings : {};
  const used = new Set<string>(['Settings', 'Type', 'Name', 'DisplayName']);
  const take = (...keys: string[]) => keys.forEach((k) => used.add(k));
  const notes: ImportNote[] = [];
  const note = (kind: NoteKind, text: string) => notes.push({ kind, text });
  const name = str(raw.DisplayName).trim() || str(raw.Name).trim() || 'LightBurn';
  const lbType = str(raw.Type);
  const fw = firmwareFor(lbType);
  if (!fw) {
    return { name, lbType, device: null, notes, reason: t('Steuerungstyp „{type}“ hat in KizamuBeam keine Entsprechung (unterstützt: Ruida, GRBL, grblHAL, FluidNC, Smoothieware, Marlin, xTool, JCZ-Galvo).', { type: lbType }) };
  }
  const label = FIRMWARES[fw]?.label ?? t('JCZ-Galvo (Faserlaser)');
  note('converted', t('Steuerung: LightBurn „{type}“ → {fw}', { type: lbType, fw: label }));

  const W = num(raw.Width), H = num(raw.Height);
  take('Width', 'Height', 'Depth');
  const dev: ImportedDevice = {
    ...DEFAULT_DEVICE,
    rotary: { ...DEFAULT_ROTARY },
    pointerOffset: { ...DEFAULT_DEVICE.pointerOffset },
    id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name,
    fw,
    bedW: W > 0 ? W : DEFAULT_DEVICE.bedW,
    bedH: H > 0 ? H : DEFAULT_DEVICE.bedH,
    conn: 'serial',
    port: '',
    host: '',
    sMax: fw === 'jcz' ? 100 : FIRMWARES[fw].sMax,
    homeOnConnect: false,
  };

  // Acceleration and rapid speed only feed the time estimate (LightBurn's preview uses them the same way)
  const rapid = num(s.Sim_RapidSpeed), ax = num(s.Sim_MaxAccelX), ay = num(s.Sim_MaxAccelY);
  if (rapid > 0) {
    dev.rapid = Math.round(rapid * 60);
    note('converted', t('Eilgang {v} mm/s → {r} mm/min (Zeitschätzung)', { v: fmt(rapid), r: dev.rapid }));
  }
  if (ax > 0 || ay > 0) {
    dev.accel = Math.min(...[ax, ay].filter((a) => a > 0));
    note('taken', t('Beschleunigung {a} mm/s² (Zeitschätzung)', { a: fmt(dev.accel) }));
  }
  take('Sim_RapidSpeed', 'Sim_MaxAccelX', 'Sim_MaxAccelY');

  if (fw === 'jcz') mapJcz(raw, s, dev, note, take);
  else {
    note('taken', t('Arbeitsbereich {w} × {h} mm', { w: fmt(dev.bedW), h: fmt(dev.bedH) }));
    mapGantry(raw, s, fw, dev, note, take, used);
  }

  // Material library and macros of the device
  const cut = [raw.CutList, raw.DefaultCutList, raw.DefaultToolCutList].reduce<number>((n, l) => n + (Array.isArray(l) ? l.length : 0), 0);
  take('CutList', 'DefaultCutList', 'DefaultToolCutList', 'LastDevLibraryPath');
  if (cut) note('missing', t('Materialbibliothek des Geräts ({n} Einträge) nicht übernommen: in LightBurn als .clb exportieren und in der Material-Bibliothek von KizamuBeam importieren.', { n: cut }));
  if (str(raw.LastDevLibraryPath)) note('missing', t('LightBurn-Bibliothek {path}: in der Material-Bibliothek von KizamuBeam importieren (.clb).', { path: str(raw.LastDevLibraryPath) }));
  const macros = Array.isArray(raw.Macros) ? raw.Macros.length : 0;
  take('Macros');
  if (macros) note('missing', t('{n} Makros nicht übernommen: KizamuBeam hat keine Makros (Befehle in der Konsole eingeben).', { n: macros }));
  for (const k of ['CustomAlarmCodes', 'CustomErrorCodes']) {
    take(k);
    if (isSet(raw[k])) note('missing', t('{key}: eigene Fehlertexte nicht übernommen (kein Gegenstück).', { key: k }));
  }

  // What is left: UI settings of LightBurn, then everything without a counterpart (only the ones that are set)
  const rest: string[] = [];
  let ui = 0, off = 0;
  for (const o of [raw, s])
    for (const [k, v] of Object.entries(o)) {
      if (used.has(k)) continue;
      if (UI_KEY.test(k)) ui++;
      else if (!isSet(v)) off++;
      else rest.push(`${k} = ${show(v)}`);
    }
  if (fw === 'jcz') {
    if (rest.length) note('missing', t('Ohne Gegenstück in KizamuBeam, im Gerät unter jcz.lightburn aufbewahrt: {list}', { list: rest.join(', ') }));
  } else if (rest.length) note('missing', t('Ohne Gegenstück in KizamuBeam, nicht übernommen: {list}', { list: rest.join(', ') }));
  if (ui) note('missing', t('{n} Einstellungen der LightBurn-Oberfläche (Fenster, Raster, Fang, Einheiten) nicht übernommen: betreffen nur LightBurn.', { n: ui }));
  if (off) note('missing', t('{n} weitere Einstellungen sind in LightBurn aus oder 0 und haben hier keine Wirkung.', { n: off }));
  return { name, lbType, device: dev, notes };
}

type Note = (kind: NoteKind, text: string) => void;

/** Ruida, GRBL family, Smoothieware, Marlin, xTool */
function mapGantry(raw: LbRaw, s: LbRaw, fw: Firmware, dev: ImportedDevice, note: Note, take: (...k: string[]) => void, used: Set<string>) {
  const mx = !!raw.MirrorX, my = !!raw.MirrorY;
  take('MirrorX', 'MirrorY');
  if (fw === 'ruida') {
    dev.ruidaOrigin = originFromMirror(mx, my);
    note('converted', t('Nullpunkt: Spiegeln X {x}, Y {y} → Maschinennullpunkt {o}', { x: mx ? t('an') : t('aus'), y: my ? t('an') : t('aus'), o: ORIGIN_LABEL(dev.ruidaOrigin) }));
    dev.laser = { type: 'co2', wavelength: 10600 } satisfies LaserModule;
    dev.ruidaLaser = '1';
    if (s.Laser2Enabled) note('missing', t('Zweite Laserröhre ist in LightBurn eingeschaltet: Röhre in den Geräteeinstellungen wählen (übernommen: Laser 1).'));
    take('Laser2Enabled');
  } else if (mx || my) note('missing', t('Nullpunkt-Ecke aus LightBurn (Spiegeln X {x}, Y {y}) hat bei {fw} kein Gegenstück: Lage des Nullpunkts vor dem ersten Job prüfen.', { x: mx ? t('an') : t('aus'), y: my ? t('an') : t('aus'), fw: FIRMWARES[fw].label }));

  const host = hostOf(raw, s, used);
  if (host) {
    dev.host = host;
    dev.conn = 'tcp';
    note('taken', fw === 'ruida' ? t('Verbindung: Netzwerk (UDP) {host}', { host }) : t('Verbindung: Netzwerk {host}', { host }));
  } else {
    note('converted', t('Verbindung: USB-Kabel (seriell); die Schnittstelle wird im Laser-Fenster gewählt'));
  }
  const baud = baudOf(raw, s, used);
  if (baud) {
    dev.baud = baud;
    note('taken', t('Baudrate {b}', { b: baud }));
  }

  dev.homeOnConnect = !!raw.HomeOnStartup;
  take('HomeOnStartup');
  if (dev.homeOnConnect) {
    dev.limitSwitches = 'yes';
    note('taken', t('Referenzfahrt beim Verbinden: an (wie in LightBurn)'));
  }
  if (s.UseMachineCoordinates) {
    dev.startFrom = 'absolute';
    note('converted', t('Maschinenkoordinaten → Start von: Absolut'));
  }
  take('UseMachineCoordinates');
  if (s.EnableZ) {
    dev.zAxis = true;
    note('taken', t('Z-Achse vorhanden'));
  }
  take('EnableZ');
  const sx = num(s.Sim_MaxSpeedX), sy = num(s.Sim_MaxSpeedY);
  if (sx || sy) note('missing', t('Höchstgeschwindigkeit X {x} / Y {y} mm/s (LightBurn-Vorschau): kein Gegenstück, die Steuerung begrenzt selbst.', { x: fmt(sx), y: fmt(sy) }));
  take('Sim_MaxSpeedX', 'Sim_MaxSpeedY');
  if (/m3/i.test(str(raw.Type))) note('missing', t('GRBL-M3 (feste Leistung mit M3): KizamuBeam schaltet bei GRBL mit M4 (dynamische Leistung); vor dem ersten Job prüfen.'));
}

/** JCZ galvo (LightBurn JCZFiber over LibUSB) → fw 'jcz' with JczSettings; the whole LightBurn device stays in jcz.lightburn */
function mapJcz(raw: LbRaw, s: LbRaw, dev: ImportedDevice, note: Note, take: (...k: string[]) => void) {
  const W = num(raw.Width), H = num(raw.Height);
  const field = W > 0 ? W : H > 0 ? H : 110;
  if (W > 0 && H > 0 && W !== H) note('missing', t('Feld {w} × {h} mm ist nicht quadratisch: übernommen {f} mm.', { w: fmt(W), h: fmt(H), f: fmt(field) }));
  dev.bedW = dev.bedH = field;
  const galvo = (i: 1 | 2): JczGalvo => ({
    scale: num(s[`Galvo_${i}_Scale`], 1),
    bulge: num(s[`Galvo_${i}_Bulge`], 1),
    skew: num(s[`Galvo_${i}_Skew`], 1),
    trapezoid: num(s[`Galvo_${i}_Trapezoid`], 1),
    sign: num(s[`Galvo_${i}_Sign`], 1) < 0 ? -1 : 1,
  });
  for (const i of [1, 2]) for (const k of ['Scale', 'Bulge', 'Skew', 'Trapezoid', 'Sign']) take(`Galvo_${i}_${k}`);
  const lt = Math.round(num(s.Laser_Type, 1));
  const fiberDevice = /fiber/i.test(`${str(raw.Name)} ${str(raw.DisplayName)} ${str(raw.ProfilePath)}`);
  const sure = lt === 1;
  const laserType: JczSettings['laserType'] = sure || fiberDevice ? 'fiber' : (JCZ_LASER_TYPES[lt] ?? 'fiber');
  const jcz: JczSettings = {
    field,
    offsetX: num(s.FieldOffsetX),
    offsetY: num(s.FieldOffsetY),
    angle: num(s.FieldAngle),
    galvo1: galvo(1),
    galvo2: galvo(2),
    galvo1IsX: s.Galvo_1_is_X !== false,
    laserType,
    // LightBurn stores the fiber source as a number of its own list; the name is not known here, so it stays a reference
    fiberType: `LightBurn Laser_FiberType ${fmt(num(s.Laser_FiberType))}`,
    minFreq: num(s.Laser_MinFreq, 1),
    maxFreq: num(s.Laser_MaxFreq, 200),
    pulseWidthEnabled: !!s.Laser_QPulseWidthEnabled,
    redDot: { offsetX: num(s.RedDotOffsetX), offsetY: num(s.RedDotOffsetY), scaleX: num(s.RedDotScaleX, 1), scaleY: num(s.RedDotScaleY, 1) },
    ports: {
      startMark: num(s.StartMarkPortBit, -1),
      startFrame: num(s.StartFramePortBit, -1),
      stopMark: num(s.StopMarkPortBit, -1),
      doorProtect: num(s.DoorProtectPortBit, -1),
      redLight: num(s.RedLightPortBit, -1),
    },
    jumpSpeed: num(s.Default_JumpSpeed, 4000),
    laserOnDelay: num(s.Default_LaserOn_TC),
    laserOffDelay: num(s.Default_LaserOff_TC),
    polygonDelay: num(s.Default_Polygon_TC),
    endDelay: num(s.Default_End_TC),
    minJumpDelay: num(s.Default_MinJumpDelay),
    maxJumpDelay: num(s.Default_MaxJumpDelay),
    maxJumpDistance: num(s.Default_MaxJumpDistance),
    frameSpeed: num(s.FrameSpeed, 3000),
    lightburn: structuredClone(raw),
  };
  take(
    'FieldOffsetX', 'FieldOffsetY', 'FieldAngle', 'Galvo_1_is_X', 'Laser_Type', 'Laser_FiberType', 'Laser_MinFreq', 'Laser_MaxFreq',
    'Laser_QPulseWidthEnabled', 'RedDotOffsetX', 'RedDotOffsetY', 'RedDotScaleX', 'RedDotScaleY', 'StartMarkPortBit', 'StartFramePortBit',
    'StopMarkPortBit', 'DoorProtectPortBit', 'RedLightPortBit', 'Default_JumpSpeed', 'Default_LaserOn_TC', 'Default_LaserOff_TC',
    'Default_Polygon_TC', 'Default_End_TC', 'Default_MinJumpDelay', 'Default_MaxJumpDelay', 'Default_MaxJumpDistance', 'FrameSpeed',
    'HomeOnStartup', 'MirrorX', 'MirrorY',
  );
  dev.jcz = jcz;
  // '' = the first JCZ board found on USB (LightBurn's CommPort is a USB bus position, not a board serial)
  (dev as { jczBoard?: string }).jczBoard = '';
  dev.laser = { type: laserType === 'co2' ? 'co2' : 'fiber', wavelength: WAVELENGTH[laserType] };
  dev.rapid = Math.round(jcz.jumpSpeed * 60);
  dev.homeOnConnect = false;
  note('taken', t('Markierfeld {f} × {f} mm, Versatz {x} / {y} mm, Drehung {a}°', { f: fmt(field), x: fmt(jcz.offsetX), y: fmt(jcz.offsetY), a: fmt(jcz.angle) }));
  note('taken', t('Galvo-Korrektur übernommen (Galvo 1 ist {axis}): Maßstab {s1} / {s2}, Wölbung {b1} / {b2}, Schräge {k1} / {k2}, Trapez {t1} / {t2}', {
    axis: jcz.galvo1IsX ? 'X' : 'Y',
    s1: fmt(jcz.galvo1.scale), s2: fmt(jcz.galvo2.scale), b1: fmt(jcz.galvo1.bulge), b2: fmt(jcz.galvo2.bulge),
    k1: fmt(jcz.galvo1.skew), k2: fmt(jcz.galvo2.skew), t1: fmt(jcz.galvo1.trapezoid), t2: fmt(jcz.galvo2.trapezoid),
  }));
  if (sure) note('converted', t('Laserquelle: LightBurn Laser_Type {n} ({lb}) → {type}, Fasertyp {f}, Frequenz {min} … {max} kHz. Vor dem ersten Markieren mit der Quelle vergleichen.', {
    n: lt, lb: JCZ_LASER_NAMES[lt] ?? '?', type: laserType, f: jcz.fiberType, min: fmt(jcz.minFreq), max: fmt(jcz.maxFreq),
  }));
  else note('missing', t('Laserquelle: LightBurn Laser_Type {n} ist nicht sicher zuzuordnen (Reihenfolge der LightBurn-Doku CO2, Fiber, UV, SPI: {lb}); übernommen als {type}, Fasertyp {f}, Frequenz {min} … {max} kHz. Vor dem ersten Markieren an der Quelle prüfen.', {
    n: lt, lb: JCZ_LASER_NAMES[lt] ?? '?', type: laserType, f: jcz.fiberType, min: fmt(jcz.minFreq), max: fmt(jcz.maxFreq),
  }));
  note('taken', t('Rahmen mit Rotlicht {v} mm/s', { v: fmt(jcz.frameSpeed ?? 0) }));
  note('taken', t('Sprunggeschwindigkeit {v} mm/s, Verzögerungen ein {on} / aus {off} / Ecke {poly} / Ende {end} µs, Sprung {jmin} … {jmax} µs', {
    v: fmt(jcz.jumpSpeed), on: fmt(jcz.laserOnDelay), off: fmt(jcz.laserOffDelay), poly: fmt(jcz.polygonDelay), end: fmt(jcz.endDelay), jmin: fmt(jcz.minJumpDelay), jmax: fmt(jcz.maxJumpDelay),
  }));
  const ports = Object.entries(jcz.ports).filter(([, v]) => v >= 0).map(([k, v]) => `${k} ${v}`);
  note('taken', ports.length ? t('Ein-/Ausgänge der Platine: {list}', { list: ports.join(', ') }) : t('Ein-/Ausgänge der Platine: keine belegt'));
  if (str(s.CommPort)) note('converted', t('USB-Anschluss in LightBurn {port}: KizamuBeam sucht die Platine selbst über USB.', { port: str(s.CommPort) }));
  take('CommPort');
}

/** All devices of a source, mapped */
export const mapLightburnSource = (src: LbSource): LbImport[] => src.devices.map(mapLightburnDevice);

/** KizamuBeam has the JCZ galvo firmware in this build (added by src/jcz); without it a galvo device cannot be used */
export const jczAvailable = () => 'jcz' in FIRMWARES;

/** Desktop app: LightBurn's prefs.ini on this computer (read only, in Rust: only DeviceList and DefaultDevice) */
export async function readLightburnPrefs(): Promise<LbSource> {
  const { invoke } = await import('@tauri-apps/api/core');
  const r = await invoke<{ path: string; devices: unknown[]; defaultDevice: number }>('lightburn_prefs_read');
  return parseLightburnJson(JSON.stringify({ DeviceList: r.devices, DefaultDevice: r.defaultDevice }), r.path);
}
