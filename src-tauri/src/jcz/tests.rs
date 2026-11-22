//! Tests of the JCZ driver against the simulator. `cargo test -p kizamubeam jcz`

use super::controller::{Controller, JczError};
use super::field::*;
use super::protocol::{self as p, pack, unpack};
use super::transport::{SimHandle, SimTransport};
use super::{Events, JczStatus, Link};
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn sim_controller(s: JczSettings) -> (Controller, SimHandle) {
    let t = SimTransport::new(None);
    let h = t.state.clone();
    let mut c = Controller::new(Box::new(t), s, Arc::new(AtomicBool::new(false)), Arc::new(|_: &str| {}));
    c.init_laser().unwrap();
    h.lock().unwrap().packets.clear();
    (c, h)
}

fn square_job(speed: f64, power: f64, freq: f64) -> JczJob {
    JczJob {
        groups: vec![JczGroup {
            params: JczParams { speed, power, frequency: freq, pulse_width: 0.0, passes: 1, laser_on_delay: None, laser_off_delay: None, polygon_delay: None },
            polylines: vec![vec![[-5.0, -5.0], [5.0, -5.0], [5.0, 5.0], [-5.0, 5.0], [-5.0, -5.0]]],
        }],
        repeat: 1,
    }
}

fn singles(packets: &[Vec<u8>]) -> Vec<(u16, [u16; 5])> {
    packets.iter().filter(|p| p.len() == p::SINGLE_LEN).map(|p| unpack(p)).filter(|(op, _)| *op != p::GET_VERSION).collect()
}

fn list_cmds(packets: &[Vec<u8>]) -> Vec<(u16, [u16; 5])> {
    packets.iter().filter(|p| p.len() == p::LIST_LEN).flat_map(|p| p.chunks(12).map(unpack).collect::<Vec<_>>()).collect()
}

/// Square of 10 mm centred in a 110 mm field, 1000 mm/s, 50 %, 30 kHz, fiber.
///
/// Expected bytes worked out from MeerK40t meerk40t/balormk (controller.py + driver.py `plot_start`) with its
/// default device values (device.py: lens_size 110mm, swap_xy/flip off, default_rapid_speed 2000,
/// delay_laser_on/off 100, delay_polygon 100, delay_end 300, delay_openmo 8, pulse width off) — the same
/// values KizamuBeam's defaults use — for the line cuts (50,50)→(60,50)→(60,60)→(50,60)→(50,50) mm from the
/// top-left of the field:
/// * program_mode: ResetList, WritePort(1), Fiber_SetMo(1); list: ReadyMark, DelayTime(int(8*100)=800),
///   WritePort(1), JumpSpeed(int(2000*65535/110/1000)=1191)
/// * set_settings: QSwitchPeriod(round(20000/30)=667), MarkCurrent(round(50*0xFFF/100)=2048),
///   MarkSpeed(int(1000*65535/110/1000)=595), LaserOnDelay(100,0), LaserOffDelay(100,0), PolygonDelay(100/10=10)
/// * goto(int(50*65535/110)=29788, 29788) from (0x8000,0x8000): JumpTo(29788,29788,0,int(√2·2980)=4214)
/// * mark ×4 to 35746/29788 corners, distance 5958 each
/// * DelayTime(int(300/10)=30); rapid_mode: EndOfList, list padded with 0x8002, SetEndOfList(0),
///   ExecuteList, Fiber_SetMo(0), WritePort(0), GetMarkTime(3)
#[test]
fn square_job_matches_meerk40t_bytes() {
    let s = JczSettings::default();
    let (mut c, h) = sim_controller(s.clone());
    let job = square_job(1000.0, 50.0, 30.0);
    let (groups, total) = prepare_job(&job, &s).unwrap();
    c.run_job(&groups, 1, total, &mut |_| {}).unwrap();

    let expected: Vec<[u8; 12]> = vec![
        pack(0x8051, [0, 0, 0, 0, 0]),
        pack(0x8004, [800, 0, 0, 0, 0]),
        pack(0x8011, [1, 0, 0, 0, 0]),
        pack(0x8006, [1191, 0, 0, 0, 0]),
        pack(0x801B, [667, 0, 0, 0, 0]),
        pack(0x8012, [2048, 0, 0, 0, 0]),
        pack(0x800C, [595, 0, 0, 0, 0]),
        pack(0x8007, [100, 0, 0, 0, 0]),
        pack(0x8008, [100, 0, 0, 0, 0]),
        pack(0x800F, [10, 0, 0, 0, 0]),
        pack(0x8001, [29788, 29788, 0, 4214, 0]),
        pack(0x8005, [35746, 29788, 0, 5958, 0]),
        pack(0x8005, [35746, 35746, 0, 5958, 0]),
        pack(0x8005, [29788, 35746, 0, 5958, 0]),
        pack(0x8005, [29788, 29788, 0, 5958, 0]),
        pack(0x8004, [30, 0, 0, 0, 0]),
        pack(0x8002, [0, 0, 0, 0, 0]),
    ];
    let mut want = Vec::new();
    for e in &expected {
        want.extend_from_slice(e);
    }
    while want.len() < p::LIST_LEN {
        want.extend_from_slice(&pack(0x8002, [0; 5]));
    }
    // first bytes spelled out once, as a reader of the USB log would see them
    assert_eq!(&want[0..12], &[0x51, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    assert_eq!(&want[120..132], &[0x01, 0x80, 0x5C, 0x74, 0x5C, 0x74, 0x00, 0x00, 0x76, 0x10, 0x00, 0x00]);

    let st = h.lock().unwrap();
    let lists: Vec<_> = st.packets.iter().filter(|p| p.len() == p::LIST_LEN).collect();
    assert_eq!(lists.len(), 1, "one list packet");
    if lists[0][..] != want[..] {
        let got = p::describe(lists[0], 40).join("\n");
        let exp = p::describe(&want, 40).join("\n");
        panic!("list differs\n--- got\n{got}\n--- expected\n{exp}");
    }
    let seq: Vec<_> = singles(&st.packets);
    let expected_singles = vec![
        (p::RESET_LIST, [0; 5]),
        (p::WRITE_PORT, [1, 0, 0, 0, 0]),
        (p::FIBER_SET_MO, [1, 0, 0, 0, 0]),
        (p::SET_END_OF_LIST, [0; 5]),
        (p::EXECUTE_LIST, [0; 5]),
        (p::FIBER_SET_MO, [0; 5]),
        (p::WRITE_PORT, [0; 5]),
        (p::GET_MARK_TIME, [3, 0, 0, 0, 0]),
    ];
    assert_eq!(seq, expected_singles);
    // the list packet goes between Fiber_SetMo(1) and SetEndOfList, as in MeerK40t `_list_end`
    let pos_list = st.packets.iter().position(|p| p.len() == p::LIST_LEN).unwrap();
    let pos_mo = st.packets.iter().position(|p| unpack(p) == (p::FIBER_SET_MO, [1, 0, 0, 0, 0])).unwrap();
    let pos_eol = st.packets.iter().position(|p| p.len() == 12 && unpack(p).0 == p::SET_END_OF_LIST).unwrap();
    assert!(pos_mo < pos_list && pos_list < pos_eol);
    assert!(st.fired, "the simulator saw the laser fire for the mark job");
    assert!(!st.mo_open && st.port & 1 == 0, "laser off after the job");
}

#[test]
fn conversions_match_meerk40t() {
    assert_eq!(p::speed_units(1000.0, 110.0), 595);
    assert_eq!(p::speed_units(4000.0, 110.0), 2383);
    assert_eq!(p::period(30.0, 20000.0), 667);
    assert_eq!(p::period(20.0, 20000.0), 1000);
    assert_eq!(p::fiber_current(50.0), 2048); // round(2047.5) ties to even, like Python
    assert_eq!(p::fiber_current(100.0), 4095);
    assert_eq!(p::power_ratio(50.0, 20.0), 500);
    assert_eq!(p::py_round(2.5), 2);
    assert_eq!(p::signed(-5), [5, 0x8000]);
}

fn forbidden_for_light(cmds: &[(u16, [u16; 5])]) -> Vec<String> {
    let mut bad = Vec::new();
    for (op, v) in cmds {
        let what = match *op {
            p::L_MARK_TO => Some("listMarkTo"),
            p::L_LASER_ON_POINT => Some("listLaserOnPoint"),
            p::L_FIBER_OPEN_MO if v[0] != 0 => Some("listFiberOpenMO(1)"),
            p::FIBER_SET_MO if v[0] != 0 => Some("Fiber_SetMo(1)"),
            p::LASER_SIGNAL_ON => Some("LaserSignalOn"),
            p::WRITE_PORT | p::L_WRITE_PORT if v[0] & 1 != 0 => Some("port bit 0 on"),
            p::L_MARK_CURRENT | p::L_MARK_POWER_RATIO => Some("power"),
            _ => None,
        };
        if let Some(w) = what {
            bad.push(w.to_string());
        }
    }
    bad
}

#[test]
fn frame_uses_red_light_only_laser_off() {
    let s = JczSettings::default();
    let (mut c, h) = sim_controller(s.clone());
    let pts: Vec<_> = [[-20.0, -10.0], [20.0, -10.0], [20.0, 10.0], [-20.0, 10.0]].iter().map(|q| s.to_galvo(q[0], q[1], true).unwrap()).collect();
    c.trace_light(&pts, 4000.0, false).unwrap();
    let st = h.lock().unwrap();
    let all: Vec<_> = st.packets.iter().flat_map(|p| p.chunks(12).map(unpack).collect::<Vec<_>>()).collect();
    assert_eq!(forbidden_for_light(&all), Vec::<String>::new());
    let lc = list_cmds(&st.packets);
    assert!(lc.iter().any(|(op, v)| *op == p::L_WRITE_PORT && v[0] & (1 << 8) != 0), "red light bit 8 switched on in the list");
    let jumps = lc.iter().filter(|(op, _)| *op == p::L_JUMP_TO).count();
    assert_eq!(jumps, 5, "4 corners + back to the first");
    assert!(!st.fired && !st.mo_open && st.port & 1 == 0);
    assert_eq!(st.port & (1 << 8), 0, "red light off after a single frame");
}

#[test]
fn light_command_never_sets_laser_bit() {
    let (mut c, h) = sim_controller(JczSettings::default());
    c.light(true).unwrap();
    c.light(false).unwrap();
    let st = h.lock().unwrap();
    let s = singles(&st.packets);
    assert_eq!(s, vec![(p::WRITE_PORT, [0x100, 0, 0, 0, 0]), (p::WRITE_PORT, [0; 5])]);
}

#[test]
fn field_correction() {
    let mut s = JczSettings::default();
    assert_eq!(s.to_galvo(0.0, 0.0, false).unwrap(), (32767, 32767));
    assert_eq!(s.to_galvo(-5.0, 5.0, false).unwrap(), (29788, 35746));
    // offset
    s.offset_x = 10.0;
    assert_eq!(s.to_galvo(0.0, 0.0, false).unwrap().0, 38725); // (10+55)·65535/110 = 38725.2
    s.offset_x = 0.0;
    // rotation 90° CCW: (10,0) → (0,10)
    s.angle = 90.0;
    assert_eq!(s.to_galvo(10.0, 0.0, false).unwrap(), (32767, 38725));
    s.angle = 0.0;
    // sign
    s.galvo1.sign = -1.0;
    assert_eq!(s.to_galvo(10.0, 0.0, false).unwrap().0, 26809); // 45·595.77 = 26809.8
    s.galvo1.sign = 1.0;
    // galvo 1 drives Y
    s.galvo1_is_x = false;
    assert_eq!(s.to_galvo(10.0, 0.0, false).unwrap(), (32767, 38725));
    s.galvo1_is_x = true;
    // scale
    s.galvo1.scale = 0.5;
    assert_eq!(s.to_galvo(10.0, 0.0, false).unwrap().0, 35746);
    s.galvo1.scale = 1.0;
    // bulge acts with the square of the other axis: nothing on the axis, full at the edge
    s.galvo1.bulge = 0.9;
    assert_eq!(s.to_galvo(50.0, 0.0, false).unwrap().0, 62556); // 105·595.77
    assert_eq!(s.to_galvo(50.0, 55.0, false).unwrap().0, 59577); // 50·0.9 = 45 → 100·595.77
    s.galvo1.bulge = 1.0;
    // trapezoid grows linearly with the other axis
    s.galvo1.trapezoid = 1.2;
    assert_eq!(s.to_galvo(10.0, 55.0, false).unwrap().0, 39916); // 12 mm → 67·595.77
    assert_eq!(s.to_galvo(10.0, 0.0, false).unwrap().0, 38725);
    s.galvo1.trapezoid = 1.0;
    // skew shears by the other axis
    s.galvo1.skew = 1.1;
    assert_eq!(s.to_galvo(0.0, 20.0, false).unwrap().0, 33959); // 2 mm → 57·595.77
    s.galvo1.skew = 1.0;
    // red dot offset only for the guide light
    s.red_dot.offset_x = 1.0;
    assert_eq!(s.to_galvo(0.0, 0.0, true).unwrap().0, 33363);
    assert_eq!(s.to_galvo(0.0, 0.0, false).unwrap().0, 32767);
    // outside the field: refused, never clamped
    let e = s.to_galvo(60.0, 0.0, false).unwrap_err();
    assert!(e.contains("außerhalb"), "{e}");
}

#[test]
fn correction_is_applied_to_the_job() {
    let mut s = JczSettings::default();
    s.galvo1.sign = -1.0;
    s.offset_y = 2.0;
    let (mut c, h) = sim_controller(s.clone());
    let (g, t) = prepare_job(&square_job(1000.0, 50.0, 30.0), &s).unwrap();
    c.run_job(&g, 1, t, &mut |_| {}).unwrap();
    let st = h.lock().unwrap();
    let first_jump = list_cmds(&st.packets).into_iter().find(|(op, _)| *op == p::L_JUMP_TO).unwrap();
    // x = −5 with sign −1 → +5 mm → 60·595.77 = 35746; y = −5 + 2 = −3 mm → 52·595.77 = 30980.2
    assert_eq!((first_jump.1[0], first_jump.1[1]), (35746, 30980));
}

#[test]
fn settings_from_the_lightburn_device_are_read() {
    // values of the JCZFiber (LMC4) device in LightBurn on the owner's computer, as the app maps them
    let json = r#"{
        "field": 110, "offsetX": 0, "offsetY": 0, "angle": 271.25,
        "galvo1": {"scale": 0.979689002, "bulge": 0.975799978, "skew": 1, "trapezoid": 1, "sign": -1},
        "galvo2": {"scale": 0.979689002, "bulge": 0.975799978, "skew": 1, "trapezoid": 1, "sign": 1},
        "galvo1IsX": true, "laserType": "fiber", "fiberType": "0", "minFreq": 1, "maxFreq": 200,
        "pulseWidthEnabled": false,
        "redDot": {"offsetX": 0, "offsetY": 0, "scaleX": 1, "scaleY": 1},
        "ports": {"startMark": 14, "startFrame": 14, "stopMark": -1, "doorProtect": -1, "redLight": -1},
        "jumpSpeed": 4000, "laserOnDelay": 0, "laserOffDelay": 0, "polygonDelay": 0, "endDelay": 0,
        "minJumpDelay": 100, "maxJumpDelay": 200, "maxJumpDistance": 10,
        "lightburn": {"Laser_OpenMODelay": 2000, "RedLightJumpDelay": 100, "StartMarkBitHigh": true}
    }"#;
    let s: JczSettings = serde_json::from_str(json).unwrap();
    s.validate().unwrap();
    assert_eq!(s.light_bit(), 8);
    assert_eq!(s.open_mo_delay_us(), 2000.0);
    assert_eq!(s.red_jump_delay(), 100);
    for (x, y) in [(-50.0, -50.0), (50.0, -50.0), (50.0, 50.0), (-50.0, 50.0), (0.0, 0.0)] {
        s.to_galvo(x, y, false).unwrap();
    }
    // jump delays: 100 µs for short jumps, 200 µs from 10 mm on
    let (mut c, h) = sim_controller(s.clone());
    let (g, t) = prepare_job(&square_job(1000.0, 50.0, 30.0), &s).unwrap();
    c.run_job(&g, 1, t, &mut |_| {}).unwrap();
    let st = h.lock().unwrap();
    let lc = list_cmds(&st.packets);
    assert!(lc.iter().any(|(op, v)| *op == p::L_JUMP_DELAY && (100..=200).contains(&v[0])));
    assert!(lc.contains(&(p::L_DELAY_TIME, [200, 0, 0, 0, 0])), "open MO delay 2000 µs = 200 × 10 µs");
}

#[test]
fn out_of_range_parameters_are_refused() {
    let s = JczSettings::default();
    let e = prepare_job(&square_job(1000.0, 50.0, 250.0), &s).err().unwrap();
    assert!(e.contains("Frequenz 250 kHz") && e.contains("1–200 kHz"), "{e}");
    let e = prepare_job(&square_job(1000.0, 50.0, 0.5), &s).err().unwrap();
    assert!(e.contains("Frequenz"), "{e}");
    let e = prepare_job(&square_job(1000.0, 101.0, 30.0), &s).err().unwrap();
    assert!(e.contains("Leistung 101 %"), "{e}");
    let e = prepare_job(&square_job(1e9, 50.0, 30.0), &s).err().unwrap();
    assert!(e.contains("zu hoch"), "{e}");
    let mut j = square_job(1000.0, 50.0, 30.0);
    j.groups[0].params.passes = 0;
    assert!(prepare_job(&j, &s).is_err());
    let mut j = square_job(1000.0, 50.0, 30.0);
    j.groups[0].polylines[0][1] = [80.0, 0.0];
    assert!(prepare_job(&j, &s).err().unwrap().contains("außerhalb"));
}

#[test]
fn stop_flag_ends_the_job_in_the_controller() {
    let s = JczSettings::default();
    let (mut c, h) = sim_controller(s.clone());
    let stop = c.stop.clone();
    let (g, t) = prepare_job(&big_job(), &s).unwrap();
    let th = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(30));
        stop.store(true, std::sync::atomic::Ordering::SeqCst);
    });
    let r = c.run_job(&g, 1, t, &mut |_| {});
    th.join().unwrap();
    assert_eq!(r, Err(JczError::Stopped("Gestoppt.".into())));
    c.abort().unwrap();
    let st = h.lock().unwrap();
    let s = singles(&st.packets);
    let stop_pos = s.iter().position(|(op, _)| *op == p::STOP_EXECUTE).expect("StopExecute sent");
    assert!(s[stop_pos..].contains(&(p::FIBER_SET_MO, [0; 5])));
    assert!(!st.mo_open && st.port & 1 == 0);
}

fn big_job() -> JczJob {
    let mut polylines = Vec::new();
    for i in 0..400 {
        let y = -40.0 + i as f64 * 0.2;
        polylines.push((0..200).map(|k| [-40.0 + k as f64 * 0.4, y]).collect());
    }
    JczJob {
        groups: vec![JczGroup { params: square_job(1000.0, 20.0, 30.0).groups[0].params.clone(), polylines }],
        repeat: 1,
    }
}

#[derive(Default)]
struct Collect {
    logs: Mutex<Vec<String>>,
    statuses: Mutex<Vec<JczStatus>>,
}

impl Events for Collect {
    fn status(&self, s: &JczStatus) {
        self.statuses.lock().unwrap().push(s.clone());
    }
    fn log(&self, line: &str) {
        self.logs.lock().unwrap().push(line.to_string());
    }
}

fn wait_idle(l: &Link, limit: Duration) -> Duration {
    let t = Instant::now();
    while l.status().busy {
        assert!(t.elapsed() < limit, "still busy after {limit:?}");
        std::thread::sleep(Duration::from_millis(2));
    }
    t.elapsed()
}

#[test]
fn jcz_stop_interrupts_marking_at_once() {
    let ev = Arc::new(Collect::default());
    let link = Link::connect(None, JczSettings::default(), true, ev.clone()).unwrap();
    assert!(link.status().simulated && link.status().connected);
    link.mark(&big_job()).unwrap();
    std::thread::sleep(Duration::from_millis(150));
    assert!(link.status().busy, "the job is running");
    link.stop();
    let took = wait_idle(&link, Duration::from_secs(2));
    assert!(took < Duration::from_millis(300), "stop took {took:?}");
    let st = link.status();
    assert_eq!(st.error, None);
    let sim = link.sim.clone().unwrap();
    let s = sim.lock().unwrap();
    assert!(!s.mo_open && s.port & 1 == 0, "laser off after stop");
    assert!(ev.logs.lock().unwrap().iter().any(|l| l.contains("Abgebrochen – Laser aus")));
}

#[test]
fn looped_frame_runs_until_stop_and_never_fires() {
    let ev = Arc::new(Collect::default());
    let link = Link::connect(None, JczSettings::default(), true, ev.clone()).unwrap();
    link.frame(&[[-10.0, -10.0], [10.0, -10.0], [10.0, 10.0], [-10.0, 10.0]], 3000.0, true).unwrap();
    std::thread::sleep(Duration::from_millis(200));
    assert!(link.status().busy && link.status().mode == "frame");
    assert!(link.mark(&square_job(1000.0, 50.0, 30.0)).is_err(), "no marking while the frame runs");
    link.stop();
    wait_idle(&link, Duration::from_secs(2));
    let sim = link.sim.clone().unwrap();
    let s = sim.lock().unwrap();
    let all: Vec<_> = s.packets.iter().flat_map(|p| p.chunks(12).map(unpack).collect::<Vec<_>>()).collect();
    let bad = forbidden_for_light(&all[..]);
    // init sends no laser command either; everything from connect to stop is light only
    assert_eq!(bad, Vec::<String>::new());
    assert!(!s.fired);
    assert!(s.packets.iter().filter(|p| p.len() == p::LIST_LEN).count() > 3, "the frame kept streaming");
}

#[test]
fn foot_pedal_is_reported_but_never_fires() {
    let mut s = JczSettings::default();
    s.ports.start_mark = 14;
    let ev = Arc::new(Collect::default());
    let link = Link::connect(None, s, true, ev.clone()).unwrap();
    link.sim.as_ref().unwrap().lock().unwrap().inputs = 1 << 14;
    std::thread::sleep(Duration::from_millis(1200));
    assert!(ev.logs.lock().unwrap().iter().any(|l| l.contains("Fußschalter (Eingang 14)")));
    let sim = link.sim.clone().unwrap();
    let st = sim.lock().unwrap();
    assert!(!st.fired);
    assert!(list_cmds(&st.packets).iter().all(|(op, _)| *op != p::L_MARK_TO));
    assert_eq!(link.status().inputs, 1 << 14);
}

#[test]
fn open_door_refuses_marking() {
    let mut s = JczSettings::default();
    s.ports.door_protect = 3;
    let ev = Arc::new(Collect::default());
    let link = Link::connect(None, s, true, ev).unwrap();
    link.sim.as_ref().unwrap().lock().unwrap().inputs = 1 << 3;
    link.mark(&square_job(1000.0, 50.0, 30.0)).unwrap();
    wait_idle(&link, Duration::from_secs(2));
    let e = link.status().error.unwrap();
    assert!(e.contains("Tür offen (Eingang 3)"), "{e}");
    assert!(!link.sim.as_ref().unwrap().lock().unwrap().fired);
}

#[test]
fn disconnect_turns_the_laser_off() {
    let ev = Arc::new(Collect::default());
    let mut link = Link::connect(None, JczSettings::default(), true, ev).unwrap();
    link.mark(&square_job(1000.0, 50.0, 30.0)).unwrap();
    wait_idle(&link, Duration::from_secs(2));
    assert_eq!(link.status().progress, 1.0);
    let sim = link.sim.clone().unwrap();
    link.close();
    let st = sim.lock().unwrap();
    let s = singles(&st.packets);
    let tail: Vec<u16> = s[s.len() - 5..].iter().map(|(op, _)| *op).collect();
    assert_eq!(tail, vec![p::STOP_EXECUTE, p::FIBER_SET_MO, p::WRITE_PORT, p::LASER_SIGNAL_OFF, p::DISABLE_LASER]);
    assert!(!st.mo_open && st.port == 0);
}

#[test]
fn simulator_is_marked_in_the_status() {
    let ev = Arc::new(Collect::default());
    let link = Link::connect(None, JczSettings::default(), true, ev.clone()).unwrap();
    let j = serde_json::to_value(link.status()).unwrap();
    assert_eq!(j["simulated"], true);
    assert_eq!(j["connected"], true);
    assert!(j.get("error").is_none());
    assert!(ev.logs.lock().unwrap().iter().any(|l| l.contains("Seriennummer")));
}

/// Real USB, read only: lists the JCZ boards on this computer (opens nothing, never fires).
/// `cargo test -p kizamubeam jcz_list_boards_on_this_pc -- --ignored --nocapture`
#[test]
#[ignore]
fn jcz_list_boards_on_this_pc() {
    let boards = super::transport::list_boards().unwrap();
    println!("JCZ boards: {boards:?}");
}
