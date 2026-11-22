//! Galvo fiber lasers with a BJJCZ/EzCad "LMC" board (USB 9588:9899), the machines LightBurn drives as
//! "JCZFiber". Contract with the app: src/jcz/contract.ts.
//!
//! * protocol.rs  — packet format and opcodes (port of MeerK40t balormk, MIT)
//! * field.rs     — settings, job types, mm → galvo transform with field correction, parameter checks
//! * transport.rs — USB through nusb/WinUSB and the simulator
//! * controller.rs — command sequencer and job player (port of MeerK40t GalvoController)
//!
//! One worker thread owns the board. Commands validate synchronously (errors go back to the caller with the
//! reason), then hand the work to the worker. `jcz_stop` sets a flag every loop of the worker watches, so a
//! running frame or job ends within one poll (10 ms) plus the USB transfer in flight, and the worker then
//! aborts (MO closed, lists cleared, laser bit off). Disconnect and closing the window turn the laser off.

pub mod controller;
pub mod field;
pub mod protocol;
pub mod transport;
#[cfg(test)]
mod tests;

use controller::{Controller, JczError, Log, Mode};
use field::{prepare_job, JczJob, JczSettings};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use transport::{JczBoard, SimTransport, Transport, UsbTransport};

pub use transport::SimHandle;

#[derive(Serialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JczStatus {
    pub connected: bool,
    pub busy: bool,
    pub raw: u16,
    pub progress: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub simulated: bool,
    /// input port word of the board (foot pedal, door …), in addition to the contract
    pub inputs: u16,
    /// "idle" | "frame" | "mark", in addition to the contract
    pub mode: String,
}

/// Where the worker reports to (the window in the app, a collector in the tests)
pub trait Events: Send + Sync + 'static {
    fn status(&self, s: &JczStatus);
    fn log(&self, line: &str);
}

struct WindowEvents {
    app: AppHandle,
    label: String,
}

impl Events for WindowEvents {
    fn status(&self, s: &JczStatus) {
        let _ = self.app.emit_to(self.label.as_str(), "jcz:status", s);
    }
    fn log(&self, line: &str) {
        let _ = self.app.emit_to(self.label.as_str(), "jcz:log", line);
    }
}

enum Req {
    Frame { points: Vec<(u16, u16)>, speed: f64, repeat: bool },
    Mark { groups: Vec<field::PreparedGroup>, repeat: u32, total: usize },
    Light { on: bool, reply: Sender<Result<(), String>> },
    Close,
}

/// A connected board: the worker thread and what the commands share with it
pub struct Link {
    tx: Sender<Req>,
    stop: Arc<AtomicBool>,
    status: Arc<Mutex<JczStatus>>,
    settings: JczSettings,
    join: Option<JoinHandle<()>>,
    /// simulator state when simulated (tests read the packets from here)
    #[cfg_attr(not(test), allow(dead_code))]
    pub sim: Option<SimHandle>,
}

impl Link {
    /// Opens the board (or the simulator), initialises it and starts the worker
    pub fn connect(serial: Option<&str>, settings: JczSettings, simulate: bool, events: Arc<dyn Events>) -> Result<Link, String> {
        settings.validate()?;
        let log: Log = {
            let ev = events.clone();
            Arc::new(move |l: &str| ev.log(l))
        };
        let (t, sim, name): (Box<dyn Transport>, Option<SimHandle>, String) = if simulate {
            let sim_log: Log = log.clone();
            let mut st = SimTransport::new(Some(sim_log));
            st.per_list = Duration::from_millis(20);
            // the app only logs the simulated packets; the tests keep them all
            st.state.lock().unwrap().record = cfg!(test);
            let h = st.state.clone();
            (Box::new(st), Some(h), "Simulator".into())
        } else {
            let (u, b) = UsbTransport::open(serial)?;
            let name = format!("{} {}", b.model, b.serial).trim().to_string();
            (Box::new(u), None, name)
        };
        let stop = Arc::new(AtomicBool::new(false));
        let mut c = Controller::new(t, settings.clone(), stop.clone(), log.clone());
        log(&format!("Verbinde mit {name} …"));
        if let Err(e) = c.init_laser() {
            let _ = c.shutdown();
            return Err(format!("{name}: {e}"));
        }
        let status = Arc::new(Mutex::new(JczStatus {
            connected: true,
            raw: c.status_word,
            simulated: c.simulated(),
            mode: "idle".into(),
            ..Default::default()
        }));
        events.status(&status.lock().unwrap());
        let (tx, rx) = channel();
        let st2 = status.clone();
        let join = std::thread::spawn(move || worker(c, rx, st2, events));
        Ok(Link { tx, stop, status, settings, join: Some(join), sim })
    }

    pub fn status(&self) -> JczStatus {
        self.status.lock().unwrap().clone()
    }

    fn ensure_idle(&self) -> Result<(), String> {
        let s = self.status.lock().unwrap();
        if !s.connected {
            return Err(s.error.clone().unwrap_or_else(|| "Nicht verbunden.".into()));
        }
        if s.busy {
            return Err(if s.mode == "mark" { "Es läuft bereits eine Markierung.".into() } else { "Der Rahmen läuft noch – erst stoppen.".into() });
        }
        Ok(())
    }

    fn submit(&self, r: Req, mode: &str) -> Result<(), String> {
        {
            let mut s = self.status.lock().unwrap();
            s.busy = true;
            s.progress = 0.0;
            s.mode = mode.into();
            s.error = None;
        }
        self.tx.send(r).map_err(|_| "Verbindung zur Platine ist beendet.".to_string())
    }

    /// Red guide light along `polyline` (field mm); the laser stays off
    pub fn frame(&self, polyline: &[[f64; 2]], speed: f64, repeat: bool) -> Result<(), String> {
        self.ensure_idle()?;
        if !(speed.is_finite() && speed > 0.0) {
            return Err(format!("Rahmengeschwindigkeit {speed} mm/s ist ungültig."));
        }
        if polyline.is_empty() {
            return Err("Kein Rahmen: die Linie ist leer.".into());
        }
        let mut points = Vec::with_capacity(polyline.len());
        for p in polyline {
            points.push(self.settings.to_galvo(p[0], p[1], true)?);
        }
        self.stop.store(false, Ordering::SeqCst);
        self.submit(Req::Frame { points, speed, repeat }, "frame")
    }

    /// Marks the job (fires the laser). Everything is checked before the first packet is sent.
    pub fn mark(&self, job: &JczJob) -> Result<(), String> {
        self.ensure_idle()?;
        let (groups, total) = prepare_job(job, &self.settings)?;
        self.stop.store(false, Ordering::SeqCst);
        self.submit(Req::Mark { groups, repeat: job.repeat, total }, "mark")
    }

    pub fn light(&self, on: bool) -> Result<(), String> {
        self.ensure_idle()?;
        let (rtx, rrx) = channel();
        self.tx.send(Req::Light { on, reply: rtx }).map_err(|_| "Verbindung zur Platine ist beendet.".to_string())?;
        rrx.recv_timeout(Duration::from_secs(5)).map_err(|_| "Platine antwortet nicht auf den Rotlicht-Befehl.".to_string())?
    }

    /// Stops framing or marking at once; the worker aborts and turns the laser off
    pub fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    /// Laser off and close (also on drop)
    pub fn close(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        let _ = self.tx.send(Req::Close);
        if let Some(j) = self.join.take() {
            let _ = j.join();
        }
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        self.close();
    }
}

fn worker(mut c: Controller, rx: Receiver<Req>, status: Arc<Mutex<JczStatus>>, ev: Arc<dyn Events>) {
    let emit = |f: &dyn Fn(&mut JczStatus)| {
        let s = {
            let mut s = status.lock().unwrap();
            f(&mut s);
            s.clone()
        };
        ev.status(&s);
    };
    let pedal_bit = c.settings.ports.start_mark;
    let mut pedal_was = false;
    loop {
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(Req::Close) | Err(RecvTimeoutError::Disconnected) => break,
            Ok(Req::Light { on, reply }) => {
                let r = c.light(on).map_err(|e| e.to_string());
                let _ = reply.send(r);
            }
            Ok(Req::Frame { points, speed, repeat }) => {
                ev.log(&format!("Rahmen mit Rotlicht ({} Punkte, {speed} mm/s{}) – Laser aus.", points.len(), if repeat { ", bis Stopp" } else { "" }));
                let r = c.trace_light(&points, speed, repeat);
                finish(&mut c, r, &emit, &*ev, "Rahmen");
            }
            Ok(Req::Mark { groups, repeat, total }) => {
                ev.log(&format!("Markierung startet ({total} Punkte, {repeat}×)."));
                let st = status.clone();
                let evp = ev.clone();
                let mut progress = move |p: f64| {
                    let s = {
                        let mut s = st.lock().unwrap();
                        s.progress = p;
                        s.clone()
                    };
                    evp.status(&s);
                };
                let r = c.run_job(&groups, repeat, total, &mut progress);
                finish(&mut c, r, &emit, &*ev, "Markierung");
            }
            Err(RecvTimeoutError::Timeout) => {
                // idle: read the state word (and the inputs when a pedal or door bit is set up)
                let r = c.status().and_then(|raw| {
                    let ports = &c.settings.ports;
                    let inputs = if [ports.start_mark, ports.start_frame, ports.stop_mark, ports.door_protect].iter().any(|b| (0..16).contains(b)) {
                        c.read_inputs()?
                    } else {
                        c.inputs
                    };
                    Ok((raw, inputs))
                });
                match r {
                    Ok((raw, inputs)) => {
                        let pedal = c.input_active(inputs, pedal_bit, "StartMarkBitHigh");
                        if pedal && !pedal_was {
                            // reported only: the pedal never fires the laser by itself (jcz_mark does)
                            ev.log(&format!("Fußschalter (Eingang {pedal_bit}) betätigt."));
                        }
                        pedal_was = pedal;
                        let changed = {
                            let s = status.lock().unwrap();
                            s.raw != raw || s.inputs != inputs
                        };
                        if changed {
                            emit(&|s| {
                                s.raw = raw;
                                s.inputs = inputs;
                            });
                        }
                    }
                    Err(e) => {
                        let msg = e.to_string();
                        ev.log(&format!("Verbindung verloren: {msg}"));
                        emit(&|s| {
                            s.connected = false;
                            s.busy = false;
                            s.mode = "idle".into();
                            s.error = Some(msg.clone());
                        });
                        return;
                    }
                }
            }
        }
    }
    let errs = c.shutdown();
    for e in &errs {
        ev.log(&format!("Beim Trennen: {e}"));
    }
    ev.log("Getrennt – Laser aus.");
    emit(&|s| {
        s.connected = false;
        s.busy = false;
        s.mode = "idle".into();
    });
}

fn finish(c: &mut Controller, r: Result<(), JczError>, emit: &dyn Fn(&dyn Fn(&mut JczStatus)), ev: &dyn Events, what: &str) {
    let ok = r.is_ok();
    let err: Option<String> = match r {
        Ok(()) => {
            ev.log(&format!("{what} fertig."));
            None
        }
        Err(JczError::Stopped(msg)) => {
            ev.log(&format!("{what}: {msg}"));
            match c.abort() {
                Ok(()) => {
                    ev.log("Abgebrochen – Laser aus.");
                    // a stop asked by the user is not an error; a stop by the stop input or the door is
                    if msg == "Gestoppt." { None } else { Some(msg) }
                }
                Err(e) => Some(format!("{msg} Abbruch fehlgeschlagen: {e}")),
            }
        }
        Err(JczError::Msg(msg)) => {
            ev.log(&format!("{what} fehlgeschlagen: {msg}"));
            let _ = c.abort();
            Some(msg)
        }
    };
    let raw = c.status_word;
    emit(&|s| {
        s.busy = false;
        s.mode = "idle".into();
        s.raw = raw;
        if ok && c.mode == Mode::Rapid {
            s.progress = 1.0;
        }
        s.error = err.clone();
    });
}

// ---------------- Tauri commands (contract.ts) ----------------

/// The one board connection of the app. A static (not Tauri-managed state) so registering the module only
/// needs `mod jcz;` and the command names in lib.rs.
pub struct Jcz {
    link: Mutex<Option<Link>>,
    hooked: AtomicBool,
}

impl Jcz {
    fn with<T>(&self, f: impl FnOnce(&Link) -> Result<T, String>) -> Result<T, String> {
        let g = self.link.lock().unwrap();
        let l = g.as_ref().ok_or("Nicht mit einer JCZ-Platine verbunden.")?;
        f(l)
    }

    fn close(&self) {
        if let Some(mut l) = self.link.lock().unwrap().take() {
            l.close();
        }
    }
}

static JCZ: Jcz = Jcz { link: Mutex::new(None), hooked: AtomicBool::new(false) };

fn sim_env() -> bool {
    std::env::var("KZ_JCZ_SIM").map(|v| v == "1").unwrap_or(false)
}

#[tauri::command]
pub async fn jcz_list() -> Result<Vec<JczBoard>, String> {
    let mut boards = transport::list_boards()?;
    if sim_env() {
        boards.push(JczBoard { serial: "SIM".into(), vid: protocol::VID, pid: protocol::PID, model: "Simulator".into() });
    }
    Ok(boards)
}

#[tauri::command]
pub async fn jcz_connect(
    app: AppHandle,
    window: tauri::Window,
    serial: Option<String>,
    settings: JczSettings,
    simulate: Option<bool>,
) -> Result<JczStatus, String> {
    let state = &JCZ;
    state.close();
    let simulate = simulate.unwrap_or(false) || sim_env() || serial.as_deref() == Some("SIM");
    let events: Arc<dyn Events> = Arc::new(WindowEvents { app: app.clone(), label: window.label().to_string() });
    let serial2 = serial.clone();
    let link = tauri::async_runtime::spawn_blocking(move || Link::connect(serial2.as_deref(), settings, simulate, events))
        .await
        .map_err(|e| e.to_string())?;
    let link = match link {
        Ok(l) => l,
        Err(e) => {
            let _ = app.emit_to(window.label(), "jcz:log", &e);
            return Err(e);
        }
    };
    let st = link.status();
    *state.link.lock().unwrap() = Some(link);
    // closing the window turns the laser off (once per app run)
    if !state.hooked.swap(true, Ordering::SeqCst) {
        window.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed) {
                JCZ.close();
            }
        });
    }
    Ok(st)
}

#[tauri::command]
pub async fn jcz_disconnect() -> Result<(), String> {
    let link = JCZ.link.lock().unwrap().take();
    if let Some(mut l) = link {
        tauri::async_runtime::spawn_blocking(move || l.close()).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn jcz_status() -> Result<JczStatus, String> {
    Ok(JCZ.link.lock().unwrap().as_ref().map(|l| l.status()).unwrap_or_default())
}

#[tauri::command]
pub async fn jcz_frame(polyline: Vec<[f64; 2]>, speed: f64, r#loop: bool) -> Result<(), String> {
    JCZ.with(|l| l.frame(&polyline, speed, r#loop))
}

#[tauri::command]
pub async fn jcz_mark(job: JczJob) -> Result<(), String> {
    JCZ.with(|l| l.mark(&job))
}

#[tauri::command]
pub async fn jcz_stop() -> Result<(), String> {
    JCZ.with(|l| {
        l.stop();
        Ok(())
    })
}

#[tauri::command]
pub async fn jcz_light(on: bool) -> Result<(), String> {
    let g = JCZ.link.lock().unwrap();
    let l = g.as_ref().ok_or("Nicht mit einer JCZ-Platine verbunden.")?;
    l.light(on)
}
