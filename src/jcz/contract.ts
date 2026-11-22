// Galvo fiber lasers with a JCZ/EZCad board (BJJCZ "LMC" controllers, USB VID 0x9588 PID 0x9899), the same machines
// LightBurn drives as "JCZFiber". KizamuBeam talks to the board through the WinUSB driver Windows already has for it
// (installed by LightBurn/EZCad: service WINUSB, interface GUID {76650bf0-545c-4b30-b652-f62991fc89e9}); the board
// protocol is ported from the open implementations (Balor / MeerK40t "balormk"). No vendor DLL, nothing from LightBurn.
//
// This file is the contract between three parts built in parallel:
//   rust     — src-tauri/src/jcz/*.rs: USB transport, board protocol, job player, simulator; the Tauri commands below
//   app      — src/jcz/*.ts + firmware 'jcz' in src/gcode.ts, src/machine.ts, src/laser.ts: device, job, panel
//   import   — src/lbdevices.ts: "Import from LightBurn" in the devices dialog (Ruida, GRBL family and JCZ devices)
// Each part only relies on these types and command names. Add to this file; never change what is here.

/** Galvo settings of a device, mirroring LightBurn's JCZFiber device settings (names kept close to LightBurn's) */
export interface JczSettings {
  /** Square marking field of the lens, mm (LightBurn: device Width = Height) */
  field: number;
  /** Field offset and rotation (LightBurn FieldOffsetX/Y, FieldAngle in degrees) */
  offsetX: number;
  offsetY: number;
  angle: number;
  /** Galvo correction per galvo (LightBurn Galvo_1_* / Galvo_2_*): scale, bulge, skew, trapezoid, sign; galvo 1 is X? */
  galvo1: JczGalvo;
  galvo2: JczGalvo;
  galvo1IsX: boolean;
  /** Laser source: LightBurn Laser_Type (fiber/CO2/UV), Laser_FiberType (e.g. JPT M7, Raycus Q), frequency limits kHz */
  laserType: 'fiber' | 'co2' | 'uv';
  fiberType: string;
  minFreq: number;
  maxFreq: number;
  /** Pulse width (ns) control for MOPA sources (LightBurn Laser_QPulseWidthEnabled) */
  pulseWidthEnabled: boolean;
  /** Red guide light: offset and scale relative to the beam (LightBurn RedDotOffsetX/Y, RedDotScaleX/Y) */
  redDot: { offsetX: number; offsetY: number; scaleX: number; scaleY: number };
  /** Inputs/outputs of the board (LightBurn *PortBit; -1 = not used): foot pedal start, door switch, red light output */
  ports: { startMark: number; startFrame: number; stopMark: number; doorProtect: number; redLight: number };
  /** Default timing (LightBurn Default_*: jump speed mm/s, delays µs) */
  jumpSpeed: number;
  laserOnDelay: number;
  laserOffDelay: number;
  polygonDelay: number;
  endDelay: number;
  minJumpDelay: number;
  maxJumpDelay: number;
  maxJumpDistance: number;
  /** Speed of the red-light frame, mm/s (LightBurn FrameSpeed); undefined = 3000 (added by the app part) */
  frameSpeed?: number;
  /** Everything else LightBurn stored for this device, kept for a later re-export and for fields not mapped yet */
  lightburn?: Record<string, unknown>;
}

export interface JczGalvo {
  scale: number;
  bulge: number;
  skew: number;
  trapezoid: number;
  sign: number;
}

/** Marking parameters of one pass (a layer of the design) */
export interface JczParams {
  /** mm/s */
  speed: number;
  /** % of the source power */
  power: number;
  /** kHz */
  frequency: number;
  /** ns (MOPA); ignored when pulse width control is off */
  pulseWidth: number;
  passes: number;
  /** µs; undefined = the device default */
  laserOnDelay?: number;
  laserOffDelay?: number;
  polygonDelay?: number;
}

/** A job in field coordinates: mm, origin at the field centre, x right, y up (the rust side applies corrections) */
export interface JczJob {
  groups: { params: JczParams; polylines: [number, number][][] }[];
  /** Repeat the whole job n times (LightBurn "Repeat"); 1 = once */
  repeat: number;
}

/** What `jcz_list` returns: boards present on USB through WinUSB */
export interface JczBoard {
  serial: string;
  vid: number;
  pid: number;
  /** "LMC V4", "Unknown" … as read from the board when possible */
  model: string;
}

export interface JczStatus {
  connected: boolean;
  /** board busy marking or framing */
  busy: boolean;
  /** last state word read from the board (raw, for the console) */
  raw: number;
  /** progress of the running job, 0..1 */
  progress: number;
  /** literal message of the last error from the board or the USB layer (never "unknown error") */
  error?: string;
  /** true when the simulator answers instead of a board (KZ_JCZ_SIM=1 or no board and simulator chosen) */
  simulated: boolean;
  /** added by the rust part: input port word of the board (foot pedal, door …) */
  inputs?: number;
  /** added by the rust part: what the board is doing */
  mode?: 'idle' | 'frame' | 'mark';
}

/**
 * Tauri commands (rust part). All return Result<_, String> with the literal cause.
 *   jcz_list()                                  -> JczBoard[]
 *   jcz_connect({ serial?: string, settings: JczSettings, simulate?: boolean }) -> JczStatus
 *   jcz_disconnect()                            -> void
 *   jcz_status()                                -> JczStatus
 *   jcz_frame({ polyline: [number,number][], speed: number, loop: boolean }) -> void   (red guide light only; laser OFF)
 *   jcz_mark({ job: JczJob })                   -> void   (fires the laser; the app asks for confirmation first)
 *   jcz_stop()                                  -> void   (stops framing or marking at once; laser off)
 *   jcz_light({ on: boolean })                  -> void   (red guide light on/off)
 * Events emitted to the window that connected: 'jcz:status' (JczStatus), 'jcz:log' (string line for the console).
 */
export const JCZ_COMMANDS = ['jcz_list', 'jcz_connect', 'jcz_disconnect', 'jcz_status', 'jcz_frame', 'jcz_mark', 'jcz_stop', 'jcz_light'] as const;
export const JCZ_EVENTS = { status: 'jcz:status', log: 'jcz:log' } as const;
export const JCZ_USB = { vid: 0x9588, pid: 0x9899, interfaceGuid: '{76650bf0-545c-4b30-b652-f62991fc89e9}' } as const;
