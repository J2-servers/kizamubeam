//! Device settings, job types (src/jcz/contract.ts) and the field transform: mm in the marking field
//! (origin at the centre, x right, y up) → galvo words 0..0xFFFF, with LightBurn-style field offset/rotation
//! and per-galvo correction (scale, bulge, skew, trapezoid, sign, galvo 1 = X or Y).
//!
//! The mm → galvo scale (`(u + field/2) · 0xFFFF / field`, truncated) is MeerK40t's (balormk/device.py
//! `View(lens_size, native_scale = lens_size / 0xFFFF)`, controller.py `int(x)`). The correction formulas are
//! KizamuBeam's own model of LightBurn's Galvo_1_*/Galvo_2_* fields (1 = no correction for scale, bulge,
//! skew and trapezoid); LightBurn's exact math is not public, so these must be checked on the machine.

use super::protocol::{galvos_per_mm, speed_units, GALVO_RANGE};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct JczGalvo {
    pub scale: f64,
    pub bulge: f64,
    pub skew: f64,
    pub trapezoid: f64,
    pub sign: f64,
}

impl Default for JczGalvo {
    fn default() -> Self {
        Self { scale: 1.0, bulge: 1.0, skew: 1.0, trapezoid: 1.0, sign: 1.0 }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct RedDot {
    pub offset_x: f64,
    pub offset_y: f64,
    pub scale_x: f64,
    pub scale_y: f64,
}

impl Default for RedDot {
    fn default() -> Self {
        Self { offset_x: 0.0, offset_y: 0.0, scale_x: 1.0, scale_y: 1.0 }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Ports {
    pub start_mark: i32,
    pub start_frame: i32,
    pub stop_mark: i32,
    pub door_protect: i32,
    pub red_light: i32,
}

impl Default for Ports {
    fn default() -> Self {
        Self { start_mark: -1, start_frame: -1, stop_mark: -1, door_protect: -1, red_light: -1 }
    }
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct JczSettings {
    pub field: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub angle: f64,
    pub galvo1: JczGalvo,
    pub galvo2: JczGalvo,
    #[serde(rename = "galvo1IsX")]
    pub galvo1_is_x: bool,
    pub laser_type: String,
    pub fiber_type: serde_json::Value,
    pub min_freq: f64,
    pub max_freq: f64,
    pub pulse_width_enabled: bool,
    pub red_dot: RedDot,
    pub ports: Ports,
    pub jump_speed: f64,
    pub laser_on_delay: f64,
    pub laser_off_delay: f64,
    pub polygon_delay: f64,
    pub end_delay: f64,
    pub min_jump_delay: f64,
    pub max_jump_delay: f64,
    pub max_jump_distance: f64,
    pub lightburn: Option<serde_json::Map<String, serde_json::Value>>,
}

impl Default for JczSettings {
    /// MeerK40t balormk defaults (device.py) where LightBurn has no value
    fn default() -> Self {
        Self {
            field: 110.0,
            offset_x: 0.0,
            offset_y: 0.0,
            angle: 0.0,
            galvo1: JczGalvo::default(),
            galvo2: JczGalvo::default(),
            galvo1_is_x: true,
            laser_type: "fiber".into(),
            fiber_type: serde_json::Value::Null,
            min_freq: 1.0,
            max_freq: 200.0,
            pulse_width_enabled: false,
            red_dot: RedDot::default(),
            ports: Ports::default(),
            jump_speed: 2000.0,
            laser_on_delay: 100.0,
            laser_off_delay: 100.0,
            polygon_delay: 100.0,
            end_delay: 300.0,
            min_jump_delay: 0.0,
            max_jump_delay: 0.0,
            max_jump_distance: 0.0,
            lightburn: None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Fiber,
    Co2,
    Uv,
}

impl JczSettings {
    pub fn source(&self) -> Source {
        match self.laser_type.to_ascii_lowercase().as_str() {
            "co2" => Source::Co2,
            "uv" => Source::Uv,
            _ => Source::Fiber,
        }
    }

    fn lb(&self, key: &str) -> Option<&serde_json::Value> {
        self.lightburn.as_ref().and_then(|m| m.get(key))
    }

    pub fn lb_f64(&self, key: &str) -> Option<f64> {
        self.lb(key).and_then(|v| v.as_f64())
    }

    pub fn lb_bool(&self, key: &str) -> Option<bool> {
        self.lb(key).and_then(|v| v.as_bool())
    }

    /// Output bit of the red guide light: the device setting, else MeerK40t's default pin 8
    pub fn light_bit(&self) -> u8 {
        if (0..16).contains(&self.ports.red_light) {
            self.ports.red_light as u8
        } else {
            8
        }
    }

    /// Delay after opening the fiber MO at the start of a job, µs: LightBurn `Laser_OpenMODelay` (read as µs),
    /// else MeerK40t's `delay_openmo` default of 8 ms
    pub fn open_mo_delay_us(&self) -> f64 {
        self.lb_f64("Laser_OpenMODelay").unwrap_or(8000.0)
    }

    /// Jump delay of the red light trace, µs: LightBurn `RedLightJumpDelay`, else MeerK40t's `redlight_delay_dark` (1)
    pub fn red_jump_delay(&self) -> i64 {
        self.lb_f64("RedLightJumpDelay").map(|v| v.round() as i64).unwrap_or(1)
    }

    pub fn validate(&self) -> Result<(), String> {
        if !(self.field.is_finite() && self.field > 0.0) {
            return Err(format!("Feldgröße {} mm ist ungültig.", self.field));
        }
        for (n, g) in [(1, &self.galvo1), (2, &self.galvo2)] {
            for (name, v) in [("Skalierung", g.scale), ("Wölbung", g.bulge), ("Schräge", g.skew), ("Trapez", g.trapezoid), ("Vorzeichen", g.sign)] {
                if !v.is_finite() || (name != "Schräge" && v == 0.0) {
                    return Err(format!("Galvo {n}: {name} {v} ist ungültig."));
                }
            }
        }
        if !(self.min_freq.is_finite() && self.min_freq > 0.0 && self.max_freq.is_finite() && self.max_freq >= self.min_freq) {
            return Err(format!("Frequenzbereich {}–{} kHz der Quelle ist ungültig.", self.min_freq, self.max_freq));
        }
        if !(self.jump_speed.is_finite() && self.jump_speed > 0.0) {
            return Err(format!("Sprunggeschwindigkeit {} mm/s ist ungültig.", self.jump_speed));
        }
        for v in [self.offset_x, self.offset_y, self.angle, self.red_dot.offset_x, self.red_dot.offset_y, self.red_dot.scale_x, self.red_dot.scale_y] {
            if !v.is_finite() {
                return Err("Feldversatz, Drehung oder Rotlicht-Korrektur ist keine Zahl.".into());
            }
        }
        Ok(())
    }

    /// Field mm (centre = 0, y up) → galvo words (galvo 1, galvo 2). `red` applies the red-dot offset/scale
    /// (used only while tracing with the guide light). Points outside 0..0xFFFF are refused, never clamped.
    pub fn to_galvo(&self, x: f64, y: f64, red: bool) -> Result<(u16, u16), String> {
        if !x.is_finite() || !y.is_finite() {
            return Err("Koordinate ist keine Zahl.".into());
        }
        let (mut px, mut py) = (x, y);
        if red {
            px = px * self.red_dot.scale_x + self.red_dot.offset_x;
            py = py * self.red_dot.scale_y + self.red_dot.offset_y;
        }
        let a = self.angle.to_radians();
        let (s, c) = a.sin_cos();
        let rx = px * c - py * s + self.offset_x;
        let ry = px * s + py * c + self.offset_y;
        let (u1, u2) = if self.galvo1_is_x { (rx, ry) } else { (ry, rx) };
        let h = self.field / 2.0;
        let g1 = correct(&self.galvo1, u1, u2, h);
        let g2 = correct(&self.galvo2, u2, u1, h);
        let k = GALVO_RANGE / self.field;
        let w1 = (g1 + h) * k;
        let w2 = (g2 + h) * k;
        let ok = |w: f64| (0.0..=GALVO_RANGE).contains(&w);
        if !ok(w1) || !ok(w2) {
            return Err(format!(
                "Punkt ({x:.2}; {y:.2}) mm liegt außerhalb des Markierfelds von {} mm (nach Versatz, Drehung und Korrektur).",
                self.field
            ));
        }
        Ok((w1.trunc() as u16, w2.trunc() as u16))
    }
}

/// Correction of one galvo: `u` is its own coordinate, `v` the other axis, `h` the half field (mm).
/// scale multiplies; bulge bends the edges with the square of the other axis (barrel/pincushion);
/// trapezoid grows linearly with the other axis; skew shears by the other axis; sign flips the galvo.
fn correct(g: &JczGalvo, u: f64, v: f64, h: f64) -> f64 {
    let nv = v / h;
    let sign = if g.sign < 0.0 { -1.0 } else { 1.0 };
    sign * (g.scale * u * (1.0 + (g.bulge - 1.0) * nv * nv) * (1.0 + (g.trapezoid - 1.0) * nv) + (g.skew - 1.0) * v)
}

/// Marking parameters of one pass (contract.ts `JczParams`)
#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JczParams {
    pub speed: f64,
    pub power: f64,
    pub frequency: f64,
    #[serde(default)]
    pub pulse_width: f64,
    #[serde(default = "one")]
    pub passes: u32,
    #[serde(default)]
    pub laser_on_delay: Option<f64>,
    #[serde(default)]
    pub laser_off_delay: Option<f64>,
    #[serde(default)]
    pub polygon_delay: Option<f64>,
}

fn one() -> u32 {
    1
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct JczGroup {
    pub params: JczParams,
    pub polylines: Vec<Vec<[f64; 2]>>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
pub struct JczJob {
    pub groups: Vec<JczGroup>,
    #[serde(default = "one")]
    pub repeat: u32,
}

/// Refuses parameters the board or the source cannot take, with the reason
pub fn check_params(p: &JczParams, s: &JczSettings) -> Result<(), String> {
    if !(p.speed.is_finite() && p.speed > 0.0) {
        return Err(format!("Geschwindigkeit {} mm/s ist ungültig.", p.speed));
    }
    if speed_units(p.speed, s.field) > 0xFFFF {
        let max = (0xFFFF as f64 * 1000.0 / galvos_per_mm(s.field)).floor();
        return Err(format!("Geschwindigkeit {} mm/s ist zu hoch für ein Feld von {} mm (höchstens {max} mm/s).", p.speed, s.field));
    }
    if !(p.power.is_finite() && (0.0..=100.0).contains(&p.power)) {
        return Err(format!("Leistung {} % liegt außerhalb von 0–100 %.", p.power));
    }
    if !(p.frequency.is_finite() && p.frequency >= s.min_freq && p.frequency <= s.max_freq) {
        return Err(format!(
            "Frequenz {} kHz liegt außerhalb des Bereichs der Quelle ({}–{} kHz).",
            p.frequency, s.min_freq, s.max_freq
        ));
    }
    if s.pulse_width_enabled && s.source() == Source::Fiber && !(p.pulse_width.is_finite() && p.pulse_width >= 1.0 && p.pulse_width <= 65535.0) {
        return Err(format!("Pulsbreite {} ns ist ungültig (1–65535 ns).", p.pulse_width));
    }
    if p.passes == 0 {
        return Err("Anzahl der Durchgänge muss mindestens 1 sein.".into());
    }
    for (name, d) in [("Laser-Ein-Verzögerung", p.laser_on_delay), ("Laser-Aus-Verzögerung", p.laser_off_delay), ("Polygon-Verzögerung", p.polygon_delay)] {
        if let Some(d) = d {
            if !d.is_finite() || d.abs() > 65535.0 {
                return Err(format!("{name} {d} µs ist ungültig (höchstens 65535 µs)."));
            }
        }
    }
    Ok(())
}

/// A job checked and converted to galvo words; nothing is sent before the whole job passed
pub struct PreparedGroup {
    pub params: JczParams,
    pub polylines: Vec<Vec<(u16, u16)>>,
}

pub fn prepare_job(job: &JczJob, s: &JczSettings) -> Result<(Vec<PreparedGroup>, usize), String> {
    if job.repeat == 0 {
        return Err("Wiederholung muss mindestens 1 sein.".into());
    }
    let mut out = Vec::new();
    let mut points = 0usize;
    for g in &job.groups {
        check_params(&g.params, s)?;
        let mut polys = Vec::new();
        for pl in &g.polylines {
            let mut v = Vec::with_capacity(pl.len());
            for p in pl {
                v.push(s.to_galvo(p[0], p[1], false)?);
            }
            if v.len() >= 2 {
                points += v.len() * g.params.passes as usize;
                polys.push(v);
            }
        }
        out.push(PreparedGroup { params: g.params.clone(), polylines: polys });
    }
    if points == 0 {
        return Err("Der Auftrag enthält keine Linien.".into());
    }
    Ok((out, points * job.repeat as usize))
}
