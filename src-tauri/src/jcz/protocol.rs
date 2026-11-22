//! Wire format of the BJJCZ "LMC" galvo boards (USB 9588:9899), ported from the open MeerK40t
//! `balormk` driver (meerk40t/balormk/controller.py, MIT License, Copyright (c) 2021 meerk40t), which
//! itself grew out of Balor (gitlab.com/bryce15/balor, GPL-3.0). Nothing here comes from the EzCad DLL
//! or from LightBurn.
//!
//! Every packet is little-endian 16-bit words:
//! * single command: 12 bytes = opcode + 5 parameters, written to bulk endpoint 0x02; the board answers
//!   8 bytes (4 words) on endpoint 0x88;
//! * command list: 0xC00 bytes = 256 list commands of 12 bytes (opcode >= 0x8000), padded with
//!   `listEndOfList` (0x8002); written without an answer.

pub const VID: u16 = 0x9588;
pub const PID: u16 = 0x9899;
pub const EP_OUT: u8 = 0x02;
pub const EP_IN: u8 = 0x88;

pub const SINGLE_LEN: usize = 12;
pub const LIST_LEN: usize = 0xC00;

/// Galvo units over the whole field (MeerK40t `galvo_range`)
pub const GALVO_RANGE: f64 = 65535.0;
/// Centre of the field, where the board starts (MeerK40t `x=0x8000, y=0x8000`)
pub const CENTRE: u16 = 0x8000;

// List commands (controller.py `list*`)
pub const L_JUMP_TO: u16 = 0x8001;
pub const L_END_OF_LIST: u16 = 0x8002;
pub const L_LASER_ON_POINT: u16 = 0x8003;
pub const L_DELAY_TIME: u16 = 0x8004;
pub const L_MARK_TO: u16 = 0x8005;
pub const L_JUMP_SPEED: u16 = 0x8006;
pub const L_LASER_ON_DELAY: u16 = 0x8007;
pub const L_LASER_OFF_DELAY: u16 = 0x8008;
pub const L_MARK_FREQ: u16 = 0x800A;
pub const L_MARK_POWER_RATIO: u16 = 0x800B;
pub const L_MARK_SPEED: u16 = 0x800C;
pub const L_JUMP_DELAY: u16 = 0x800D;
pub const L_POLYGON_DELAY: u16 = 0x800F;
pub const L_WRITE_PORT: u16 = 0x8011;
pub const L_MARK_CURRENT: u16 = 0x8012;
pub const L_QSWITCH_PERIOD: u16 = 0x801B;
pub const L_SET_CO2_FPK: u16 = 0x801E;
pub const L_FIBER_OPEN_MO: u16 = 0x8021;
pub const L_FIBER_YLPM_PULSE_WIDTH: u16 = 0x8026;
pub const L_READY_MARK: u16 = 0x8051;

// Single commands (controller.py)
pub const DISABLE_LASER: u16 = 0x0002;
pub const ENABLE_LASER: u16 = 0x0004;
pub const EXECUTE_LIST: u16 = 0x0005;
pub const SET_PWM_PULSE_WIDTH: u16 = 0x0006;
pub const GET_VERSION: u16 = 0x0007;
pub const GET_SERIAL_NO: u16 = 0x0009;
pub const GET_LIST_STATUS: u16 = 0x000A;
pub const GOTO_XY: u16 = 0x000D;
pub const LASER_SIGNAL_OFF: u16 = 0x000E;
pub const LASER_SIGNAL_ON: u16 = 0x000F;
pub const RESET_LIST: u16 = 0x0012;
pub const WRITE_COR_TABLE: u16 = 0x0015;
pub const SET_CONTROL_MODE: u16 = 0x0016;
pub const SET_DELAY_MODE: u16 = 0x0017;
pub const SET_END_OF_LIST: u16 = 0x0019;
pub const SET_FIRST_PULSE_KILLER: u16 = 0x001A;
pub const SET_LASER_MODE: u16 = 0x001B;
pub const SET_TIMING: u16 = 0x001C;
pub const SET_STANDBY: u16 = 0x001D;
pub const SET_PWM_HALF_PERIOD: u16 = 0x001E;
pub const STOP_EXECUTE: u16 = 0x001F;
pub const STOP_LIST: u16 = 0x0020;
pub const WRITE_PORT: u16 = 0x0021;
pub const WRITE_ANALOG_PORT_1: u16 = 0x0022;
pub const READ_PORT: u16 = 0x0025;
pub const SET_FPK_PARAM_2: u16 = 0x002E;
pub const SET_FLY_RES: u16 = 0x0032;
pub const FIBER_SET_MO: u16 = 0x0033;
pub const ENABLE_Z: u16 = 0x003A;
pub const RESET: u16 = 0x0040;
pub const GET_MARK_TIME: u16 = 0x0041;

/// Status bits of word 3 of the GetVersion answer (controller.py BUSY/READY)
pub const BUSY: u16 = 0x04;
pub const READY: u16 = 0x20;

/// One 12-byte command (single or list entry): `struct.pack("<6H", ...)`
pub fn pack(op: u16, v: [u16; 5]) -> [u8; 12] {
    let mut b = [0u8; 12];
    b[0..2].copy_from_slice(&op.to_le_bytes());
    for (i, w) in v.iter().enumerate() {
        b[2 + i * 2..4 + i * 2].copy_from_slice(&w.to_le_bytes());
    }
    b
}

/// Words of a 12-byte command
pub fn unpack(b: &[u8]) -> (u16, [u16; 5]) {
    let w = |i: usize| u16::from_le_bytes([b[i * 2], b[i * 2 + 1]]);
    (w(0), [w(1), w(2), w(3), w(4), w(5)])
}

/// An empty list packet: 256 × `listEndOfList` (controller.py `empty = bytearray(nop * 0x100)`)
pub fn empty_list() -> Vec<u8> {
    let nop = pack(L_END_OF_LIST, [0; 5]);
    let mut v = Vec::with_capacity(LIST_LEN);
    for _ in 0..LIST_LEN / SINGLE_LEN {
        v.extend_from_slice(&nop);
    }
    v
}

/// Python's `round()` (ties to even), so the converted values match MeerK40t bit for bit
pub fn py_round(x: f64) -> i64 {
    x.round_ties_even() as i64
}

/// Galvo units per mm for a square field of `field` mm (MeerK40t `view.position("1mm")`)
pub fn galvos_per_mm(field: f64) -> f64 {
    GALVO_RANGE / field
}

/// mm/s → galvo units per ms (controller.py `_convert_speed`, truncated like Python `int()`)
pub fn speed_units(speed_mm_s: f64, field: f64) -> u32 {
    (speed_mm_s * galvos_per_mm(field) / 1000.0).abs().trunc() as u32
}

/// kHz → period (controller.py `_convert_frequency`): base 20000 for the fiber Q-switch, 10000 for CO2/UV
pub fn period(frequency_khz: f64, base: f64) -> u16 {
    (py_round(base / frequency_khz) & 0xFFFF) as u16
}

/// % → 12-bit current of fiber sources (controller.py `_convert_power`)
pub fn fiber_current(power: f64) -> u16 {
    py_round(power * 0xFFF as f64 / 100.0) as u16
}

/// % → power ratio of CO2/UV sources (controller.py `power()`)
pub fn power_ratio(power: f64, frequency_khz: f64) -> u16 {
    py_round(200.0 * power / frequency_khz).clamp(0, 0xFFFF) as u16
}

/// Signed delay as (abs, sign word) like controller.py `list_laser_on_delay`
pub fn signed(delay: i64) -> [u16; 2] {
    [delay.unsigned_abs().min(0xFFFF) as u16, if delay >= 0 { 0 } else { 0x8000 }]
}

pub fn list_name(op: u16) -> &'static str {
    match op {
        L_JUMP_TO => "listJumpTo",
        L_END_OF_LIST => "listEndOfList",
        L_LASER_ON_POINT => "listLaserOnPoint",
        L_DELAY_TIME => "listDelayTime",
        L_MARK_TO => "listMarkTo",
        L_JUMP_SPEED => "listJumpSpeed",
        L_LASER_ON_DELAY => "listLaserOnDelay",
        L_LASER_OFF_DELAY => "listLaserOffDelay",
        L_MARK_FREQ => "listMarkFreq",
        L_MARK_POWER_RATIO => "listMarkPowerRatio",
        L_MARK_SPEED => "listMarkSpeed",
        L_JUMP_DELAY => "listJumpDelay",
        L_POLYGON_DELAY => "listPolygonDelay",
        L_WRITE_PORT => "listWritePort",
        L_MARK_CURRENT => "listMarkCurrent",
        L_QSWITCH_PERIOD => "listQSwitchPeriod",
        L_SET_CO2_FPK => "listSetCo2FPK",
        L_FIBER_OPEN_MO => "listFiberOpenMO",
        L_FIBER_YLPM_PULSE_WIDTH => "listFiberYLPMPulseWidth",
        L_READY_MARK => "listReadyMark",
        _ => "list?",
    }
}

pub fn single_name(op: u16) -> &'static str {
    match op {
        DISABLE_LASER => "DisableLaser",
        ENABLE_LASER => "EnableLaser",
        EXECUTE_LIST => "ExecuteList",
        SET_PWM_PULSE_WIDTH => "SetPwmPulseWidth",
        GET_VERSION => "GetVersion",
        GET_SERIAL_NO => "GetSerialNo",
        GET_LIST_STATUS => "GetListStatus",
        GOTO_XY => "GotoXY",
        LASER_SIGNAL_OFF => "LaserSignalOff",
        LASER_SIGNAL_ON => "LaserSignalOn",
        RESET_LIST => "ResetList",
        WRITE_COR_TABLE => "WriteCorTable",
        SET_CONTROL_MODE => "SetControlMode",
        SET_DELAY_MODE => "SetDelayMode",
        SET_END_OF_LIST => "SetEndOfList",
        SET_FIRST_PULSE_KILLER => "SetFirstPulseKiller",
        SET_LASER_MODE => "SetLaserMode",
        SET_TIMING => "SetTiming",
        SET_STANDBY => "SetStandby",
        SET_PWM_HALF_PERIOD => "SetPwmHalfPeriod",
        STOP_EXECUTE => "StopExecute",
        STOP_LIST => "StopList",
        WRITE_PORT => "WritePort",
        WRITE_ANALOG_PORT_1 => "WriteAnalogPort1",
        READ_PORT => "ReadPort",
        SET_FPK_PARAM_2 => "SetFpkParam2",
        SET_FLY_RES => "SetFlyRes",
        FIBER_SET_MO => "Fiber_SetMo",
        ENABLE_Z => "EnableZ",
        RESET => "Reset",
        GET_MARK_TIME => "GetMarkTime",
        _ => "?",
    }
}

/// Readable form of a packet for the console (like mock_connection.py `_parse_single`/`_parse_list`):
/// one line per command, runs of the same command collapsed, at most `max_lines` lines.
pub fn describe(packet: &[u8], max_lines: usize) -> Vec<String> {
    let line = |b: &[u8]| {
        let (op, v) = unpack(b);
        let name = if op >= 0x8000 { list_name(op) } else { single_name(op) };
        let mut args: Vec<String> = v.iter().map(|x| x.to_string()).collect();
        while args.last().map(|s| s == "0").unwrap_or(false) {
            args.pop();
        }
        format!("{op:04X} {name} {}", args.join(" ")).trim_end().to_string()
    };
    if packet.len() == SINGLE_LEN {
        return vec![line(packet)];
    }
    let mut out = Vec::new();
    let mut last: Option<String> = None;
    let mut repeats = 0usize;
    let mut hidden = 0usize;
    for chunk in packet.chunks(SINGLE_LEN) {
        let l = line(chunk);
        if last.as_deref() == Some(l.as_str()) {
            repeats += 1;
            continue;
        }
        if repeats > 0 {
            if out.len() < max_lines {
                out.push(format!("… {repeats}× wiederholt"));
            }
            repeats = 0;
        }
        if out.len() < max_lines {
            out.push(l.clone());
        } else {
            hidden += 1;
        }
        last = Some(l);
    }
    if repeats > 0 && out.len() < max_lines {
        out.push(format!("… {repeats}× wiederholt"));
    }
    if hidden > 0 {
        out.push(format!("… {hidden} weitere Befehle"));
    }
    out
}
