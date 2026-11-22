//! Ruida DSP binary format (`.rd`) writer, decoder, and protocol helpers.
//!
//! Converts KizamuBeam's `Moves` list into scrambled `.rd` binary data for Ruida DSP controllers
//! (RDC6442G/S, RDC6445G/S, RDC6332, RDLC320, etc.) and decodes `.rd` files back into vector paths
//! and layer parameters.
//!
//! Protocol facts come from the MeerK40t project (MIT) and the Ruida Protocol Analyzer by Steve
//! Isaacs (MIT); this is an independent implementation.

use crate::gcode::Moves;
use crate::raster::js_round;
use serde::Deserialize;
use std::collections::HashMap;

pub const ACK: u8 = 0xCC;
pub const NAK: u8 = 0xCF;
pub const DEFAULT_MAGIC: u8 = 0x88;

/// Scramble a single byte with the card's magic value (`0x88`, `0x11`, `0x38`).
pub fn swizzle_byte(b: u8, magic: u8) -> u8 {
    let swapped = (b & 0x7E) | ((b >> 7) & 1) | ((b & 1) << 7);
    (swapped ^ magic).wrapping_add(1)
}

/// Unscramble a single byte with the card's magic value.
pub fn unswizzle_byte(b: u8, magic: u8) -> u8 {
    let b = b.wrapping_sub(1) ^ magic;
    (b & 0x7E) | ((b >> 7) & 1) | ((b & 1) << 7)
}

pub fn swizzle(data: &[u8], magic: u8) -> Vec<u8> {
    data.iter().map(|&b| swizzle_byte(b, magic)).collect()
}

pub fn unswizzle(data: &[u8], magic: u8) -> Vec<u8> {
    data.iter().map(|&b| unswizzle_byte(b, magic)).collect()
}

/// Guess the magic byte of a scrambled `.rd` buffer from byte frequency (0x00 is most common).
pub fn magic_from_histogram(data: &[u8]) -> u8 {
    let mut hist = [0usize; 256];
    let mut prev = None;
    for &b in data {
        hist[b as usize] += if prev == Some(b) { 5 } else { 1 };
        prev = Some(b);
    }
    let top = (0..256).max_by_key(|&i| hist[i]).unwrap_or(0) as u8;
    top.wrapping_sub(1)
}

/// Determine the magic byte of a `.rd` file.
pub fn magic_for_file(data: &[u8]) -> u8 {
    let guess = magic_from_histogram(data);
    let fits = |m: u8| {
        data.first().is_some_and(|&b| unswizzle_byte(b, m) >= 0x80)
            && data.last().is_some_and(|&b| unswizzle_byte(b, m) == 0xD7)
    };
    [guess, 0x88, 0x11, 0x38]
        .into_iter()
        .find(|&m| fits(m))
        .unwrap_or(guess)
}

/// Verify the 16-bit big-endian checksum of a UDP data-port packet and return the scrambled payload.
pub fn checked_payload(packet: &[u8]) -> Option<&[u8]> {
    if packet.len() < 3 {
        return None;
    }
    let want = u16::from_be_bytes([packet[0], packet[1]]);
    let data = &packet[2..];
    let sum = data.iter().fold(0u16, |a, &b| a.wrapping_add(b as u16));
    (sum == want).then_some(data)
}

/// Build a UDP data-port packet (2-byte big-endian checksum + scrambled payload).
pub fn packet(cmds: &[u8], magic: u8) -> Vec<u8> {
    let data = swizzle(cmds, magic);
    let sum = data.iter().fold(0u16, |a, &b| a.wrapping_add(b as u16));
    let mut p = sum.to_be_bytes().to_vec();
    p.extend(data);
    p
}

/// Split unscrambled Ruida bytes into individual commands (each command begins with a byte >= 0x80).
pub fn split_commands(data: &[u8]) -> Vec<&[u8]> {
    let mut out = Vec::new();
    let mut start = None;
    for (i, &b) in data.iter().enumerate() {
        if b >= 0x80 {
            if let Some(s) = start {
                out.push(&data[s..i]);
            }
            start = Some(i);
        }
    }
    if let Some(s) = start {
        out.push(&data[s..]);
    }
    out
}

/// Split unscrambled Ruida commands into UDP packets of at most `max_payload` command bytes,
/// never splitting a command across packet boundaries.
pub fn packetize(plain: &[u8], max_payload: usize, magic: u8) -> Vec<Vec<u8>> {
    let limit = max_payload.max(32);
    let mut packets = Vec::new();
    let mut chunk = Vec::with_capacity(limit);
    for cmd in split_commands(plain) {
        if !chunk.is_empty() && chunk.len() + cmd.len() > limit {
            packets.push(packet(&chunk, magic));
            chunk.clear();
        }
        chunk.extend_from_slice(cmd);
    }
    if !chunk.is_empty() {
        packets.push(packet(&chunk, magic));
    }
    packets
}

pub fn u14(d: &[u8]) -> Option<u32> {
    (d.len() >= 2).then(|| ((d[0] as u32 & 0x7F) << 7) | (d[1] as u32 & 0x7F))
}

pub fn i14(d: &[u8]) -> Option<i32> {
    u14(d).map(|v| if v > 0x1FFF { v as i32 - 0x4000 } else { v as i32 })
}

pub fn u35(d: &[u8]) -> Option<u64> {
    (d.len() >= 5).then(|| {
        d[..5]
            .iter()
            .fold(0u64, |a, &b| (a << 7) | (b as u64 & 0x7F))
    })
}

pub fn i35(d: &[u8]) -> Option<i64> {
    u35(d).map(|v| (v as u32) as i32 as i64)
}

pub fn encode_u35(v: u32) -> [u8; 5] {
    let v = v as u64;
    [
        ((v >> 28) & 0x7F) as u8,
        ((v >> 21) & 0x7F) as u8,
        ((v >> 14) & 0x7F) as u8,
        ((v >> 7) & 0x7F) as u8,
        (v & 0x7F) as u8,
    ]
}

pub fn encode_i35(v: i64) -> [u8; 5] {
    encode_u35(v as i32 as u32)
}

pub fn encode_i14(v: i32) -> [u8; 2] {
    let v = (v & 0x3FFF) as u32;
    [((v >> 7) & 0x7F) as u8, (v & 0x7F) as u8]
}

pub fn encode_power(percent: f64) -> [u8; 2] {
    let v = js_round(percent.clamp(0.0, 100.0) * 16383.0 / 100.0) as i32;
    encode_i14(v)
}

pub fn mm(d: &[u8]) -> Option<f64> {
    i35(d).map(|v| v as f64 / 1000.0)
}

pub fn mm_short(d: &[u8]) -> Option<f64> {
    i14(d).map(|v| v as f64 / 1000.0)
}

pub fn power(d: &[u8]) -> Option<f64> {
    u14(d).map(|v| v as f64 * 100.0 / 16383.0)
}

/// µm/s → mm/s
pub fn speed(d: &[u8]) -> Option<f64> {
    i35(d).map(|v| v as f64 / 1000.0)
}

/// Memory addresses (`DA 00 hi lo`, address = hi << 7 | lo).
pub mod mem {
    pub const BED_X: u32 = 0x0026;
    pub const BED_Y: u32 = 0x0036;
    pub const STATUS: u32 = 0x0200;
    pub const POS_X: u32 = 0x0221;
    pub const POS_Y: u32 = 0x0231;
    pub const POS_Z: u32 = 0x0241;
    pub const POS_U: u32 = 0x0251;
    pub const CARD_ID: u32 = 0x02FE;
    pub const MAINBOARD: u32 = 0x02FF;
    // Read-only machine parameters (EduTech wiki "Ruida", list of known properties;
    // MeerK40t `ruida/emulator.py` `mem_lookup`). KizamuBeam never writes these (`DA 01`).
    /// G0 Velocity (µm/s; MeerK40t emulator: 200000 = 200 mm/s)
    pub const G0_VELOCITY: u32 = 0x0005;
    /// Axis Max Velocity 1/2/3 (X, Y, Z; µm/s)
    pub const MAX_VEL_X: u32 = 0x0023;
    pub const MAX_VEL_Y: u32 = 0x0033;
    pub const MAX_VEL_Z: u32 = 0x0043;
    /// Axis Max Acc 1/2/3 (X, Y, Z; µm/s²)
    pub const MAX_ACC_X: u32 = 0x0025;
    pub const MAX_ACC_Y: u32 = 0x0035;
    pub const MAX_ACC_Z: u32 = 0x0045;
    /// Axis Range 3 (Z travel, µm)
    pub const BED_Z: u32 = 0x0046;
    /// Total Doc Number: count of files stored in controller memory
    pub const DOC_COUNT: u32 = 0x0205;
}

pub const STATUS_JOB_RUNNING: u32 = 0x0000_0001;
pub const STATUS_PAUSED: u32 = 0x0000_0002;
pub const STATUS_MOVING: u32 = 0x0100_0000;

/// Unscrambled 4-byte command to read a controller memory address.
pub fn mem_read_cmd(addr: u32) -> [u8; 4] {
    [
        0xDA,
        0x00,
        ((addr >> 7) & 0x7F) as u8,
        (addr & 0x7F) as u8,
    ]
}

/// Parse an unscrambled `DA 01 hi lo <payload>` memory reply.
pub fn parse_mem_reply(plain: &[u8]) -> Option<(u32, &[u8])> {
    if plain.len() < 4 || plain[0] != 0xDA || plain[1] != 0x01 {
        return None;
    }
    let addr = u14(&plain[2..4])?;
    Some((addr, &plain[4..]))
}

/// Known Ruida card IDs mapped to controller names.
pub fn card_name(id: u32) -> &'static str {
    match id {
        0x6510_6510 => "RDC6442S",
        0x6500_6500 => "RDC6442G",
        0x6545_6545 => "RDC6445G",
        0x6546_6546 => "RDC6445S",
        0x6532_6532 => "RDC6332G",
        0x6520_6520 => "RDLC320A",
        0x6584_6584 => "RDC8445S",
        _ => "Ruida DSP",
    }
}

/// Whether X and Y axes grow opposite to KizamuBeam's bed coordinates (origin front-left, +X right, +Y back).
pub fn flip_axes(origin: &str) -> (bool, bool) {
    match origin {
        "top-left" => (false, true),
        "bottom-left" => (false, false),
        "bottom-right" => (true, false),
        _ => (true, true), // "top-right" (back-right, default CO2 origin)
    }
}

/// Convert KizamuBeam bed coordinates (mm) to Ruida machine coordinates (mm) for absolute mode.
pub fn to_ruida_abs(origin: &str, bed_w: f64, bed_h: f64, x: f64, y: f64) -> [f64; 2] {
    let (fx, fy) = flip_axes(origin);
    [
        if fx { bed_w - x } else { x },
        if fy { bed_h - y } else { y },
    ]
}

/// Convert Ruida machine coordinates (mm) back to KizamuBeam bed coordinates (mm).
pub fn from_ruida_abs(origin: &str, bed_w: f64, bed_h: f64, rx: f64, ry: f64) -> [f64; 2] {
    to_ruida_abs(origin, bed_w, bed_h, rx, ry)
}

/// Convert a relative displacement `(dx, dy)` in KizamuBeam bed axes to Ruida axes.
pub fn to_ruida_rel(origin: &str, dx: f64, dy: f64) -> [f64; 2] {
    let (fx, fy) = flip_axes(origin);
    [if fx { -dx } else { dx }, if fy { -dy } else { dy }]
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuidaLayer {
    pub index: i16,
    /// Feed rate in mm/min
    pub speed: f64,
    /// Max power in % (0..100)
    pub power: f64,
    /// Min/corner power in % (0..100; 0 uses `power`)
    #[serde(default)]
    pub min_power: f64,
    /// 24-bit BGR color (`(b << 16) | (g << 8) | r`)
    #[serde(default)]
    pub color: u32,
    /// Work mode of this part: 0 = cut, 1 = scan one-way, 2 = scan both ways (`CA 41 <part> <mode>`)
    #[serde(default)]
    pub scan: u8,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuidaParams {
    pub x0: f64,
    pub y0: f64,
    pub bed_w: f64,
    pub bed_h: f64,
    #[serde(default = "default_origin")]
    pub origin: String,
    #[serde(default = "default_start_from")]
    pub start_from: String,
    #[serde(default = "default_magic")]
    pub magic: u8,
    #[serde(default = "default_laser")]
    pub laser: String,
    #[serde(default)]
    pub return_home: bool,
    #[serde(default)]
    pub air: Vec<i16>,
    #[serde(default)]
    pub layers: Vec<RuidaLayer>,
    /// Optional 8-character document name (`0xE7 0x01`)
    #[serde(default)]
    pub filename: Option<String>,
    /// Upload into internal controller memory (`0xE8 0x02`) without immediate execution
    #[serde(default)]
    pub upload: bool,
    /// Image raster moves in the controller's scan mode: `[from, to, part]` (move indices `from..to`, sorted)
    #[serde(default)]
    pub scan: Vec<[u32; 3]>,
    /// Z offset changes `[move index, z mm]` (machine direction, relative to the height at the start)
    #[serde(default)]
    pub z: Vec<(u32, f64)>,
}

/// Sanitize a document name to a valid Ruida 8-character uppercase ASCII identifier (`[A-Z0-9_-]`).
pub fn sanitize_filename(name: &str) -> String {
    let base = name
        .trim()
        .strip_suffix(".rd")
        .or_else(|| name.trim().strip_suffix(".RD"))
        .or_else(|| name.trim().strip_suffix(".kzb"))
        .or_else(|| name.trim().strip_suffix(".KZB"))
        .unwrap_or(name.trim());
    let mut out = String::with_capacity(8);
    for ch in base.chars() {
        if out.len() >= 8 {
            break;
        }
        let c = match ch {
            'a'..='z' => ch.to_ascii_uppercase(),
            'A'..='Z' | '0'..='9' | '_' | '-' => ch,
            'ä' | 'Ä' => 'A',
            'ö' | 'Ö' => 'O',
            'ü' | 'Ü' => 'U',
            'ß' => 'S',
            ' ' | '.' => '_',
            _ => continue,
        };
        out.push(c);
    }
    let trimmed = out.trim_matches(|c| c == '_' || c == '-');
    if trimmed.is_empty() {
        "KIZAMU".into()
    } else {
        trimmed.to_string()
    }
}

/// If `plain` starts with `0xE8 0x02 <filename> 0x00` (upload to controller memory), returns the filename.
pub fn upload_filename(plain: &[u8]) -> Option<String> {
    if plain.len() < 4 || plain[0] != 0xE8 || plain[1] != 0x02 {
        return None;
    }
    let end = plain[2..]
        .iter()
        .position(|&b| b == 0 || b >= 0x80)
        .unwrap_or(plain.len() - 2);
    let s = String::from_utf8_lossy(&plain[2..2 + end]).trim().to_string();
    Some(if s.is_empty() { "KIZAMU".into() } else { s })
}

/// Build unscrambled Ruida command to select stored file `file_num` (`1..=99`) and start it (`0xE8 0x03 <u14> 0xD8 0x00`).
pub fn select_and_start_file_cmd(file_num: u16) -> Vec<u8> {
    let num = file_num.clamp(1, 99) as i32;
    let [hi, lo] = encode_i14(num);
    vec![0xE8, 0x03, hi, lo, 0xD8, 0x00]
}

/// Build unscrambled Ruida command to delete all stored files in controller memory (`0xE8 0x00 0x00 0x00`).
pub fn delete_all_files_cmd() -> [u8; 4] {
    [0xE8, 0x00, 0x00, 0x00]
}

/// Ask for the name of stored file `file_num` (`E8 01 <u14>`, "Document Name"; the controller answers
/// `E8 01 <u14> <name> 00`, see MeerK40t `ruida/emulator.py`).
pub fn file_name_cmd(file_num: u16) -> [u8; 4] {
    let [hi, lo] = encode_i14(file_num.clamp(1, 99) as i32);
    [0xE8, 0x01, hi, lo]
}

/// Name from an unscrambled `E8 01 <u14> <name> 00` reply for file `file_num`.
pub fn parse_file_name_reply(plain: &[u8], file_num: u16) -> Option<String> {
    if plain.len() < 4 || plain[0] != 0xE8 || plain[1] != 0x01 || u14(&plain[2..4])? != file_num as u32 {
        return None;
    }
    let name: String = plain[4..]
        .iter()
        .take_while(|&&b| b != 0 && b < 0x80)
        .map(|&b| b as char)
        .collect();
    Some(name.trim().to_string())
}

/// Whether an unscrambled reply to `E8 01` is complete (zero after the name).
pub fn file_name_reply_done(plain: &[u8]) -> bool {
    plain.len() >= 5 && plain[0] == 0xE8 && plain[1] == 0x01 && plain[4..].contains(&0)
}

/// Delete stored file `file_num` (`E8 00 <u14 first> <u14 last>`; first = 0 would delete all, so 1..=99 only).
/// Layout from MeerK40t `ruida/emulator.py` ("Delete Document v1 v2").
pub fn delete_file_cmd(file_num: u16) -> [u8; 6] {
    let [hi, lo] = encode_i14(file_num.clamp(1, 99) as i32);
    [0xE8, 0x00, hi, lo, hi, lo]
}

/// Relative Z rapid move for jogging (`D9 02 <option 02 = no origin> <i35 µm>`). MeerK40t `rdjob.py`
/// `rapid_move_z` / `RAPID_OPTION_NONE`; its driver sends relative steps with this option (`move_rel`).
pub fn z_jog_cmd(dz_mm: f64) -> [u8; 8] {
    let v = encode_i35(js_round(dz_mm * 1000.0) as i64);
    [0xD9, 0x02, 0x02, v[0], v[1], v[2], v[3], v[4]]
}

/// Z axis move inside a job (`80 08 <i35 µm>`, "Axis Z Move": EduTech wiki "Ruida"; MeerK40t `rdjob.py` adds
/// the value to Z, i.e. relative).
pub fn z_move_cmd(dz_um: i64) -> [u8; 7] {
    let v = encode_i35(dz_um);
    [0x80, 0x08, v[0], v[1], v[2], v[3], v[4]]
}

/// Z step of a relative jog line (`$J=G91 G21 Z0.5 F60`, from `zJogLines`); `None` for anything else.
pub fn parse_z_jog(line: &str) -> Option<f64> {
    let body = line.strip_prefix("$J=")?;
    let toks: Vec<&str> = body.split_whitespace().collect();
    if !toks.contains(&"G91") || toks.iter().any(|t| t.starts_with('X') || t.starts_with('Y')) {
        return None;
    }
    toks.iter()
        .find_map(|t| t.strip_prefix('Z').and_then(|s| s.parse::<f64>().ok()))
        .filter(|v| v.is_finite() && *v != 0.0)
}

/// Hex dump of bytes (for messages that must show what the controller literally answered).
pub fn hex(data: &[u8]) -> String {
    data.iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" ")
}

/// Read-only report of the machine parameters. `read` reads one memory address (`DA 00`) and returns the
/// reply payload or the literal transport error; `emit` gets each console line as soon as it is known: first the
/// GRBL-style `$130=` … lines the device dialog understands (bed, then max rate, then acceleration), then the
/// `[Ruida] …` lines. Returns the bed size, when read.
pub fn machine_params_report<F, E>(mut read: F, mut emit: E) -> [Option<f64>; 2]
where
    F: FnMut(u32) -> Result<Vec<u8>, String>,
    E: FnMut(String),
{
    let mut notes = Vec::new();
    let val = |read: &mut F, addr: u32, label: &str, notes: &mut Vec<String>| -> Option<f64> {
        match read(addr) {
            Ok(p) => match i35(&p) {
                Some(v) => Some(v as f64 / 1000.0),
                None => {
                    notes.push(format!("[Ruida] {label}: unerwartete Antwort {}", hex(&p)));
                    None
                }
            },
            Err(e) => {
                notes.push(format!("[Ruida] {label} nicht gelesen: {e}"));
                None
            }
        }
    };
    // GRBL numbering so the device dialog fills bed, rapid (mm/min) and acceleration
    let bx = val(&mut read, mem::BED_X, "Arbeitsbereich X", &mut notes);
    let by = val(&mut read, mem::BED_Y, "Arbeitsbereich Y", &mut notes);
    for (k, v) in [("130", bx), ("131", by)] {
        if let Some(v) = v {
            emit(format!("${k}={v:.3}"));
        }
    }
    let vx = val(&mut read, mem::MAX_VEL_X, "Höchstgeschwindigkeit X", &mut notes);
    let vy = val(&mut read, mem::MAX_VEL_Y, "Höchstgeschwindigkeit Y", &mut notes);
    for (k, v) in [("110", vx), ("111", vy)] {
        if let Some(v) = v.filter(|v| *v > 0.0) {
            emit(format!("${k}={:.3}", v * 60.0));
        }
    }
    let ax = val(&mut read, mem::MAX_ACC_X, "Höchstbeschleunigung X", &mut notes);
    let ay = val(&mut read, mem::MAX_ACC_Y, "Höchstbeschleunigung Y", &mut notes);
    for (k, v) in [("120", ax), ("121", ay)] {
        if let Some(v) = v.filter(|v| *v > 0.0) {
            emit(format!("${k}={v:.3}"));
        }
    }
    let bz = val(&mut read, mem::BED_Z, "Arbeitsbereich Z", &mut notes);
    let vz = val(&mut read, mem::MAX_VEL_Z, "Höchstgeschwindigkeit Z", &mut notes);
    let az = val(&mut read, mem::MAX_ACC_Z, "Höchstbeschleunigung Z", &mut notes);
    let g0 = val(&mut read, mem::G0_VELOCITY, "Eilgang (G0)", &mut notes);
    match read(mem::CARD_ID) {
        Ok(p) => match u35(&p) {
            Some(id) => emit(format!(
                "[Ruida] Steuerung: {}, Karten-ID 0x{:08X}",
                card_name(id as u32),
                id as u32
            )),
            None => notes.push(format!("[Ruida] Karten-ID: unerwartete Antwort {}", hex(&p))),
        },
        Err(e) => notes.push(format!("[Ruida] Karten-ID nicht gelesen: {e}")),
    }
    match read(mem::MAINBOARD) {
        Ok(p) => {
            let text: String = p
                .iter()
                .take_while(|&&b| b != 0)
                .map(|&b| b as char)
                .collect();
            let printable = text.len() >= 2 && text.chars().all(|c| (' '..='~').contains(&c));
            if printable {
                emit(format!("[Ruida] Mainboard-Version: {}", text.trim()));
            } else if let Some(v) = u35(&p) {
                emit(format!("[Ruida] Mainboard-Version: 0x{:08X}", v as u32));
            } else {
                notes.push(format!("[Ruida] Mainboard-Version: unerwartete Antwort {}", hex(&p)));
            }
        }
        Err(e) => notes.push(format!("[Ruida] Mainboard-Version nicht gelesen: {e}")),
    }
    let f = |v: Option<f64>| v.map_or_else(|| "?".to_string(), |v| format!("{v:.3}"));
    emit(format!(
        "[Ruida] Arbeitsbereich: X {} mm, Y {} mm, Z {} mm",
        f(bx),
        f(by),
        f(bz)
    ));
    emit(format!(
        "[Ruida] Höchstgeschwindigkeit: X {} mm/s, Y {} mm/s, Z {} mm/s",
        f(vx),
        f(vy),
        f(vz)
    ));
    emit(format!(
        "[Ruida] Höchstbeschleunigung: X {} mm/s², Y {} mm/s², Z {} mm/s²",
        f(ax),
        f(ay),
        f(az)
    ));
    emit(format!("[Ruida] Eilgang (G0): {} mm/s", f(g0)));
    for n in notes {
        emit(n);
    }
    emit("[Ruida] Nur gelesen: KizamuBeam schreibt keine Maschinenparameter.".into());
    [bx, by]
}

fn default_origin() -> String {
    "top-right".into()
}

fn default_start_from() -> String {
    "absolute".into()
}

fn default_magic() -> u8 {
    DEFAULT_MAGIC
}

fn default_laser() -> String {
    "1".into()
}

fn um(mm_val: f64) -> i64 {
    js_round(mm_val * 1000.0) as i64
}

fn map_point(p: &RuidaParams, x: f64, y: f64) -> [i64; 2] {
    let [rx, ry] = if p.start_from == "absolute" {
        to_ruida_abs(&p.origin, p.bed_w, p.bed_h, x, y)
    } else {
        to_ruida_rel(&p.origin, x - p.x0, y - p.y0)
    };
    [um(rx), um(ry)]
}

fn push_layer_power(out: &mut Vec<u8>, idx: u8, min_p: f64, max_p: f64, laser: &str) {
    let min_enc = encode_power(min_p);
    let max_enc = encode_power(max_p);
    let zero_enc = encode_power(0.0);
    match laser {
        "2" => {
            out.extend([0xC6, 0x31, idx]);
            out.extend(zero_enc);
            out.extend([0xC6, 0x32, idx]);
            out.extend(zero_enc);
            out.extend([0xC6, 0x41, idx]);
            out.extend(min_enc);
            out.extend([0xC6, 0x42, idx]);
            out.extend(max_enc);
        }
        "both" => {
            out.extend([0xC6, 0x31, idx]);
            out.extend(min_enc);
            out.extend([0xC6, 0x32, idx]);
            out.extend(max_enc);
            out.extend([0xC6, 0x41, idx]);
            out.extend(min_enc);
            out.extend([0xC6, 0x42, idx]);
            out.extend(max_enc);
        }
        _ => {
            out.extend([0xC6, 0x31, idx]);
            out.extend(min_enc);
            out.extend([0xC6, 0x32, idx]);
            out.extend(max_enc);
        }
    }
}

fn push_cut_power(out: &mut Vec<u8>, min_14: i32, max_14: i32, laser: &str) {
    let min_enc = encode_i14(min_14);
    let max_enc = encode_i14(max_14);
    let zero_enc = encode_i14(0);
    match laser {
        "2" => {
            out.extend([0xC6, 0x01]);
            out.extend(zero_enc);
            out.extend([0xC6, 0x02]);
            out.extend(zero_enc);
            out.extend([0xC6, 0x21]);
            out.extend(min_enc);
            out.extend([0xC6, 0x22]);
            out.extend(max_enc);
        }
        "both" => {
            out.extend([0xC6, 0x01]);
            out.extend(min_enc);
            out.extend([0xC6, 0x02]);
            out.extend(max_enc);
            out.extend([0xC6, 0x21]);
            out.extend(min_enc);
            out.extend([0xC6, 0x22]);
            out.extend(max_enc);
        }
        _ => {
            out.extend([0xC6, 0x01]);
            out.extend(min_enc);
            out.extend([0xC6, 0x02]);
            out.extend(max_enc);
        }
    }
}

/// Generate unscrambled Ruida commands for a job.
pub fn write_plain(mv: &Moves, p: &RuidaParams) -> Vec<u8> {
    let n = mv.x.len();
    let mut out = Vec::with_capacity(n * 8 + 128);

    // 0. Optional controller memory upload (`0xE8 0x02`) and/or document filename (`0xE7 0x01`)
    if p.upload {
        let fname = sanitize_filename(p.filename.as_deref().unwrap_or("KIZAMU"));
        out.extend([0xE8, 0x02]);
        out.extend_from_slice(fname.as_bytes());
        out.push(0x00);
        out.extend([0xE7, 0x01]);
        out.extend_from_slice(fname.as_bytes());
        out.push(0x00);
    } else if let Some(raw_name) = p.filename.as_deref().filter(|s| !s.trim().is_empty()) {
        let fname = sanitize_filename(raw_name);
        out.extend([0xE7, 0x01]);
        out.extend_from_slice(fname.as_bytes());
        out.push(0x00);
    }

    // 1. Reference point mode
    let ref_code = match p.start_from.as_str() {
        "user" => 0x11,
        "current" => 0x12,
        _ => 0x10,
    };
    out.extend([0xD8, ref_code]);

    let start_um = map_point(p, p.x0, p.y0);
    let pts: Vec<[i64; 2]> = (0..n).map(|i| map_point(p, mv.x[i], mv.y[i])).collect();

    // 2. Bounding box of feed/cut moves (excluding return-home rapid, fallback to all moves)
    if !pts.is_empty() {
        let mut min_x = i64::MAX;
        let mut min_y = i64::MAX;
        let mut max_x = i64::MIN;
        let mut max_y = i64::MIN;
        let has_feed = mv.f.iter().any(|&f| f > 0.0);
        let mut prev = start_um;
        for (i, &[rx, ry]) in pts.iter().enumerate() {
            if !has_feed || mv.f[i] > 0.0 {
                if has_feed {
                    min_x = min_x.min(prev[0]);
                    min_y = min_y.min(prev[1]);
                    max_x = max_x.max(prev[0]);
                    max_y = max_y.max(prev[1]);
                }
                min_x = min_x.min(rx);
                min_y = min_y.min(ry);
                max_x = max_x.max(rx);
                max_y = max_y.max(ry);
            }
            prev = [rx, ry];
        }
        out.extend([0xE7, 0x03]);
        out.extend(encode_i35(min_x));
        out.extend(encode_i35(min_y));
        out.extend([0xE7, 0x07]);
        out.extend(encode_i35(max_x));
        out.extend(encode_i35(max_y));
    }

    // 3. Layer table. With scan parts every part also gets its work mode (`CA 41 <part> <mode>`,
    // LibLaserCut `Ruida.java`: 00 cut, 01 one-way x-sweep, 02 both-ways x-sweep); jobs without images stay unchanged.
    let has_scan = !p.scan.is_empty();
    let mut part_mode: HashMap<u8, u8> = HashMap::new();
    let mut layer_min: HashMap<i16, f64> = HashMap::new();
    for l in &p.layers {
        let idx = (l.index.max(0) & 0x1F) as u8;
        let spd = (js_round(l.speed / 60.0 * 1000.0) as i64).max(1);
        let max_p = l.power.clamp(0.0, 100.0);
        let min_p = if l.min_power > 0.0 {
            l.min_power.clamp(0.0, max_p)
        } else {
            max_p
        };
        layer_min.insert(l.index, min_p);
        out.extend([0xC9, 0x04, idx]);
        out.extend(encode_i35(spd));
        push_layer_power(&mut out, idx, min_p, max_p, &p.laser);
        out.extend([0xCA, 0x06, idx]);
        out.extend(encode_u35(l.color & 0x00FF_FFFF));
        let mode = if l.scan <= 2 { l.scan } else { 0 };
        part_mode.insert(idx, mode);
        if has_scan {
            out.extend([0xCA, 0x41, idx, mode]);
        }
    }

    // 4. Moves & cuts
    let mut cur_pos: Option<[i64; 2]> = None;
    let mut cur_layer: i16 = i16::MIN;
    let mut cur_part: i32 = i32::MIN;
    let mut cur_speed: i64 = -1;
    let mut cur_power: i32 = -1;
    let mut air_on = false;
    let mut scan_k = 0usize;
    let mut z_k = 0usize;
    let mut cur_z: i64 = 0;

    for i in 0..n {
        // Z offset of the layer/pass before its first move (`80 08`, relative to the start height)
        while z_k < p.z.len() && p.z[z_k].0 as usize <= i {
            let zt = um(p.z[z_k].1);
            if zt != cur_z {
                out.extend(z_move_cmd(zt - cur_z));
                cur_z = zt;
            }
            z_k += 1;
        }
        while scan_k < p.scan.len() && i >= p.scan[scan_k][1] as usize {
            scan_k += 1;
        }
        let scan_part = (scan_k < p.scan.len() && i >= p.scan[scan_k][0] as usize).then(|| p.scan[scan_k][2]);
        let [rx, ry] = pts[i];
        if cur_pos == Some([rx, ry]) {
            continue;
        }
        let cut = mv.f[i] > 0.0 && mv.s[i] > 0.0;
        if cut {
            if cur_pos.is_none() {
                out.push(0x88);
                out.extend(encode_i35(start_um[0]));
                out.extend(encode_i35(start_um[1]));
                cur_pos = Some(start_um);
            }
            let part = scan_part.map_or(mv.layer[i] as i32, |sp| sp as i32);
            if part != cur_part {
                cur_part = part;
                cur_layer = mv.layer[i];
                let idx = (part.max(0) & 0x1F) as u8;
                if has_scan {
                    // Current work mode before the layer number (LibLaserCut: `ca01` 00 cut, 01 both ways, 02 one way)
                    let m = match part_mode.get(&idx).copied().unwrap_or(0) {
                        2 => 0x01,
                        1 => 0x02,
                        _ => 0x00,
                    };
                    out.extend([0xCA, 0x01, m]);
                }
                out.extend([0xCA, 0x02, idx]);
                let want_air = p.air.contains(&cur_layer);
                if want_air != air_on {
                    air_on = want_air;
                    out.extend([0xCA, 0x01, if air_on { 0x13 } else { 0x12 }]);
                }
                cur_speed = -1;
                cur_power = -1;
            }
            let spd = (js_round(mv.f[i] as f64 / 60.0 * 1000.0) as i64).max(1);
            if spd != cur_speed {
                cur_speed = spd;
                out.extend([0xC9, 0x02]);
                out.extend(encode_i35(spd));
            }
            let pw_pct = (mv.s[i] as f64 * 100.0).clamp(0.0, 100.0);
            let pw_14 = js_round(pw_pct * 16383.0 / 100.0) as i32;
            if pw_14 != cur_power {
                // Scan runs keep one power for the whole run (min = max, as MeerK40t and LibLaserCut write rasters)
                let min_pct = if cur_power == -1 && scan_part.is_none() {
                    layer_min
                        .get(&cur_layer)
                        .copied()
                        .filter(|&m| m > 0.0)
                        .map(|m| m.min(pw_pct))
                        .unwrap_or(pw_pct)
                } else {
                    pw_pct
                };
                let min_14 = js_round(min_pct.clamp(0.0, 100.0) * 16383.0 / 100.0) as i32;
                push_cut_power(&mut out, min_14, pw_14, &p.laser);
                cur_power = pw_14;
            }
        }

        if let Some([px, py]) = cur_pos {
            let (dx, dy) = (rx - px, ry - py);
            if dx == 0 && dy == 0 {
                continue;
            }
            let sx = (-8192..=8191).contains(&dx);
            let sy = (-8192..=8191).contains(&dy);
            if dy == 0 && sx {
                out.push(if cut { 0xAA } else { 0x8A });
                out.extend(encode_i14(dx as i32));
            } else if dx == 0 && sy {
                out.push(if cut { 0xAB } else { 0x8B });
                out.extend(encode_i14(dy as i32));
            } else if sx && sy {
                out.push(if cut { 0xA9 } else { 0x89 });
                out.extend(encode_i14(dx as i32));
                out.extend(encode_i14(dy as i32));
            } else {
                out.push(if cut { 0xA8 } else { 0x88 });
                out.extend(encode_i35(rx));
                out.extend(encode_i35(ry));
            }
        } else {
            out.push(0x88);
            out.extend(encode_i35(rx));
            out.extend(encode_i35(ry));
        }
        cur_pos = Some([rx, ry]);
    }

    if air_on {
        out.extend([0xCA, 0x01, 0x12]);
    }
    // Z back to the start height before the end of the job (like the G-code `zInserts` end)
    if cur_z != 0 {
        out.extend(z_move_cmd(-cur_z));
    }
    if p.return_home && cur_pos.is_some_and(|c| c != start_um) {
        out.push(0x88);
        out.extend(encode_i35(start_um[0]));
        out.extend(encode_i35(start_um[1]));
    }
    out.push(0xD7);
    out
}

/// Generate scrambled `.rd` file bytes for a job.
pub fn write(mv: &Moves, p: &RuidaParams) -> Vec<u8> {
    let magic = if p.magic == 0 { DEFAULT_MAGIC } else { p.magic };
    swizzle(&write_plain(mv, p), magic)
}

/// Unpack the binary `packMoves` buffer from the frontend and generate scrambled `.rd` bytes.
pub fn write_packed(body: &[u8]) -> Result<Vec<u8>, String> {
    let bad = || "Ungültige Ruida-Daten".to_string();
    let u32_at = |i: usize| {
        body.get(i..i + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize)
            .ok_or_else(bad)
    };
    let n = u32_at(0)?;
    let jl = u32_at(4)?;
    let p: RuidaParams =
        serde_json::from_slice(body.get(8..8 + jl).ok_or_else(bad)?).map_err(|e| e.to_string())?;
    let mut off = (8 + jl).div_ceil(8) * 8;
    let mut take = |bytes: usize| -> Result<&[u8], String> {
        let s = body.get(off..off + bytes).ok_or_else(bad)?;
        off += bytes;
        Ok(s)
    };
    let f64s = |b: &[u8]| {
        b.chunks_exact(8)
            .map(|c| f64::from_le_bytes(c.try_into().unwrap()))
            .collect::<Vec<_>>()
    };
    let f32s = |b: &[u8]| {
        b.chunks_exact(4)
            .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
            .collect::<Vec<_>>()
    };
    let x = f64s(take(8 * n)?);
    let y = f64s(take(8 * n)?);
    let t = f64s(take(8 * n)?);
    let f = f32s(take(4 * n)?);
    let s = f32s(take(4 * n)?);
    let layer: Vec<i16> = take(2 * n)?
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    Ok(write(
        &Moves {
            x0: p.x0,
            y0: p.y0,
            x: &x,
            y: &y,
            s: &s,
            f: &f,
            layer: &layer,
            t: &t,
        },
        &p,
    ))
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedLayer {
    pub index: u8,
    /// Speed in mm/min
    pub speed: f64,
    /// Max power in %
    pub power: f64,
    /// Min power in %
    pub min_power: f64,
    pub air: bool,
    pub color: Option<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedCut {
    pub from: [f64; 2],
    pub to: [f64; 2],
    pub layer: u8,
    /// Speed in mm/min
    pub speed: f64,
    /// Power in %
    pub power: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct DecodedJob {
    pub magic: u8,
    pub start_from: &'static str,
    pub bounds: Option<[f64; 4]>,
    pub layers: HashMap<u8, DecodedLayer>,
    pub cuts: Vec<DecodedCut>,
    pub rapids: usize,
    pub eof: bool,
    pub filename: Option<String>,
    pub upload: bool,
}

/// Decode a scrambled `.rd` buffer into layer settings and cutting segments (in Ruida coordinates, mm).
pub fn decode_rd(raw: &[u8], magic_hint: Option<u8>) -> DecodedJob {
    let magic = magic_hint.unwrap_or_else(|| magic_for_file(raw));
    let plain = unswizzle(raw, magic);
    let mut start_from = "absolute";
    let mut min_bound: Option<[f64; 2]> = None;
    let mut max_bound: Option<[f64; 2]> = None;
    let mut layers: HashMap<u8, DecodedLayer> = HashMap::new();
    let mut cuts = Vec::new();
    let mut rapids = 0usize;
    let mut eof = false;
    let mut filename: Option<String> = None;
    let mut upload = false;

    let mut pos = [0.0f64, 0.0f64];
    let mut cur_layer = 0u8;
    let mut cur_speed_mm_min = 1200.0f64;
    let mut cur_power_pct = 50.0f64;

    fn ensure_layer(layers: &mut HashMap<u8, DecodedLayer>, idx: u8) -> &mut DecodedLayer {
        layers.entry(idx).or_insert(DecodedLayer {
            index: idx,
            speed: 1200.0,
            power: 50.0,
            min_power: 0.0,
            air: false,
            color: None,
        })
    }

    for c in split_commands(&plain) {
        if c.is_empty() {
            continue;
        }
        let a = |i: usize| c.get(i).copied().unwrap_or(0);
        let d = |i: usize| c.get(i..).unwrap_or(&[]);
        match a(0) {
            0x88 | 0xA8 => {
                if let (Some(x), Some(y)) = (mm(d(1)), mm(d(6))) {
                    let to = [x, y];
                    if a(0) == 0xA8 {
                        cuts.push(DecodedCut {
                            from: pos,
                            to,
                            layer: cur_layer,
                            speed: cur_speed_mm_min,
                            power: cur_power_pct,
                        });
                    } else {
                        rapids += 1;
                    }
                    pos = to;
                }
            }
            0x89 | 0xA9 => {
                if let (Some(dx), Some(dy)) = (mm_short(d(1)), mm_short(d(3))) {
                    let to = [pos[0] + dx, pos[1] + dy];
                    if a(0) == 0xA9 {
                        cuts.push(DecodedCut {
                            from: pos,
                            to,
                            layer: cur_layer,
                            speed: cur_speed_mm_min,
                            power: cur_power_pct,
                        });
                    } else {
                        rapids += 1;
                    }
                    pos = to;
                }
            }
            0x8A | 0xAA => {
                if let Some(dx) = mm_short(d(1)) {
                    let to = [pos[0] + dx, pos[1]];
                    if a(0) == 0xAA {
                        cuts.push(DecodedCut {
                            from: pos,
                            to,
                            layer: cur_layer,
                            speed: cur_speed_mm_min,
                            power: cur_power_pct,
                        });
                    } else {
                        rapids += 1;
                    }
                    pos = to;
                }
            }
            0x8B | 0xAB => {
                if let Some(dy) = mm_short(d(1)) {
                    let to = [pos[0], pos[1] + dy];
                    if a(0) == 0xAB {
                        cuts.push(DecodedCut {
                            from: pos,
                            to,
                            layer: cur_layer,
                            speed: cur_speed_mm_min,
                            power: cur_power_pct,
                        });
                    } else {
                        rapids += 1;
                    }
                    pos = to;
                }
            }
            0x80 => {
                if let Some(v) = mm(d(2)) {
                    match a(1) {
                        0x00 => {
                            pos = [v, pos[1]];
                            rapids += 1;
                        }
                        0x01 => {
                            pos = [pos[0], v];
                            rapids += 1;
                        }
                        _ => {}
                    }
                }
            }
            0xC7 => {
                if let Some(p) = power(d(1)) {
                    cur_power_pct = p;
                }
            }
            0xC6 => match a(1) {
                0x01 | 0x21 => {
                    if let Some(p) = power(d(2)) {
                        ensure_layer(&mut layers, cur_layer).min_power = p;
                    }
                }
                0x02 | 0x22 => {
                    if let Some(p) = power(d(2)) {
                        cur_power_pct = p;
                        let l = ensure_layer(&mut layers, cur_layer);
                        if l.power == 0.0 {
                            l.power = p;
                        }
                    }
                }
                0x31 | 0x41 => {
                    if let Some(p) = power(d(3)) {
                        if p > 0.0 {
                            ensure_layer(&mut layers, a(2)).min_power = p;
                        }
                    }
                }
                0x32 | 0x42 => {
                    if let Some(p) = power(d(3)) {
                        if p > 0.0 {
                            ensure_layer(&mut layers, a(2)).power = p;
                        }
                    }
                }
                _ => {}
            },
            0xC9 => match a(1) {
                0x02 => {
                    if let Some(s) = speed(d(2)) {
                        cur_speed_mm_min = s * 60.0;
                    }
                }
                0x04 => {
                    if let Some(s) = speed(d(3)) {
                        ensure_layer(&mut layers, a(2)).speed = s * 60.0;
                    }
                }
                _ => {}
            },
            0xCA => match a(1) {
                0x01 => match a(2) {
                    0x13 => ensure_layer(&mut layers, cur_layer).air = true,
                    _ => {}
                },
                0x02 => {
                    cur_layer = a(2);
                    let l = ensure_layer(&mut layers, cur_layer);
                    cur_speed_mm_min = l.speed;
                    cur_power_pct = l.power;
                }
                0x06 => {
                    if let Some(col) = u35(d(3)) {
                        ensure_layer(&mut layers, a(2)).color = Some(col as u32 & 0x00FF_FFFF);
                    }
                }
                _ => {}
            },
            0xE7 => match a(1) {
                0x01 => {
                    let bytes = d(2);
                    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                    let s = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
                    if !s.is_empty() {
                        filename = Some(s);
                    }
                }
                0x03 => {
                    if let (Some(x), Some(y)) = (mm(d(2)), mm(d(7))) {
                        min_bound = Some([x, y]);
                    }
                }
                0x07 => {
                    if let (Some(x), Some(y)) = (mm(d(2)), mm(d(7))) {
                        max_bound = Some([x, y]);
                    }
                }
                _ => {}
            },
            0xE8 if a(1) == 0x02 => {
                upload = true;
                let bytes = d(2);
                let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
                let s = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
                if !s.is_empty() {
                    filename = Some(s);
                }
            }
            0xD8 => match a(1) {
                0x10 => start_from = "absolute",
                0x11 => start_from = "user",
                0x12 => start_from = "current",
                _ => {}
            },
            0xD7 => eof = true,
            _ => {}
        }
    }

    let bounds = match (min_bound, max_bound) {
        (Some([x0, y0]), Some([x1, y1])) => Some([x0, y0, x1, y1]),
        _ => None,
    };

    DecodedJob {
        magic,
        start_from,
        bounds,
        layers,
        cuts,
        rapids,
        eof,
        filename,
        upload,
    }
}

/// Validates that a Ruida UDP target IP is unicast (rejects unspecified, broadcast, `.255`, multicast).
pub fn validate_target_ip(ip: std::net::IpAddr) -> Result<(), String> {
    if ip.is_unspecified() {
        return Err("Ungültige Ruida-Zieladresse (0.0.0.0)".into());
    }
    if ip.is_multicast() {
        return Err("Multicast-Adressen sind für Ruida nicht erlaubt".into());
    }
    if let std::net::IpAddr::V4(v4) = ip {
        if v4.is_broadcast() || v4.octets()[3] == 255 {
            return Err("Broadcast-Adressen (.255) sind aus Sicherheitsgründen für Ruida gesperrt".into());
        }
    }
    Ok(())
}

/// Splits unscrambled Ruida commands at command boundaries (`>= 0x80`) into chunks of at most `max_payload` bytes.
pub fn split_plain_chunks(plain: &[u8], max_payload: usize) -> Vec<Vec<u8>> {
    let limit = max_payload.max(32);
    let mut chunks = Vec::new();
    let mut cur = Vec::with_capacity(limit);
    for cmd in split_commands(plain) {
        if !cur.is_empty() && cur.len() + cmd.len() > limit {
            chunks.push(cur);
            cur = Vec::with_capacity(limit);
        }
        cur.extend_from_slice(cmd);
    }
    if !cur.is_empty() {
        chunks.push(cur);
    }
    chunks
}

/// Parses `$J=G91 G21 X... Y... F...`, `$J=G90 G21 X... Y... F...` or `G0 X... Y...` into `(relative, x, y)`.
pub fn parse_jog_or_move(line: &str) -> Option<(bool, Option<f64>, Option<f64>)> {
    let body = line.strip_prefix("$J=").unwrap_or(line);
    if !line.starts_with("$J=") && !line.starts_with("G0 ") && !line.starts_with("G1 ") {
        return None;
    }
    let mut rel = false;
    let mut x = None;
    let mut y = None;
    for tok in body.split_whitespace() {
        if tok == "G91" {
            rel = true;
        } else if tok == "G90" {
            rel = false;
        } else if let Some(v) = tok.strip_prefix('X').and_then(|s| s.parse::<f64>().ok()) {
            x = Some(v);
        } else if let Some(v) = tok.strip_prefix('Y').and_then(|s| s.parse::<f64>().ok()) {
            y = Some(v);
        }
    }
    if x.is_none() && y.is_none() {
        return None;
    }
    Some((rel, x, y))
}

/// Translates simple G0/G1 lines (such as `frameGCode`) into unscrambled Ruida commands.
pub fn lines_to_ruida(
    lines: &[String],
    origin: &str,
    bed_w: f64,
    bed_h: f64,
    mpos: [f64; 3],
    wco: [f64; 3],
) -> Vec<u8> {
    let mut out = vec![0xD8, 0x10];
    let mut cx = mpos[0] - wco[0];
    let mut cy = mpos[1] - wco[1];
    let mut cf = 1500.0f64;
    let mut cs = 0.0f64;
    for raw in lines {
        let l = raw.trim();
        if l.is_empty() || l.starts_with(';') {
            continue;
        }
        let mut is_move = false;
        let mut cut = false;
        for tok in l.split_whitespace() {
            if tok == "G0" {
                is_move = true;
                cut = false;
            } else if tok == "G1" {
                is_move = true;
                cut = true;
            } else if let Some(v) = tok.strip_prefix('X').and_then(|s| s.parse::<f64>().ok()) {
                cx = v;
                is_move = true;
            } else if let Some(v) = tok.strip_prefix('Y').and_then(|s| s.parse::<f64>().ok()) {
                cy = v;
                is_move = true;
            } else if let Some(v) = tok.strip_prefix('F').and_then(|s| s.parse::<f64>().ok()) {
                cf = v;
            } else if let Some(v) = tok.strip_prefix('S').and_then(|s| s.parse::<f64>().ok()) {
                cs = v;
            }
        }
        if is_move {
            let [rx, ry] = to_ruida_abs(origin, bed_w, bed_h, cx + wco[0], cy + wco[1]);
            let spd = ((cf / 60.0) * 1000.0).round().max(1.0) as i64;
            out.extend([0xC9, 0x02]);
            out.extend(encode_i35(spd));
            if cut && cs > 0.0 {
                let pw = encode_power(cs.clamp(0.0, 100.0));
                out.extend([0xC6, 0x01]);
                out.extend(pw);
                out.extend([0xC6, 0x02]);
                out.extend(pw);
                out.push(0xA8);
            } else {
                out.push(0x88);
            }
            out.extend(encode_i35((rx * 1000.0).round() as i64));
            out.extend(encode_i35((ry * 1000.0).round() as i64));
        }
    }
    out.push(0xD7);
    out
}

/// UDP transport client for Ruida controllers (data port 50200 + optional keypad port 50207).
pub struct UdpClient {
    sock: std::net::UdpSocket,
    target: std::net::SocketAddr,
    jog_target: Option<std::net::SocketAddr>,
}

impl UdpClient {
    pub fn open(host: &str, port: u16, jog_port: Option<u16>) -> Result<Self, String> {
        use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
        let target_str = format!("{}:{}", host.trim(), port);
        let target: SocketAddr = target_str
            .to_socket_addrs()
            .map_err(|e| format!("{target_str}: {e}"))?
            .next()
            .ok_or_else(|| format!("Keine Adresse für {target_str}"))?;
        validate_target_ip(target.ip())?;
        let bind_addr = if target.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" };
        let sock = UdpSocket::bind(bind_addr).map_err(|e| format!("UDP-Socket: {e}"))?;
        let jog_target = jog_port.filter(|&p| p > 0).map(|p| SocketAddr::new(target.ip(), p));
        Ok(Self {
            sock,
            target,
            jog_target,
        })
    }

    pub fn send_cmd(
        &mut self,
        plain: &[u8],
        magic: u8,
        timeout: std::time::Duration,
    ) -> Result<Vec<u8>, String> {
        let pkt = packet(plain, magic);
        let mut buf = [0u8; 512];
        for attempt in 0..3 {
            self.sock
                .send_to(&pkt, self.target)
                .map_err(|e| format!("UDP-Senden fehlgeschlagen: {e}"))?;
            let _ = self.sock.set_read_timeout(Some(timeout));
            let deadline = std::time::Instant::now() + timeout;
            let mut got_ack = false;
            while std::time::Instant::now() < deadline {
                match self.sock.recv_from(&mut buf) {
                    Ok((n, _from)) if n > 0 => {
                        let raw = &buf[..n];
                        if n == 1 {
                            let b = unswizzle_byte(raw[0], magic);
                            if b == ACK || raw[0] == ACK {
                                return Ok(vec![ACK]);
                            }
                            if b == NAK || b == 0xEF || raw[0] == NAK {
                                break;
                            }
                            return Ok(vec![b]);
                        }
                        let payload = checked_payload(raw).unwrap_or(raw);
                        let un = unswizzle(payload, magic);
                        if un.len() == 1 && un[0] == ACK {
                            got_ack = true;
                            continue;
                        }
                        return Ok(un);
                    }
                    Ok(_) => {}
                    Err(e)
                        if e.kind() == std::io::ErrorKind::WouldBlock
                            || e.kind() == std::io::ErrorKind::TimedOut =>
                    {
                        if got_ack {
                            return Ok(vec![ACK]);
                        }
                        break;
                    }
                    Err(e) => return Err(format!("UDP-Empfang: {e}")),
                }
            }
            if got_ack {
                return Ok(vec![ACK]);
            }
            if attempt == 2 {
                return Err(format!("Keine Antwort von Ruida-Steuerung ({})", self.target));
            }
        }
        Err(format!("Ruida-Übertragung abgelehnt ({})", self.target))
    }

    pub fn query_mem(
        &mut self,
        addr: u32,
        magic: u8,
        timeout: std::time::Duration,
    ) -> Result<Vec<u8>, String> {
        let cmd = mem_read_cmd(addr);
        let pkt = packet(&cmd, magic);
        self.sock
            .send_to(&pkt, self.target)
            .map_err(|e| format!("UDP-Senden fehlgeschlagen: {e}"))?;
        let _ = self.sock.set_read_timeout(Some(timeout));
        let deadline = std::time::Instant::now() + timeout;
        let mut buf = [0u8; 512];
        while std::time::Instant::now() < deadline {
            match self.sock.recv_from(&mut buf) {
                Ok((n, _)) if n > 0 => {
                    let raw = &buf[..n];
                    if n == 1 {
                        let b = unswizzle_byte(raw[0], magic);
                        if b == ACK || raw[0] == ACK {
                            continue;
                        }
                    }
                    let payload = checked_payload(raw).unwrap_or(raw);
                    let un = unswizzle(payload, magic);
                    if un.len() == 1 && un[0] == ACK {
                        continue;
                    }
                    if let Some((got_addr, data)) = parse_mem_reply(&un) {
                        if got_addr == addr && data.len() >= 5 {
                            return Ok(data[..5].to_vec());
                        }
                    }
                }
                Ok(_) => {}
                Err(e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut =>
                {
                    break;
                }
                Err(e) => return Err(format!("UDP-Empfang: {e}")),
            }
        }
        Err("Keine Antwort auf Speicherabfrage".into())
    }

    pub fn send_key(&mut self, plain: &[u8], magic: u8) -> Result<(), String> {
        let target = self.jog_target.unwrap_or(self.target);
        let pkt = packet(plain, magic);
        self.sock
            .send_to(&pkt, target)
            .map_err(|e| format!("UDP-Taste senden fehlgeschlagen: {e}"))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_job_encoding_and_decoding() {
        let x = [10.0, 30.0, 30.0, 10.0, 10.0];
        let y = [20.0, 20.0, 25.0, 25.0, 20.0];
        let f = [0.0f32, 1200.0, 1200.0, 1200.0, 1200.0];
        let s = [0.0f32, 0.75, 0.75, 0.75, 0.75];
        let layer = [-1i16, 1, 1, 1, 1];
        let t = [0.1, 1.1, 1.35, 2.35, 2.6];
        let mv = Moves {
            x0: 0.0,
            y0: 0.0,
            x: &x,
            y: &y,
            s: &s,
            f: &f,
            layer: &layer,
            t: &t,
        };
        let params = RuidaParams {
            x0: 0.0,
            y0: 0.0,
            bed_w: 400.0,
            bed_h: 300.0,
            origin: "top-right".into(),
            start_from: "absolute".into(),
            magic: 0x88,
            laser: "1".into(),
            return_home: true,
            air: vec![1],
            layers: vec![RuidaLayer {
                index: 1,
                speed: 1200.0,
                power: 75.0,
                min_power: 20.0,
                color: 0xFF0000,
                scan: 0,
            }],
            filename: None,
            upload: false,
            scan: vec![],
            z: vec![],
        };

        let rd = write(&mv, &params);
        assert_eq!(magic_for_file(&rd), 0x88);
        let dec = decode_rd(&rd, None);
        assert!(dec.eof);
        assert!(!dec.upload);
        assert_eq!(dec.filename, None);
        assert_eq!(dec.start_from, "absolute");
        assert_eq!(dec.bounds, Some([370.0, 275.0, 390.0, 280.0]));
        assert_eq!(dec.cuts.len(), 4);
        let l1 = &dec.layers[&1];
        assert!((l1.speed - 1200.0).abs() < 0.1);
        assert!((l1.power - 75.0).abs() < 0.1);
        assert!((l1.min_power - 20.0).abs() < 0.1);
        assert!(l1.air);

        // Convert decoded cuts back to KizamuBeam bed coordinates
        let p0 = from_ruida_abs("top-right", 400.0, 300.0, dec.cuts[0].from[0], dec.cuts[0].from[1]);
        let p1 = from_ruida_abs("top-right", 400.0, 300.0, dec.cuts[0].to[0], dec.cuts[0].to[1]);
        let p2 = from_ruida_abs("top-right", 400.0, 300.0, dec.cuts[1].to[0], dec.cuts[1].to[1]);
        assert!((p0[0] - 10.0).abs() < 1e-3 && (p0[1] - 20.0).abs() < 1e-3);
        assert!((p1[0] - 30.0).abs() < 1e-3 && (p1[1] - 20.0).abs() < 1e-3);
        assert!((p2[0] - 30.0).abs() < 1e-3 && (p2[1] - 25.0).abs() < 1e-3);

        // Upload mode (`0xE8 0x02` + `0xE7 0x01`) with filename sanitization
        assert_eq!(sanitize_filename("Gehäuse-Test 123.kzb"), "GEHAUSE");
        let mut up_params = params.clone();
        up_params.filename = Some("TestJob.kzb".into());
        up_params.upload = true;
        let up_plain = write_plain(&mv, &up_params);
        assert_eq!(upload_filename(&up_plain), Some("TESTJOB".to_string()));
        let up_rd = swizzle(&up_plain, 0x88);
        let up_dec = decode_rd(&up_rd, None);
        assert!(up_dec.upload);
        assert_eq!(up_dec.filename.as_deref(), Some("TESTJOB"));
        assert_eq!(up_dec.cuts.len(), 4);
    }

    /// One raster line in the controller's scan mode with a Z offset. The expected bytes were built with
    /// MeerK40t's own opcode constants and encoders (`meerk40t/ruida/rdjob.py`: encode32, encode14,
    /// encode_power, encode_speed), the work-mode bytes from LibLaserCut `Ruida.java` (`ca01` 01 and
    /// `ca41 <part> 02` for a both-ways x-sweep) and the Z opcode from the EduTech wiki (`80 08`).
    #[test]
    fn scan_layer_with_z_matches_reference_bytes() {
        // emitScanlines for one line at y = 10, runs [10, 11] at 70 % and [11, 12] at 40 %, 1 mm overscan
        let x = [9.0, 10.0, 11.0, 12.0, 13.0];
        let y = [10.0; 5];
        let f = [0.0f32, 6000.0, 6000.0, 6000.0, 6000.0];
        let s = [0.0f32, 0.0, 0.7, 0.4, 0.0];
        let layer = [0i16; 5];
        let t = [0.0; 5];
        let mv = Moves { x0: 0.0, y0: 0.0, x: &x, y: &y, s: &s, f: &f, layer: &layer, t: &t };
        let params = RuidaParams {
            x0: 0.0,
            y0: 0.0,
            bed_w: 600.0,
            bed_h: 400.0,
            origin: "bottom-left".into(),
            start_from: "absolute".into(),
            magic: 0x88,
            laser: "1".into(),
            return_home: false,
            air: vec![],
            layers: vec![RuidaLayer { index: 0, speed: 6000.0, power: 70.0, min_power: 10.0, color: 0, scan: 2 }],
            filename: None,
            upload: false,
            scan: vec![[0, 5, 0]],
            z: vec![(0, -1.5)],
        };
        #[rustfmt::skip]
        let want: Vec<u8> = vec![
            0xD8, 0x10,                                                  // REF_POINT_2 (absolute)
            0xE7, 0x03, 0, 0, 0, 0x46, 0x28, 0, 0, 0, 0x4E, 0x10,        // PROCESS_TOP_LEFT 9000 µm, 10000 µm
            0xE7, 0x07, 0, 0, 0, 0x65, 0x48, 0, 0, 0, 0x4E, 0x10,        // PROCESS_BOTTOM_RIGHT 13000 µm, 10000 µm
            0xC9, 0x04, 0x00, 0, 0, 0x06, 0x0D, 0x20,                    // SPEED_LASER_1_PART 0, 100 mm/s
            0xC6, 0x31, 0x00, 0x0C, 0x66,                                // MIN_POWER_1_PART 0, 10 %
            0xC6, 0x32, 0x00, 0x59, 0x4C,                                // MAX_POWER_1_PART 0, 70 %
            0xCA, 0x06, 0x00, 0, 0, 0, 0, 0,                             // LAYER_COLOR_PART 0
            0xCA, 0x41, 0x00, 0x02,                                      // WORK_MODE_PART 0: scan both ways
            0x80, 0x08, 0x0F, 0x7F, 0x7F, 0x74, 0x24,                    // Axis Z Move -1500 µm
            0x88, 0, 0, 0, 0x46, 0x28, 0, 0, 0, 0x4E, 0x10,              // MOVE_ABS_XY to the overscan start
            0x8A, 0x07, 0x68,                                            // MOVE_REL_X +1000 µm (overscan)
            0xCA, 0x01, 0x01,                                            // work mode: scan both ways
            0xCA, 0x02, 0x00,                                            // LAYER_NUMBER_PART 0
            0xC9, 0x02, 0, 0, 0x06, 0x0D, 0x20,                          // SPEED_LASER_1 100 mm/s
            0xC6, 0x01, 0x59, 0x4C, 0xC6, 0x02, 0x59, 0x4C,              // MIN/MAX_POWER_1 70 % (one power per run)
            0xAA, 0x07, 0x68,                                            // CUT_REL_X +1000 µm
            0xC6, 0x01, 0x33, 0x19, 0xC6, 0x02, 0x33, 0x19,              // MIN/MAX_POWER_1 40 %
            0xAA, 0x07, 0x68,                                            // CUT_REL_X +1000 µm
            0x8A, 0x07, 0x68,                                            // MOVE_REL_X +1000 µm (overscan)
            0x80, 0x08, 0, 0, 0, 0x0B, 0x5C,                             // Axis Z Move +1500 µm (back)
            0xD7,                                                        // END_OF_FILE
        ];
        assert_eq!(hex(&write_plain(&mv, &params)), hex(&want));

        // Without scan ranges and Z the job is written exactly as before (no CA 41 / CA 01 / 80 08)
        let mut plain = params.clone();
        plain.scan.clear();
        plain.z.clear();
        let old = write_plain(&mv, &plain);
        assert!(!old.windows(2).any(|w| w == [0xCA, 0x41] || w == [0x80, 0x08]));
        assert!(!old.windows(3).any(|w| w == [0xCA, 0x01, 0x01]));
    }

    #[test]
    fn file_memory_z_jog_and_param_commands() {
        assert_eq!(file_name_cmd(3), [0xE8, 0x01, 0x00, 0x03]);
        assert_eq!(file_name_cmd(130), [0xE8, 0x01, 0x00, 99]);
        let reply = [0xE8, 0x01, 0x00, 0x03, b'B', b'O', b'X', b'1', 0x00];
        assert!(file_name_reply_done(&reply));
        assert!(!file_name_reply_done(&reply[..6]));
        assert_eq!(parse_file_name_reply(&reply, 3).as_deref(), Some("BOX1"));
        assert_eq!(parse_file_name_reply(&reply, 4), None);
        assert_eq!(delete_file_cmd(2), [0xE8, 0x00, 0x00, 0x02, 0x00, 0x02]);
        assert_eq!(delete_file_cmd(0), [0xE8, 0x00, 0x00, 0x01, 0x00, 0x01], "0 would delete all");
        assert_eq!(z_jog_cmd(0.5), [0xD9, 0x02, 0x02, 0, 0, 0, 0x03, 0x74]);
        assert_eq!(z_jog_cmd(-0.1)[..3], [0xD9, 0x02, 0x02]);
        assert_eq!(i35(&z_jog_cmd(-0.1)[3..]), Some(-100));
        assert_eq!(parse_z_jog("$J=G91 G21 Z-0.5 F60"), Some(-0.5));
        assert_eq!(parse_z_jog("$J=G91 G21 X10 F3000"), None);
        assert_eq!(parse_z_jog("$J=G90 G21 Z5 F60"), None, "absolute Z is not a jog step");
        assert_eq!(parse_z_jog("G0 Z1"), None);

        // Read-only parameter report from fake memory (values as the MeerK40t emulator would answer)
        let mut lines: Vec<String> = Vec::new();
        let bed = machine_params_report(|addr| {
            let v: i64 = match addr {
                mem::BED_X => 600_000,
                mem::BED_Y => 400_000,
                mem::BED_Z => 50_000,
                mem::MAX_VEL_X | mem::MAX_VEL_Y => 500_000,
                mem::MAX_ACC_X | mem::MAX_ACC_Y => 8_000_000,
                mem::G0_VELOCITY => 200_000,
                mem::CARD_ID => 0x6545_6545,
                mem::MAINBOARD => return Ok(b"RDV8.01\0".to_vec()),
                mem::MAX_VEL_Z => return Err("Keine Antwort auf USB-Speicherabfrage.".into()),
                _ => 0,
            };
            Ok(encode_i35(v).to_vec())
        }, |l| lines.push(l));
        assert_eq!(bed, [Some(600.0), Some(400.0)]);
        // The device dialog's values come first (it listens only for a moment)
        assert_eq!(lines[..6], ["$130=600.000", "$131=400.000", "$110=30000.000", "$111=30000.000", "$120=8000.000", "$121=8000.000"]);
        let all = lines.join("\n");
        for want in ["$130=600.000", "$131=400.000", "$110=30000.000", "$111=30000.000", "$120=8000.000", "$121=8000.000"] {
            assert!(lines.iter().any(|l| l == want), "{want} fehlt in\n{all}");
        }
        assert!(all.contains("[Ruida] Steuerung: RDC6445G, Karten-ID 0x65456545"), "{all}");
        assert!(all.contains("[Ruida] Mainboard-Version: RDV8.01"), "{all}");
        assert!(all.contains("Z 50.000 mm"), "{all}");
        assert!(all.contains("[Ruida] Höchstgeschwindigkeit Z nicht gelesen: Keine Antwort auf USB-Speicherabfrage."), "{all}");
        assert!(all.contains("schreibt keine Maschinenparameter"), "{all}");
    }

    #[test]
    fn packetize_splits_only_at_command_boundaries() {
        let mut plain = vec![0xD8, 0x10];
        for i in 0..150 {
            plain.push(0x88);
            plain.extend(encode_i35(i * 1000));
            plain.extend(encode_i35(i * 1000));
        }
        plain.push(0xD7);
        let pkts = packetize(&plain, 256, 0x11);
        assert!(pkts.len() > 5);
        let mut reassembled = Vec::new();
        for pkt in pkts {
            let payload = checked_payload(&pkt).expect("valid checksum");
            assert!(payload.len() <= 256);
            let un = unswizzle(payload, 0x11);
            assert!(un[0] >= 0x80, "must start with a command opcode");
            reassembled.extend(un);
        }
        assert_eq!(reassembled, plain);
    }

    #[test]
    fn udp_client_queries_memory_and_streams_chunks() {
        use std::net::UdpSocket;
        use std::time::Duration;

        assert!(validate_target_ip("0.0.0.0".parse().unwrap()).is_err());
        assert!(validate_target_ip("255.255.255.255".parse().unwrap()).is_err());
        assert!(validate_target_ip("192.168.1.255".parse().unwrap()).is_err());
        assert!(validate_target_ip("127.0.0.1".parse().unwrap()).is_ok());

        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            let mut received_cmds = Vec::new();
            for _ in 0..3 {
                let (n, peer) = server.recv_from(&mut buf).unwrap();
                let payload = checked_payload(&buf[..n]).unwrap();
                let un = unswizzle(payload, 0x88);
                // Send ACK (swizzled single byte)
                let _ = server.send_to(&[swizzle_byte(ACK, 0x88)], peer);
                if un.len() >= 4 && un[0] == 0xDA && un[1] == 0x00 {
                    let addr = u14(&un[2..4]).unwrap();
                    let val = if addr == mem::BED_X { 600_000 } else { 0x6442_0000 };
                    let mut reply = vec![0xDA, 0x01, un[2], un[3]];
                    reply.extend(encode_u35(val));
                    let _ = server.send_to(&swizzle(&reply, 0x88), peer);
                } else {
                    received_cmds.extend(un);
                }
            }
            received_cmds
        });

        let mut client = UdpClient::open("127.0.0.1", port, None).unwrap();
        let card = client.query_mem(mem::CARD_ID, 0x88, Duration::from_millis(500)).unwrap();
        assert_eq!(u35(&card), Some(0x6442_0000));
        let bed_x = client.query_mem(mem::BED_X, 0x88, Duration::from_millis(500)).unwrap();
        assert_eq!(mm(&bed_x), Some(600.0));

        let frame_plain = lines_to_ruida(
            &["G0 X10 Y20".to_string(), "G1 X30 Y20 F1500 S5".to_string()],
            "top-right",
            600.0,
            400.0,
            [0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
        );
        let ack = client.send_cmd(&frame_plain, 0x88, Duration::from_millis(500)).unwrap();
        assert_eq!(ack, vec![ACK]);

        let got = handle.join().unwrap();
        assert_eq!(got, frame_plain);
    }
}

