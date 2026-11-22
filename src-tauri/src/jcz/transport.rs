//! Transports to a JCZ board: real USB through `nusb` (WinUSB on Windows: the driver LightBurn/EzCad already
//! installed for the board) and a simulator that answers like a board and records every packet.
//!
//! USB layout from MeerK40t balormk/usb_connection.py (MIT): VID 0x9588, PID 0x9899, interface 0, bulk OUT 0x02
//! (12-byte commands, 0xC00-byte lists), bulk IN 0x88 (8-byte answers). Errors carry the literal text of the
//! USB layer.

use super::protocol::{self as p, unpack};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub trait Transport: Send {
    fn write(&mut self, packet: &[u8]) -> Result<(), String>;
    fn read(&mut self) -> Result<[u8; 8], String>;
    fn simulated(&self) -> bool {
        false
    }
}

/// What `jcz_list` returns (contract.ts `JczBoard`)
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct JczBoard {
    pub serial: String,
    pub vid: u16,
    pub pid: u16,
    pub model: String,
}

fn model_of(product: Option<&str>) -> String {
    match product {
        Some(s) if s.to_ascii_uppercase().contains("LMCV4") => "LMC V4".into(),
        Some(s) if !s.trim().is_empty() => s.trim().into(),
        _ => "Unknown".into(),
    }
}

/// Boards on USB with the JCZ ids. Opens nothing, so it also works while LightBurn holds the board.
pub fn list_boards() -> Result<Vec<JczBoard>, String> {
    use nusb::MaybeFuture;
    let devs = nusb::list_devices().wait().map_err(|e| format!("USB: {e}"))?;
    Ok(devs
        .filter(|d| d.vendor_id() == p::VID && d.product_id() == p::PID)
        .map(|d| JczBoard {
            serial: d.serial_number().unwrap_or("").to_string(),
            vid: d.vendor_id(),
            pid: d.product_id(),
            model: model_of(d.product_string()),
        })
        .collect())
}

pub struct UsbTransport {
    _interface: nusb::Interface,
    out: nusb::Endpoint<nusb::transfer::Bulk, nusb::transfer::Out>,
    inp: nusb::Endpoint<nusb::transfer::Bulk, nusb::transfer::In>,
    timeout: Duration,
}

impl UsbTransport {
    pub fn open(serial: Option<&str>) -> Result<(Self, JczBoard), String> {
        use nusb::MaybeFuture;
        let devs: Vec<_> = nusb::list_devices()
            .wait()
            .map_err(|e| format!("USB: {e}"))?
            .filter(|d| d.vendor_id() == p::VID && d.product_id() == p::PID)
            .collect();
        let want = serial.map(str::trim).filter(|s| !s.is_empty());
        let info = match want {
            Some(sn) => devs.iter().find(|d| d.serial_number() == Some(sn)).ok_or_else(|| {
                let found: Vec<_> = devs.iter().map(|d| d.serial_number().unwrap_or("?").to_string()).collect();
                format!("JCZ-Platine mit Seriennummer {sn} ist nicht am USB (gefunden: {}).", if found.is_empty() { "keine".into() } else { found.join(", ") })
            })?,
            None => devs.first().ok_or("Keine JCZ-Platine am USB gefunden (9588:9899). Ist die Maschine eingeschaltet und das USB-Kabel gesteckt?")?,
        };
        let board = JczBoard {
            serial: info.serial_number().unwrap_or("").to_string(),
            vid: info.vendor_id(),
            pid: info.product_id(),
            model: model_of(info.product_string()),
        };
        let name = if board.serial.is_empty() { "JCZ".to_string() } else { format!("JCZ {}", board.serial) };
        let device = info.open().wait().map_err(|e| format!("{name}: USB öffnen: {e}"))?;
        let interface = device
            .claim_interface(0)
            .wait()
            .map_err(|e| format!("{name}: USB-Schnittstelle belegen: {e} (ist LightBurn oder EzCad noch mit der Platine verbunden?)"))?;
        let out = interface
            .endpoint::<nusb::transfer::Bulk, nusb::transfer::Out>(p::EP_OUT)
            .map_err(|e| format!("{name}: Endpunkt 0x02: {e}"))?;
        let inp = interface
            .endpoint::<nusb::transfer::Bulk, nusb::transfer::In>(p::EP_IN)
            .map_err(|e| format!("{name}: Endpunkt 0x88: {e}"))?;
        Ok((Self { _interface: interface, out, inp, timeout: Duration::from_millis(1000) }, board))
    }
}

impl Transport for UsbTransport {
    fn write(&mut self, packet: &[u8]) -> Result<(), String> {
        let c = self.out.transfer_blocking(nusb::transfer::Buffer::from(packet.to_vec()), self.timeout);
        c.status.map_err(|e| format!("USB senden: {e}"))?;
        if c.actual_len != packet.len() {
            return Err(format!("USB senden: nur {} von {} Bytes übertragen", c.actual_len, packet.len()));
        }
        Ok(())
    }

    fn read(&mut self) -> Result<[u8; 8], String> {
        let mps = self.inp.max_packet_size().max(8);
        let c = self.inp.transfer_blocking(nusb::transfer::Buffer::new(mps), self.timeout);
        let n = c.actual_len;
        let buf = c.into_result().map_err(|e| format!("USB lesen: {e}"))?;
        if n < 8 {
            return Err(format!("USB lesen: Antwort der Platine hat {n} statt 8 Bytes"));
        }
        let mut r = [0u8; 8];
        r.copy_from_slice(&buf[..8]);
        Ok(r)
    }
}

/// State of the simulated board, shared with the tests
#[derive(Default, Debug)]
pub struct SimState {
    /// every packet written, in order
    pub packets: Vec<Vec<u8>>,
    /// output port word (last WritePort / listWritePort that ran)
    pub port: u16,
    /// fiber MO open (Fiber_SetMo 1)
    pub mo_open: bool,
    /// input port word the board reports (tests set pedal/door bits here)
    pub inputs: u16,
    /// set when the laser would emit: a listMarkTo/listLaserOnPoint executed while MO open and port bit 0 on
    pub fired: bool,
    /// keep every packet in `packets` (tests); the app only logs them
    pub record: bool,
    lists_pending: usize,
    busy_until: Option<Instant>,
    reply: Option<[u8; 8]>,
    /// list packets waiting for ExecuteList, kept to evaluate `fired` when they "run"
    queued: Vec<Vec<u8>>,
}

pub type SimHandle = Arc<Mutex<SimState>>;

pub struct SimTransport {
    pub state: SimHandle,
    log: Option<Arc<dyn Fn(&str) + Send + Sync>>,
    /// simulated run time per executed list packet
    pub per_list: Duration,
}

impl SimTransport {
    pub fn new(log: Option<Arc<dyn Fn(&str) + Send + Sync>>) -> Self {
        let state = SimState { record: true, ..Default::default() };
        Self { state: Arc::new(Mutex::new(state)), log, per_list: Duration::from_millis(5) }
    }

    fn run_list(st: &mut SimState, list: &[u8]) {
        for c in list.chunks(p::SINGLE_LEN) {
            let (op, v) = unpack(c);
            match op {
                p::L_WRITE_PORT => st.port = v[0],
                p::L_FIBER_OPEN_MO => st.mo_open = v[0] != 0,
                p::L_MARK_TO | p::L_LASER_ON_POINT if st.mo_open && st.port & 1 != 0 => st.fired = true,
                _ => {}
            }
        }
    }
}

fn words(w: [u16; 4]) -> [u8; 8] {
    let mut r = [0u8; 8];
    for (i, x) in w.iter().enumerate() {
        r[i * 2..i * 2 + 2].copy_from_slice(&x.to_le_bytes());
    }
    r
}

impl Transport for SimTransport {
    fn write(&mut self, packet: &[u8]) -> Result<(), String> {
        if packet.len() != p::SINGLE_LEN && packet.len() != p::LIST_LEN {
            return Err(format!("Simulator: Paket mit {} Bytes (erwartet 12 oder 3072)", packet.len()));
        }
        if let Some(log) = &self.log {
            for l in p::describe(packet, 12) {
                log(&format!("SIM > {l}"));
            }
        }
        let mut st = self.state.lock().unwrap();
        if st.record {
            st.packets.push(packet.to_vec());
        }
        if packet.len() == p::LIST_LEN {
            st.lists_pending += 1;
            if st.busy_until.is_some() {
                // board already running: the new list runs after the current one
                let more = self.per_list;
                st.busy_until = st.busy_until.map(|t| t.max(Instant::now()) + more);
                Self::run_list(&mut st, packet);
            } else {
                st.queued.push(packet.to_vec());
            }
            return Ok(());
        }
        let (op, v) = unpack(packet);
        let now = Instant::now();
        let busy = st.busy_until.map(|t| t > now).unwrap_or(false);
        // the list buffer counts as full while more than three list packets are still to run
        let full = st.busy_until.map(|t| t > now + self.per_list * 3).unwrap_or(false);
        let status = if full { 0 } else { p::READY } | if busy { p::BUSY } else { 0 };
        st.reply = Some(match op {
            p::GET_SERIAL_NO => *b"KZSIM001",
            p::READ_PORT => words([0, st.inputs, 0, status]),
            _ => words([0, 0, 0, status]),
        });
        match op {
            p::EXECUTE_LIST => {
                let queued = std::mem::take(&mut st.queued);
                for l in &queued {
                    Self::run_list(&mut st, l);
                }
                let n = st.lists_pending.max(1) as u32;
                st.busy_until = Some(now + self.per_list * n);
            }
            p::STOP_EXECUTE => {
                st.busy_until = None;
                st.queued.clear();
            }
            p::RESET_LIST => {
                st.lists_pending = 0;
                st.queued.clear();
            }
            p::WRITE_PORT => st.port = v[0],
            p::FIBER_SET_MO => st.mo_open = v[0] != 0,
            _ => {}
        }
        if st.busy_until.map(|t| t <= now).unwrap_or(false) {
            st.busy_until = None;
            st.lists_pending = 0;
        }
        Ok(())
    }

    fn read(&mut self) -> Result<[u8; 8], String> {
        let mut st = self.state.lock().unwrap();
        Ok(st.reply.take().unwrap_or_else(|| words([0, 0, 0, p::READY])))
    }

    fn simulated(&self) -> bool {
        true
    }
}
