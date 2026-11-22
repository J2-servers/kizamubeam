//! Command sequencer of a JCZ board: list building, modes (rapid / red light / program), init, abort and the
//! job player. A port of MeerK40t balormk/controller.py `GalvoController` and the line part of
//! balormk/driver.py `plot_start` (MIT License, Copyright (c) 2021 meerk40t): same commands, same order,
//! same unit conversions, so a job produces the same bytes MeerK40t sends.
//!
//! Safety, enforced here and covered by tests:
//! * the laser path (`program_mode`: port bit 0 on + fiber MO open, `listMarkTo`) is only reached from
//!   `run_job`, which only the explicit mark command calls;
//! * `trace_light` (frame) uses only jumps with the red-light port bit, MO closed and port bit 0 off;
//! * every wait loop watches the stop flag; `abort` closes the MO, clears the lists and turns bit 0 off.

use super::field::{JczParams, JczSettings, PreparedGroup, Source};
use super::protocol::{self as p, pack, signed};
use super::transport::Transport;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Debug, PartialEq)]
pub enum JczError {
    /// stopped by the user (jcz_stop) or by the stop input
    Stopped(String),
    /// literal error of the USB layer or a refused value
    Msg(String),
}

impl std::fmt::Display for JczError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JczError::Stopped(s) | JczError::Msg(s) => f.write_str(s),
        }
    }
}

impl From<String> for JczError {
    fn from(s: String) -> Self {
        JczError::Msg(s)
    }
}

pub type R<T> = Result<T, JczError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Rapid,
    Light,
    Program,
}

#[derive(Default)]
struct Cache {
    speed: Option<f64>,
    travel_speed: Option<f64>,
    frequency: Option<f64>,
    power: Option<f64>,
    pulse_width: Option<u16>,
    fpk: Option<f64>,
    delay_jump: Option<i64>,
    delay_on: Option<i64>,
    delay_off: Option<i64>,
    delay_poly: Option<u16>,
}

pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

pub struct Controller {
    t: Box<dyn Transport>,
    pub settings: JczSettings,
    pub mode: Mode,
    pub last: (u16, u16),
    pub port_bits: u16,
    pub status_word: u16,
    pub inputs: u16,
    active: Option<Vec<u8>>,
    index: usize,
    list_executing: bool,
    packets: usize,
    cache: Cache,
    pub stop: Arc<AtomicBool>,
    log: Log,
}

impl Controller {
    pub fn new(t: Box<dyn Transport>, settings: JczSettings, stop: Arc<AtomicBool>, log: Log) -> Self {
        Self {
            t,
            settings,
            mode: Mode::Rapid,
            last: (p::CENTRE, p::CENTRE),
            port_bits: 0,
            status_word: 0,
            inputs: 0,
            active: None,
            index: 0,
            list_executing: false,
            packets: 0,
            cache: Cache::default(),
            stop,
            log,
        }
    }

    pub fn simulated(&self) -> bool {
        self.t.simulated()
    }

    fn check_stop(&self) -> R<()> {
        if self.stop.load(Ordering::SeqCst) {
            return Err(JczError::Stopped("Gestoppt.".into()));
        }
        Ok(())
    }

    // ---------- transport ----------

    fn send(&mut self, data: &[u8], read: bool) -> R<[u16; 4]> {
        self.t.write(data)?;
        if !read {
            return Ok([0; 4]);
        }
        let r = self.t.read()?;
        let w = |i: usize| u16::from_le_bytes([r[i * 2], r[i * 2 + 1]]);
        Ok([w(0), w(1), w(2), w(3)])
    }

    /// single command with answer (controller.py `_command`)
    pub fn command(&mut self, op: u16, v: [u16; 5]) -> R<[u16; 4]> {
        self.send(&pack(op, v), true)
    }

    fn cmd1(&mut self, op: u16, a: u16) -> R<[u16; 4]> {
        self.command(op, [a, 0, 0, 0, 0])
    }

    // ---------- status ----------

    pub fn status(&mut self) -> R<u16> {
        let s = self.command(p::GET_VERSION, [0; 5])?[3];
        self.status_word = s;
        Ok(s)
    }

    pub fn read_inputs(&mut self) -> R<u16> {
        let i = self.command(p::READ_PORT, [0; 5])?[1];
        self.inputs = i;
        Ok(i)
    }

    /// Board answer as a hex string (serial number words, like controller.py `init_laser`)
    pub fn serial_hex(&mut self) -> R<String> {
        let s = self.command(p::GET_SERIAL_NO, [0; 5])?;
        Ok(s.iter().map(|w| format!("{w:04x}")).collect::<String>())
    }

    /// Polls until `done(status)`; the stop flag ends the wait unless `ignore_stop` (used by abort),
    /// which instead gives up after `limit` so a stuck board can never hang the stop.
    fn wait(&mut self, done: fn(u16) -> bool, ignore_stop: bool, limit: Option<Duration>) -> R<()> {
        let start = Instant::now();
        loop {
            if !ignore_stop {
                self.check_stop()?;
                self.check_inputs_during_job()?;
            }
            let s = self.status()?;
            if done(s) {
                return Ok(());
            }
            if let Some(l) = limit {
                if start.elapsed() > l {
                    return Ok(());
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait_ready(&mut self) -> R<()> {
        self.wait(|s| s & p::READY != 0, false, None)
    }

    pub fn wait_idle(&mut self) -> R<()> {
        self.wait(|s| s & p::BUSY == 0, false, None)
    }

    /// Stop input (LightBurn StopMarkPortBit) and door switch (DoorProtectPortBit) while the laser runs
    fn check_inputs_during_job(&mut self) -> R<()> {
        if self.mode != Mode::Program {
            return Ok(());
        }
        let stop_bit = self.settings.ports.stop_mark;
        let door_bit = self.settings.ports.door_protect;
        if !(0..16).contains(&stop_bit) && !(0..16).contains(&door_bit) {
            return Ok(());
        }
        let inputs = self.read_inputs()?;
        if self.input_active(inputs, stop_bit, "StopMarkBitHigh") {
            return Err(JczError::Stopped(format!("Gestoppt über den Stopp-Eingang {stop_bit}.")));
        }
        if self.input_active(inputs, door_bit, "DoorProtectBitHigh") {
            return Err(JczError::Stopped(format!("Tür offen (Eingang {door_bit}): Markierung abgebrochen.")));
        }
        Ok(())
    }

    pub fn input_active(&self, inputs: u16, bit: i32, high_key: &str) -> bool {
        if !(0..16).contains(&bit) {
            return false;
        }
        let high = self.settings.lb_bool(high_key).unwrap_or(true);
        ((inputs >> bit) & 1 == 1) == high
    }

    // ---------- list building (controller.py _list_new/_list_write/_list_end) ----------

    fn list_write(&mut self, op: u16, v: [u16; 5]) -> R<()> {
        if self.index >= p::LIST_LEN {
            self.list_end()?;
        }
        if self.active.is_none() {
            self.active = Some(p::empty_list());
            self.index = 0;
        }
        let i = self.index;
        self.active.as_mut().unwrap()[i..i + 12].copy_from_slice(&pack(op, v));
        self.index += 12;
        Ok(())
    }

    fn lw(&mut self, op: u16, a: u16) -> R<()> {
        self.list_write(op, [a, 0, 0, 0, 0])
    }

    fn list_end(&mut self) -> R<()> {
        if self.active.is_none() || self.index == 0 {
            return Ok(());
        }
        self.wait_ready()?;
        let list = self.active.take().unwrap();
        self.send(&list, false)?;
        self.cmd1(p::SET_END_OF_LIST, 0)?;
        self.packets += 1;
        self.index = 0;
        if self.packets > 2 && !self.list_executing {
            self.command(p::EXECUTE_LIST, [0; 5])?;
            self.list_executing = true;
        }
        Ok(())
    }

    fn list_ready(&mut self) -> R<()> {
        self.lw(p::L_READY_MARK, 0)
    }

    fn list_delay_time(&mut self, units_10us: i64) -> R<()> {
        self.lw(p::L_DELAY_TIME, units_10us.unsigned_abs().min(0xFFFF) as u16)
    }

    fn list_write_port(&mut self) -> R<()> {
        let b = self.port_bits;
        self.lw(p::L_WRITE_PORT, b)
    }

    fn list_jump_speed(&mut self, speed: f64) -> R<()> {
        if self.cache.travel_speed == Some(speed) {
            return Ok(());
        }
        self.cache.travel_speed = Some(speed);
        let c = p::speed_units(speed, self.settings.field).min(0xFFFF) as u16;
        self.lw(p::L_JUMP_SPEED, c)
    }

    fn list_mark_speed(&mut self, speed: f64) -> R<()> {
        if self.cache.speed == Some(speed) {
            return Ok(());
        }
        self.cache.speed = Some(speed);
        let c = p::speed_units(speed, self.settings.field).min(0xFFFF) as u16;
        self.lw(p::L_MARK_SPEED, c)
    }

    fn list_laser_on_delay(&mut self, d: i64) -> R<()> {
        if self.cache.delay_on == Some(d) {
            return Ok(());
        }
        self.cache.delay_on = Some(d);
        let [a, s] = signed(d);
        self.list_write(p::L_LASER_ON_DELAY, [a, s, 0, 0, 0])
    }

    fn list_laser_off_delay(&mut self, d: i64) -> R<()> {
        if self.cache.delay_off == Some(d) {
            return Ok(());
        }
        self.cache.delay_off = Some(d);
        let [a, s] = signed(d);
        self.list_write(p::L_LASER_OFF_DELAY, [a, s, 0, 0, 0])
    }

    fn list_polygon_delay(&mut self, d: f64) -> R<()> {
        let v = (d / 10.0).clamp(0.0, 65535.0) as u16;
        if self.cache.delay_poly == Some(v) {
            return Ok(());
        }
        self.cache.delay_poly = Some(v);
        self.lw(p::L_POLYGON_DELAY, v)
    }

    fn list_jump_delay(&mut self, d: i64) -> R<()> {
        if self.cache.delay_jump == Some(d) {
            return Ok(());
        }
        self.cache.delay_jump = Some(d);
        let [a, s] = signed(d);
        self.list_write(p::L_JUMP_DELAY, [a, s, 0, 0, 0])
    }

    fn distance(&self, x: u16, y: u16) -> u16 {
        let dx = x as f64 - self.last.0 as f64;
        let dy = y as f64 - self.last.1 as f64;
        (dx.hypot(dy) as i64).min(0xFFFF) as u16
    }

    /// controller.py `list_jump` (`delay` = jump delay before this jump, 0 = none)
    fn list_jump(&mut self, x: u16, y: u16, delay: i64) -> R<()> {
        let d = self.distance(x, y);
        if delay != 0 {
            self.list_jump_delay(delay)?;
        }
        self.list_write(p::L_JUMP_TO, [x, y, 0, d, 0])?;
        self.last = (x, y);
        Ok(())
    }

    /// controller.py `list_mark` — fires the laser; only reachable from `run_job`
    fn list_mark(&mut self, x: u16, y: u16) -> R<()> {
        debug_assert_eq!(self.mode, Mode::Program);
        if self.mode != Mode::Program {
            return Err(JczError::Msg("Interner Fehler: Markierbefehl außerhalb des Markiermodus verweigert.".into()));
        }
        let d = self.distance(x, y);
        self.list_write(p::L_MARK_TO, [x, y, 0, d, 0])?;
        self.last = (x, y);
        Ok(())
    }

    /// Jump delay from LightBurn's min/max jump delay and max jump distance (linear up to the distance)
    fn jump_delay_for(&self, x: u16, y: u16) -> i64 {
        let s = &self.settings;
        if s.max_jump_delay <= 0.0 && s.min_jump_delay <= 0.0 {
            return 0;
        }
        let mm = self.distance(x, y) as f64 / p::galvos_per_mm(s.field);
        let d = if s.max_jump_distance <= 0.0 || mm >= s.max_jump_distance {
            s.max_jump_delay
        } else {
            s.min_jump_delay + (s.max_jump_delay - s.min_jump_delay) * mm / s.max_jump_distance
        };
        d.round() as i64
    }

    fn goto(&mut self, x: u16, y: u16) -> R<()> {
        if (x, y) == self.last {
            return Ok(());
        }
        let delay = self.jump_delay_for(x, y);
        self.list_jump(x, y, delay)
    }

    fn mark(&mut self, x: u16, y: u16) -> R<()> {
        if (x, y) == self.last {
            return Ok(());
        }
        self.list_mark(x, y)
    }

    // ---------- ports ----------

    pub fn port_on(&mut self, bit: u8) {
        self.port_bits |= 1 << bit;
    }

    pub fn port_off(&mut self, bit: u8) {
        self.port_bits &= !(1u16 << bit);
    }

    pub fn write_port(&mut self) -> R<()> {
        let b = self.port_bits;
        self.cmd1(p::WRITE_PORT, b).map(|_| ())
    }

    fn set_fiber_mo(&mut self, open: bool) -> R<()> {
        self.cmd1(p::FIBER_SET_MO, open as u16).map(|_| ())
    }

    fn mode_shift(&mut self, open: bool) -> R<()> {
        // controller.py mode_shift: only fiber sources have the MO command
        if self.settings.source() == Source::Fiber {
            self.set_fiber_mo(open)?;
        }
        Ok(())
    }

    fn reset_cache(&mut self) {
        self.cache = Cache::default();
    }

    // ---------- init (controller.py init_laser with MeerK40t's default device values) ----------

    pub fn init_laser(&mut self) -> R<()> {
        let sn = self.serial_hex()?;
        (self.log)(&format!("Platine: Seriennummer 0x{sn}"));
        let v = self.command(p::GET_VERSION, [0; 5])?;
        (self.log)(&format!("Platine: Version {:04x} {:04x} {:04x} {:04x}", v[0], v[1], v[2], v[3]));
        self.command(p::RESET, [0; 5])?;
        self.cmd1(p::WRITE_COR_TABLE, 0)?; // blank correction table: the correction is done here, in software
        self.command(p::ENABLE_LASER, [0; 5])?;
        self.cmd1(p::SET_CONTROL_MODE, 0)?;
        self.cmd1(p::SET_LASER_MODE, 1)?;
        self.cmd1(p::SET_DELAY_MODE, 1)?;
        self.cmd1(p::SET_TIMING, 1)?;
        self.command(p::SET_STANDBY, [2000, 20, 0, 0, 0])?;
        self.cmd1(p::SET_FIRST_PULSE_KILLER, 200)?;
        self.cmd1(p::SET_PWM_HALF_PERIOD, 125)?;
        self.cmd1(p::SET_PWM_PULSE_WIDTH, 125)?;
        self.set_fiber_mo(false)?;
        // controller.py sends fpk2_p3 twice (fpk2_p4 = fpk2_p3 = 409); kept as MeerK40t sends it
        self.command(p::SET_FPK_PARAM_2, [0xFFB, 1, 409, 409, 0])?;
        self.command(p::SET_FLY_RES, [0, 99, 1000, 25, 0])?;
        self.command(p::ENABLE_Z, [0; 5])?;
        self.cmd1(p::WRITE_ANALOG_PORT_1, 0x7FF)?;
        self.command(p::ENABLE_Z, [0; 5])?;
        self.port_bits = 0;
        self.write_port()?;
        std::thread::sleep(Duration::from_millis(50));
        self.status()?;
        (self.log)("Platine bereit.");
        Ok(())
    }

    // ---------- modes ----------

    /// controller.py `program_mode` (from rapid): the ONLY place that turns port bit 0 on and opens the MO
    fn program_mode(&mut self) -> R<()> {
        if self.mode == Mode::Program {
            return Ok(());
        }
        if self.mode == Mode::Light {
            self.rapid_mode()?;
        }
        self.mode = Mode::Program;
        self.command(p::RESET_LIST, [0; 5])?;
        self.port_on(0);
        self.write_port()?;
        self.mode_shift(true)?;
        self.reset_cache();
        self.list_ready()?;
        if self.settings.source() == Source::Fiber {
            let d = self.settings.open_mo_delay_us();
            if d != 0.0 {
                // controller.py: list_delay_time(int(delay_openmo * 100)), delay_openmo in ms → units of 10 µs
                self.list_delay_time((d / 10.0) as i64)?;
            }
        }
        self.list_write_port()?;
        let js = self.settings.jump_speed;
        self.list_jump_speed(js)
    }

    /// controller.py `light_mode` (from rapid): red light bit on, laser bit 0 off, MO stays closed
    fn light_mode(&mut self) -> R<()> {
        if self.mode == Mode::Light {
            return Ok(());
        }
        if self.mode == Mode::Program {
            self.rapid_mode()?;
        }
        self.reset_cache();
        self.command(p::RESET_LIST, [0; 5])?;
        self.list_ready()?;
        self.port_off(0);
        let lb = self.settings.light_bit();
        self.port_on(lb);
        self.list_write_port()?;
        self.mode = Mode::Light;
        Ok(())
    }

    /// controller.py `rapid_mode`: end and run the list, wait until done, close the MO, port bit 0 off
    pub fn rapid_mode(&mut self) -> R<()> {
        if self.mode == Mode::Rapid {
            return Ok(());
        }
        self.lw(p::L_END_OF_LIST, 0)?;
        self.list_end()?;
        if !self.list_executing && self.packets > 0 {
            self.command(p::EXECUTE_LIST, [0; 5])?;
        }
        self.list_executing = false;
        self.packets = 0;
        self.wait_idle()?;
        self.mode_shift(false)?;
        self.port_off(0);
        self.write_port()?;
        let t = self.command(p::GET_MARK_TIME, [3, 0, 0, 0, 0])?;
        (self.log)(&format!("Laufzeit laut Platine: {:04x} {:04x} {:04x} {:04x}", t[0], t[1], t[2], t[3]));
        self.mode = Mode::Rapid;
        Ok(())
    }

    /// controller.py `abort`: stop at once, MO closed, lists cleared, bit 0 off (and the red light off).
    /// Clears the stop flag; never waits on the stop flag itself.
    pub fn abort(&mut self) -> R<()> {
        self.command(p::STOP_EXECUTE, [0; 5])?;
        self.set_fiber_mo(false)?;
        self.command(p::RESET_LIST, [0; 5])?;
        self.active = Some(p::empty_list());
        self.index = 0;
        self.lw(p::L_END_OF_LIST, 0)?;
        self.wait(|s| s & p::READY != 0, true, Some(Duration::from_secs(2)))?;
        let list = self.active.take().unwrap();
        self.index = 0;
        self.send(&list, false)?;
        self.cmd1(p::SET_END_OF_LIST, 0)?;
        if !self.list_executing {
            self.command(p::EXECUTE_LIST, [0; 5])?;
        }
        self.list_executing = false;
        self.packets = 0;
        self.set_fiber_mo(false)?;
        self.port_off(0);
        let lb = self.settings.light_bit();
        self.port_off(lb);
        self.write_port()?;
        self.mode = Mode::Rapid;
        self.stop.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Laser off when disconnecting or closing the app: stop, MO closed, all outputs off, laser signal off
    pub fn shutdown(&mut self) -> Vec<String> {
        let mut errs = Vec::new();
        for (op, v) in [
            (p::STOP_EXECUTE, 0u16),
            (p::FIBER_SET_MO, 0),
            (p::WRITE_PORT, 0),
            (p::LASER_SIGNAL_OFF, 0),
            (p::DISABLE_LASER, 0),
        ] {
            if let Err(e) = self.cmd1(op, v) {
                errs.push(format!("{}: {e}", p::single_name(op)));
            }
        }
        self.port_bits = 0;
        self.mode = Mode::Rapid;
        errs
    }

    pub fn light(&mut self, on: bool) -> R<()> {
        let lb = self.settings.light_bit();
        if on {
            self.port_on(lb);
        } else {
            self.port_off(lb);
        }
        self.port_off(0);
        self.write_port()
    }

    // ---------- settings of a pass (controller.py set_settings) ----------

    fn frequency(&mut self, f: f64) -> R<()> {
        if self.cache.frequency == Some(f) {
            return Ok(());
        }
        self.cache.frequency = Some(f);
        match self.settings.source() {
            Source::Fiber => self.lw(p::L_QSWITCH_PERIOD, p::period(f, 20000.0)),
            Source::Co2 | Source::Uv => self.lw(p::L_MARK_FREQ, p::period(f, 10000.0)),
        }
    }

    fn fpk(&mut self) -> R<()> {
        // controller.py fpk(): CO2/UV only, value round(2000 / frequency)
        let f = self.cache.frequency.unwrap_or(self.settings.min_freq);
        if self.cache.fpk == Some(f) {
            return Ok(());
        }
        self.cache.fpk = Some(f);
        let v = p::py_round(2000.0 / f).clamp(0, 0xFFFF) as u16;
        self.list_write(p::L_SET_CO2_FPK, [v, v, 0, 0, 0])
    }

    fn power(&mut self, power: f64) -> R<()> {
        if self.cache.power == Some(power) {
            return Ok(());
        }
        let power = power.clamp(0.0, 100.0);
        self.cache.power = Some(power);
        match self.settings.source() {
            Source::Fiber => self.lw(p::L_MARK_CURRENT, p::fiber_current(power)),
            Source::Co2 | Source::Uv => {
                let f = self.cache.frequency.unwrap_or(self.settings.min_freq);
                self.lw(p::L_MARK_POWER_RATIO, p::power_ratio(power, f))
            }
        }
    }

    fn set_settings(&mut self, q: &JczParams) -> R<()> {
        let s = self.settings.clone();
        if s.pulse_width_enabled && s.source() == Source::Fiber {
            let pw = q.pulse_width.round().clamp(1.0, 65535.0) as u16;
            if self.cache.pulse_width != Some(pw) {
                self.cache.pulse_width = Some(pw);
                self.lw(p::L_FIBER_YLPM_PULSE_WIDTH, pw)?;
            }
        }
        self.list_jump_speed(s.jump_speed)?;
        self.frequency(q.frequency)?;
        if s.source() != Source::Fiber {
            self.fpk()?;
        }
        self.power(q.power)?;
        self.list_mark_speed(q.speed)?;
        self.list_laser_on_delay(q.laser_on_delay.unwrap_or(s.laser_on_delay).round() as i64)?;
        self.list_laser_off_delay(q.laser_off_delay.unwrap_or(s.laser_off_delay).round() as i64)?;
        self.list_polygon_delay(q.polygon_delay.unwrap_or(s.polygon_delay))
    }

    // ---------- jobs ----------

    /// Marks a prepared job (fires the laser). `progress` gets 0..1.
    pub fn run_job(&mut self, groups: &[PreparedGroup], repeat: u32, total: usize, progress: &mut dyn FnMut(f64)) -> R<()> {
        self.check_stop()?;
        if self.mode != Mode::Rapid {
            self.rapid_mode()?;
        }
        // door switch before the first pulse
        let door = self.settings.ports.door_protect;
        if (0..16).contains(&door) {
            let i = self.read_inputs()?;
            if self.input_active(i, door, "DoorProtectBitHigh") {
                return Err(JczError::Msg(format!("Tür offen (Eingang {door}): Markierung nicht gestartet.")));
            }
        }
        self.program_mode()?;
        let mut done = 0usize;
        let mut last_pct = -1i64;
        for _ in 0..repeat {
            for g in groups {
                self.set_settings(&g.params)?;
                for _ in 0..g.params.passes {
                    for pl in &g.polylines {
                        self.check_stop()?;
                        let (x, y) = pl[0];
                        self.goto(x, y)?;
                        for &(x, y) in &pl[1..] {
                            self.mark(x, y)?;
                        }
                        done += pl.len();
                        let pct = (done * 100 / total.max(1)) as i64;
                        if pct != last_pct {
                            last_pct = pct;
                            progress(0.95 * done as f64 / total.max(1) as f64);
                        }
                    }
                }
            }
        }
        let end = self.settings.end_delay;
        self.list_delay_time((end / 10.0) as i64)?;
        self.rapid_mode()?;
        progress(1.0);
        Ok(())
    }

    /// Traces `points` (galvo words, red-dot corrected) with the red guide light only: jumps, no mark command,
    /// MO closed, port bit 0 off (livelightjob.py `trace_redlight`). Closes the outline back to the first point.
    pub fn trace_light(&mut self, points: &[(u16, u16)], speed: f64, repeat_until_stop: bool) -> R<()> {
        if points.is_empty() {
            return Ok(());
        }
        self.light_mode()?;
        self.list_jump_speed(speed)?;
        let delay = self.settings.red_jump_delay();
        loop {
            self.check_stop()?;
            let (fx, fy) = points[0];
            self.list_jump(fx, fy, delay)?;
            for &(x, y) in &points[1..] {
                self.check_stop()?;
                self.list_jump(x, y, delay)?;
            }
            if points.len() > 2 && points[points.len() - 1] != points[0] {
                self.list_jump(fx, fy, delay)?;
            }
            if !repeat_until_stop {
                break;
            }
        }
        self.rapid_mode()?;
        let lb = self.settings.light_bit();
        self.port_off(lb);
        self.write_port()
    }
}
