// ftms.js  —  Web Bluetooth helper for FTMS + (optional) Zwift custom service
// Public API:
//   await ftms.connect({ nameHint?: string, log?: fn });
//   await ftms.disconnect();
//   ftms.on('ibd', handler)            // Indoor Bike Data updates {speedKph, cadenceRpm, powerW, raw}
//   ftms.on('ack', handler)            // { forOpcode, result }  (result 0x01 = success)
//   ftms.on('log', handler)            // string log lines
//   await ftms.setErgWatts(watts);
//   await ftms.setSim({ gradePct, crr=0.004, cwa=0.51, windMps=0 });
//   await ftms.rampSim({ fromPct, toPct, stepPct=1, dwellMs=5000, crr=0.004, cwa=0.51, windMps=0 });
//   const features = await ftms.readFeatures(); // returns {raw:DataView, hex:string}
//
// Notes:
// - Always sends Request Control (0x00) then waits for FTMS CP indication ACK, before each operation.
// - Uses writeValueWithResponse for FTMS Control Point (0x2AD9), as required by spec.
// - Parses FTMS Indoor Bike Data (0x2AD2) for speed/cadence/power (common flags pattern we observed).

// ---------- UUIDs ----------
const UUID = {
  FTMS_SERVICE:  '00001826-0000-1000-8000-00805f9b34fb',
  FTMS_FEATURE:  '00002acc-0000-1000-8000-00805f9b34fb', // read
  FTMS_IBD:      '00002ad2-0000-1000-8000-00805f9b34fb', // notify
  FTMS_TRAINING: '00002ad3-0000-1000-8000-00805f9b34fb', // read/notify (not essential)
  FTMS_CP:       '00002ad9-0000-1000-8000-00805f9b34fb', // indicate + write
  FTMS_STATUS:   '00002ada-0000-1000-8000-00805f9b34fb', // notify (not essential)
  // Zwift custom service (optional to read RidingData / SyncTX)
  ZWIFT_SERVICE: '00000001-19ca-4651-86e5-fa29dcdd09d1',
  ZWIFT_RD:      '00000002-19ca-4651-86e5-fa29dcdd09d1', // notify
  ZWIFT_CP:      '00000003-19ca-4651-86e5-fa29dcdd09d1', // write w/o response
  ZWIFT_SYNC:    '00000004-19ca-4651-86e5-fa29dcdd09d1', // indicate
};

// ---------- small utils ----------
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const hex = (buf) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join(' ').toUpperCase();
const u16le = (dv, o) => dv.getUint16(o, true);
const s16le = (dv, o) => dv.getInt16(o, true);

class Emitter {
  constructor(){ this.map = new Map(); }
  on(evt, fn){ (this.map.get(evt) ?? this.map.set(evt,[]).get(evt)).push(fn); return () => this.off(evt, fn); }
  off(evt, fn){ const arr = this.map.get(evt); if (!arr) return; const i = arr.indexOf(fn); if (i>=0) arr.splice(i,1); }
  emit(evt, data){ (this.map.get(evt)||[]).forEach(fn => { try{ fn(data); }catch(e){ console.error(e);} }); }
}

// ---------- Core FTMS client ----------
class FTMSClient extends Emitter {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.chars = {};
    this._pendingAck = null; // {opcode, resolve, reject, timer}
    this._log = (s) => this.emit('log', s);
  }

  async connect({ nameHint, log } = {}) {
    if (log) this._log = log;
    this._log('Requesting Bluetooth device…');

    const options = nameHint
      ? { filters: [{ namePrefix: nameHint }], optionalServices: [UUID.FTMS_SERVICE, UUID.ZWIFT_SERVICE] }
      : { 
          filters: [{ services: [UUID.FTMS_SERVICE] }], 
          optionalServices: [UUID.FTMS_SERVICE, UUID.ZWIFT_SERVICE] 
        };

    this.device = await navigator.bluetooth.requestDevice(options);
    this.device.addEventListener('gattserverdisconnected', () => {
      this._log('[BT] Disconnected');
      this.emit('disconnected');
    });

    this._log(`Connecting to GATT server for ${this.device.name ?? '(no name)'}…`);
    this.server = await this.device.gatt.connect();

    // Get FTMS service & characteristics
    const ftms = await this.server.getPrimaryService(UUID.FTMS_SERVICE);
    const [feature, ibd, cp] = await Promise.all([
      ftms.getCharacteristic(UUID.FTMS_FEATURE),
      ftms.getCharacteristic(UUID.FTMS_IBD),
      ftms.getCharacteristic(UUID.FTMS_CP),
    ]);
    this.chars.feature = feature;
    this.chars.ibd = ibd;
    this.chars.cp = cp;

    // Optional chars
    try { this.chars.status = await ftms.getCharacteristic(UUID.FTMS_STATUS); } catch {}
    try { this.chars.training = await ftms.getCharacteristic(UUID.FTMS_TRAINING); } catch {}

    // Optional Zwift service (not required)
    try {
      const zw = await this.server.getPrimaryService(UUID.ZWIFT_SERVICE);
      try { this.chars.zwiftRD = await zw.getCharacteristic(UUID.ZWIFT_RD); } catch {}
      try { this.chars.zwiftCP = await zw.getCharacteristic(UUID.ZWIFT_CP); } catch {}
      try { this.chars.zwiftSync = await zw.getCharacteristic(UUID.ZWIFT_SYNC); } catch {}
    } catch {}

    // Subscribe
    await this._subscribeAll();
    this._log('[BT] Connected & subscribed.');
    this.emit('connected', { name: this.device.name, id: this.device.id });
  }

  async disconnect() {
    try {
      if (this._pendingAck?.reject) {
        this._pendingAck.reject(new Error('Disconnected'));
        this._clearPendingAck();
      }
      if (this.device?.gatt.connected) this.device.gatt.disconnect();
    } finally {
      this.device = null;
      this.server = null;
      this.chars = {};
    }
  }

  async _subscribeAll() {
    // IBD notifications
    if (this.chars.ibd) {
      await this.chars.ibd.startNotifications();
      this.chars.ibd.addEventListener('characteristicvaluechanged', (e) => {
        const dv = e.target.value;
        const parsed = this._parseIbd(dv);
        this.emit('ibd', parsed);
      });
      this._log('Subscribed: FTMS Indoor Bike Data (notify).');
    }
    // CP indications (ACKs)
    if (this.chars.cp) {
      await this.chars.cp.startNotifications();
      this.chars.cp.addEventListener('characteristicvaluechanged', (e) => this._onCpIndication(e.target.value));
      this._log('Subscribed: FTMS Control Point (indicate).');
    }
    // Optional: FTMS status / training
    if (this.chars.status) {
      await this.chars.status.startNotifications().catch(()=>{});
    }
    if (this.chars.training) {
      await this.chars.training.startNotifications().catch(()=>{});
    }
    // Optional Zwift RidingData / SyncTX
    if (this.chars.zwiftRD) {
      await this.chars.zwiftRD.startNotifications().catch(()=>{});
      this.chars.zwiftRD.addEventListener('characteristicvaluechanged', (e) => {
        this._log(`NOTIFY ZWIFT RidingData: "${hex(e.target.value.buffer)}"`);
      });
      this._log('Subscribed: Zwift Riding Data (notify).');
    }
    if (this.chars.zwiftSync) {
      await this.chars.zwiftSync.startNotifications().catch(()=>{});
      this.chars.zwiftSync.addEventListener('characteristicvaluechanged', (e) => {
        this._log(`IND from Zwift SyncTX: ${hex(e.target.value.buffer)}`);
      });
      this._log('Subscribed: Zwift SyncTX (indicate).');
    }
  }

  // --------- Public ops ---------
  async readFeatures() {
    const v = await this.chars.feature.readValue();
    return { raw: v, hex: hex(v.buffer) };
  }

  async setErgWatts(watts) {
    if (!Number.isFinite(watts) || watts < 0 || watts > 2000) {
      throw new Error('ERG watts must be 0..2000');
    }
    const payload = new Uint8Array([0x05, watts & 0xFF, (watts >> 8) & 0xFF]); // 0x05 + u16le watts
    this._log(`WRITE FTMS TargetPower ${watts}W (0x05): ${hex(payload)} `);
    await this._writeCpAndWaitAck(0x05, payload);
  }

  /**
   * setSim({ gradePct, crr, cwa, windMps })
   * gradePct: number in %, signed. crr: rolling resistance (e.g., 0.004), cwa: drag area (e.g., 0.51), windMps: headwind +, tailwind -.
   */
  async setSim({ gradePct, crr = 0.004, cwa = 0.51, windMps = 0 }) {
    const grade = Math.round(gradePct * 100);               // 0.01% units -> s16
    const crrByte = Math.round(crr * 10000);                // 1/10000 -> u8
    const cwaByte = Math.round(cwa * 100);                  // 1/100 -> u8
    const wind = Math.round(windMps * 100);                 // 0.01 m/s -> s16

    // bounds clamp
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const windClamped  = clamp(wind, -32768, 32767);
    const gradeClamped = clamp(grade, -32768, 32767);
    const crrClamped   = clamp(crrByte, 0, 255);
    const cwaClamped   = clamp(cwaByte, 0, 255);

    const payload = new Uint8Array(1 + 2 + 2 + 1 + 1); // 0x11 + wind s16 + grade s16 + crr u8 + cwa u8
    const dv = new DataView(payload.buffer);
    dv.setUint8(0, 0x11);
    dv.setInt16(1, windClamped, true);
    dv.setInt16(3, gradeClamped, true);
    dv.setUint8(5, crrClamped);
    dv.setUint8(6, cwaClamped);

    this._log(`WRITE FTMS SIM wind=${(windClamped/100).toFixed(2)}m/s grade=${(gradeClamped/100).toFixed(2)}% crr=${(crrClamped/10000).toFixed(4)} cw=${(cwaClamped/100).toFixed(2)}: ${hex(payload)} `);
    await this._writeCpAndWaitAck(0x11, payload);
  }

  /**
   * rampSim({ fromPct, toPct, stepPct=1, dwellMs=5000, crr=0.004, cwa=0.51, windMps=0 })
   */
  async rampSim({ fromPct, toPct, stepPct = 1, dwellMs = 5000, crr = 0.004, cwa = 0.51, windMps = 0 }) {
    const dir = Math.sign(toPct - fromPct) || 1;
    const steps = [];
    for (let g = fromPct; dir > 0 ? g <= toPct : g >= toPct; g += stepPct * dir) {
      steps.push(parseFloat(g.toFixed(2)));
      if ((dir > 0 && g + stepPct > toPct) || (dir < 0 && g - stepPct < toPct)) {
        if (steps[steps.length - 1] !== toPct) steps.push(toPct);
        break;
      }
    }
    this._log(`=== RAMP ${fromPct}% -> ${toPct}% by ${stepPct}% every ${(dwellMs/1000).toFixed(1)}s ===`);
    for (const g of steps) {
      this._log(`--- RAMP step -> ${g.toFixed(2)}% ---`);
      await this.setSim({ gradePct: g, crr, cwa, windMps });
      await delay(dwellMs);
    }
    this._log('RAMP complete.');
  }

  // --------- Private helpers ---------
  async _requestControl(timeoutMs = 4000) {
    const pkt = new Uint8Array([0x00]); // Request Control
    this._log(`WRITE FTMS RequestControl (0x00): ${hex(pkt)}`);
    await this._writeCpAndWaitAckDirect(0x00, pkt, timeoutMs);
  }

  async _writeCpAndWaitAckDirect(opcode, payload, timeoutMs = 4000) {
    // Direct write without auto-requesting control (used by _requestControl itself)
    if (this._pendingAck) {
      this._pendingAck.reject?.(new Error('Replaced by new command'));
      this._clearPendingAck();
    }
    const p = new Promise(async (resolve, reject) => {
      this._pendingAck = {
        opcode,
        resolve: (res) => { this._clearPendingAck(); resolve(res); },
        reject:  (err) => { this._clearPendingAck(); reject(err); },
        timer: setTimeout(() => {
          this._clearPendingAck();
          reject(new Error('ACK timeout'));
        }, timeoutMs),
      };
      try {
        await this.chars.cp.writeValue(payload);
      } catch (e) {
        try {
          this._log(`writeValue failed (${e.message}), trying writeValueWithoutResponse…`);
          await this.chars.cp.writeValueWithoutResponse(payload);
        } catch (e2) {
          this._clearPendingAck();
          reject(e2);
        }
      }
    });
    const res = await p;
    this.emit('ack', { forOpcode: opcode, result: res });
    if (res !== 0x01) throw new Error(`FTMS result 0x${res.toString(16).padStart(2,'0')}`);
    return res;
  }

  async _writeCpAndWaitAck(opcode, payload, { timeoutMs = 4000 } = {}) {
    // Many trainers want us to own control before other ops.
    if (opcode !== 0x00) { // not REQUEST_CONTROL
      try { 
        await this._requestControl(timeoutMs); 
      } catch (e) { 
        this._log(`WARN: RequestControl failed: ${e.message}`); 
      }
    }

    // Clear any lingering waiter (should not happen in serialized flow)
    if (this._pendingAck) {
      this._pendingAck.reject?.(new Error('Replaced by new command'));
      this._clearPendingAck();
    }
    const p = new Promise(async (resolve, reject) => {
      // arm waiter
      this._pendingAck = {
        opcode,
        resolve: (res) => { this._clearPendingAck(); resolve(res); },
        reject:  (err) => { this._clearPendingAck(); reject(err); },
        timer: setTimeout(() => {
          this._clearPendingAck();
          reject(new Error('ACK timeout'));
        }, timeoutMs),
      };
      try {
        // Prefer writeValue; fall back if it throws (like trainer_debug.html)
        await this.chars.cp.writeValue(payload);
      } catch (e) {
        try {
          this._log(`writeValue failed (${e.message}), trying writeValueWithoutResponse…`);
          await this.chars.cp.writeValueWithoutResponse(payload);
        } catch (e2) {
          this._clearPendingAck();
          reject(e2);
        }
      }
    });
    const res = await p; // res = result code byte
    this.emit('ack', { forOpcode: opcode, result: res });
    if (res !== 0x01) throw new Error(`FTMS result 0x${res.toString(16).padStart(2,'0')}`);
    return res;
  }

  _clearPendingAck() {
    if (this._pendingAck?.timer) clearTimeout(this._pendingAck.timer);
    this._pendingAck = null;
  }

  _onCpIndication(dv) {
    const bytes = new Uint8Array(dv.buffer);
    const op = bytes[0]; // should be 0x80 (response code)
    if (op === 0x80 && bytes.length >= 3) {
      const forOpcode = bytes[1];
      const result = bytes[2];
      this._log(`IND from FTMS CP: ${hex(bytes)}  (ACK for 0x${forOpcode.toString(16).padStart(2,'0')}, result=0x${result.toString(16).padStart(2,'0')})`);
      if (this._pendingAck && this._pendingAck.opcode === forOpcode) {
        this._pendingAck.resolve(result);
        return;
      }
    }
    // If it wasn't our pending ack, just surface it
    this.emit('ack', { forOpcode: bytes[1], result: bytes[2] });
  }

  _parseIbd(dv) {
    // Parse using proven trainer_debug.html approach
    // Flags are 2 bytes, then speed/cadence/power in sequence
    let off = 0;
    const flags = dv.getUint16(off, true); off += 2;  // Fix: Read 2 bytes for flags
    
    let speedKph = null, cadenceRpm = null, powerW = null;
    
    // Fix: Use correct offsets after 2-byte flags
    if (dv.byteLength >= off + 2) { speedKph = dv.getUint16(off, true) / 100; off += 2; }
    if (dv.byteLength >= off + 2) { cadenceRpm = dv.getUint16(off, true) / 2; off += 2; }
    if (dv.byteLength >= off + 2) { powerW = dv.getInt16(off, true); off += 2; }
    
    const obj = {
      flags,
      raw: hex(dv.buffer),
      speedKph,    // Keep null if not present
      cadenceRpm,  // Keep null if not present  
      powerW       // Keep null if not present
    };
    this._log(`NOTIFY FTMS IBD: ${JSON.stringify(obj)}`);
    return obj;
  }
}

// Export a ready-to-use singleton, plus the class if you want multiple instances
export const ftms = new FTMSClient();
export { FTMSClient };
