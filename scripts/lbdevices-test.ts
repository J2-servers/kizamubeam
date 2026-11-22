// Texts are checked by kind, numbers and LightBurn key names only (Node runs the app in English).
// Tests for "Import from LightBurn" (src/lbdevices.ts) with the three real devices of the owner's LightBurn
// (ai/dispositivos-lightburn/lightburn-devices.json: one Ruida, two JCZ fiber galvos). Run: npm run test:lbdevices
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { zipSync, strToU8 } from 'fflate';
import { firmwareFor, mapLightburnDevice, mapLightburnSource, originFromMirror, parseLightburnFile, parseLightburnJson } from '../src/lbdevices';

const text = readFileSync(new URL('../ai/dispositivos-lightburn/lightburn-devices.json', import.meta.url), 'utf8');
const src = parseLightburnJson(text, 'lightburn-devices.json');
assert.equal(src.devices.length, 3, 'three devices in the file');
const [ruida, lmc4, unknown] = mapLightburnSource(src);

// Ruida (LightBurn type "CDM"): 600 × 400, origin rear right (MirrorX + MirrorY), USB serial, home on connect
assert.equal(ruida.name, 'Ruida');
assert.equal(ruida.lbType, 'CDM');
const r = ruida.device!;
assert.equal(r.fw, 'ruida');
assert.equal(r.bedW, 600);
assert.equal(r.bedH, 400);
assert.equal(r.ruidaOrigin, 'top-right');
assert.equal(r.conn, 'serial');
assert.equal(r.port, '');
assert.equal(r.baud, 115200, 'Ruida keeps the KizamuBeam default baud rate');
assert.equal(r.homeOnConnect, true);
assert.equal(r.limitSwitches, 'yes');
assert.equal(r.startFrom, 'absolute', 'UseMachineCoordinates → absolute');
assert.equal(r.rapid, 400 * 60, 'Sim_RapidSpeed 400 mm/s → 24000 mm/min');
assert.equal(r.accel, 3000);
assert.equal(r.zAxis, false);
assert.equal(r.sMax, 100);
assert.equal(r.ruidaLaser, '1');
assert.equal(r.laser?.type, 'co2');
assert.ok(ruida.notes.some((n) => n.kind === 'missing' && /Sim_MaxSpeed|500/.test(n.text)), 'max speed reported as not imported');
assert.ok(ruida.notes.some((n) => n.kind === 'missing' && /\b29\b/.test(n.text)), 'the 29 LightBurn UI settings are reported');
assert.ok(!ruida.notes.some((n) => /DockState/.test(n.text)), 'dock states are counted, not listed');

// JCZ LMC4: field 110, corrections copied, fiber
const g1 = lmc4.device!;
assert.equal(lmc4.name, 'JCZFiber (LMC4)');
assert.equal(g1.fw, 'jcz');
assert.equal(g1.bedW, 110);
assert.equal(g1.bedH, 110);
const j1 = g1.jcz!;
assert.equal(j1.field, 110);
assert.equal(j1.angle, 271.25);
assert.equal(j1.galvo1IsX, true);
assert.deepEqual(j1.galvo1, { scale: 0.9796890020370483, bulge: 0.9757999777793884, skew: 1, trapezoid: 1, sign: -1 });
assert.deepEqual(j1.galvo2, { scale: 0.9796890020370483, bulge: 0.9757999777793884, skew: 1, trapezoid: 1, sign: 1 });
assert.equal(j1.laserType, 'fiber');
assert.equal(j1.minFreq, 1);
assert.equal(j1.maxFreq, 200);
assert.equal(j1.jumpSpeed, 4000);
assert.equal(j1.minJumpDelay, 100);
assert.equal(j1.maxJumpDelay, 200);
assert.equal(j1.ports.startMark, 14);
assert.equal(j1.ports.startFrame, 14);
assert.equal(j1.ports.redLight, -1);
assert.equal(g1.homeOnConnect, false, 'galvos never home');
assert.equal((j1.lightburn as { Settings: { CommPort: string } }).Settings.CommPort, '<3|11>', 'the whole LightBurn device is kept');

// JCZ Unknown: field 150, galvo 1 is Y, its own corrections and delays
const g2 = unknown.device!;
assert.equal(g2.fw, 'jcz');
assert.equal(g2.bedW, 150);
const j2 = g2.jcz!;
assert.equal(j2.field, 150);
assert.equal(j2.galvo1IsX, false);
assert.deepEqual(j2.galvo1, { scale: 0.7975599765777588, bulge: 0.9769999980926514, skew: 1.0020999908447266, trapezoid: 1.0020999908447266, sign: 1 });
assert.deepEqual(j2.galvo2, { scale: 0.8761900067329407, bulge: 1.0579999685287476, skew: 1.0016000270843506, trapezoid: 1.0049999952316284, sign: 1 });
assert.equal(j2.laserOnDelay, -300);
assert.equal(j2.laserOffDelay, 150);
assert.equal(j2.polygonDelay, 100);
assert.equal(j2.endDelay, 300);
assert.equal(j2.ports.redLight, 8);
assert.deepEqual(j2.redDot, { offsetX: 0, offsetY: 0, scaleX: 0.9779999852180481, scaleY: 0.9769999980926514 });
assert.equal(j2.laserType, 'fiber', 'unconfirmed Laser_Type 2 on a JCZFiber device stays fiber');
assert.ok(unknown.notes.some((n) => n.kind === 'missing' && /Laser_Type 2/.test(n.text)), 'unconfirmed laser source is reported for checking');

// Origins and types
assert.equal(originFromMirror(false, false), 'bottom-left');
assert.equal(originFromMirror(true, false), 'bottom-right');
assert.equal(originFromMirror(false, true), 'top-left');
for (const [ty, fw] of [['Ruida', 'ruida'], ['CDM', 'ruida'], ['GRBL', 'grbl'], ['GRBL-M3', 'grbl'], ['GRBL-LPC', 'grbl'], ['grblHAL', 'grblhal'], ['FluidNC', 'fluidnc'], ['Smoothieware', 'smoothie'], ['Marlin', 'marlin'], ['xTool-D1', 'xtool'], ['LibUSB', 'jcz'], ['JCZFiber', 'jcz']] as const)
  assert.equal(firmwareFor(ty), fw, ty);
assert.equal(firmwareFor('TopWisdom'), null);
const tw = mapLightburnDevice({ Type: 'TopWisdom', Name: 'TW', Width: 500, Height: 300 });
assert.equal(tw.device, null);
assert.ok(tw.reason && /TopWisdom/.test(tw.reason));

// GRBL over the network, material library and macros are reported
const grbl = mapLightburnDevice({ Type: 'GRBL', Name: 'Diode', Width: 400, Height: 400, HomeOnStartup: false, MirrorX: false, MirrorY: false, Macros: [{ Name: 'a' }], CutList: [{}, {}], Settings: { IPAddress: '192.168.1.20', Sim_RapidSpeed: 100 } });
assert.equal(grbl.device!.fw, 'grbl');
assert.equal(grbl.device!.conn, 'tcp');
assert.equal(grbl.device!.host, '192.168.1.20');
assert.equal(grbl.device!.homeOnConnect, false);
assert.ok(grbl.notes.some((n) => n.kind === 'missing' && /makro|macro/i.test(n.text)));
assert.ok(grbl.notes.some((n) => n.kind === 'missing' && /materia/i.test(n.text) && /\b2\b/.test(n.text)));

// .lbdev (one device object), .lbzip (zip of .lbdev files), prefs.ini with other keys
const one = JSON.parse(text).DeviceList[0];
assert.equal(parseLightburnFile('Ruida.lbdev', strToU8(JSON.stringify(one))).devices.length, 1);
const zip = zipSync({ 'Ruida.lbdev': strToU8(JSON.stringify({ DeviceList: [one] })), 'readme.txt': strToU8('x') });
const fromZip = parseLightburnFile('bundle.lbzip', zip);
assert.equal(fromZip.devices.length, 1);
assert.equal(mapLightburnSource(fromZip)[0].device!.ruidaOrigin, 'top-right');
const prefs = parseLightburnFile('prefs.ini', strToU8('\uFEFF' + JSON.stringify({ BugReportContactEmail: 'x', DefaultDevice: 2, DeviceList: JSON.parse(text).DeviceList })));
assert.equal(prefs.devices.length, 3);
assert.equal(prefs.defaultIndex, 2);
assert.throws(() => parseLightburnFile('broken.lbdev', strToU8('<xml/>')), /JSON/);

console.log('lbdevices: all tests passed (Ruida → ruida 600×400 top-right serial; 2 galvos → jcz 110/150)');
