// Zwift Click raw-frame probe — answers "are bytes arriving at all?" independently of the app.
//
// Why this exists: the app's panel only lights up for frames that `parseClickFrame` classifies as
// `buttons` (message type 0x23 with byte1 == 0x08). Three different failures all look identical
// from the outside — a dark panel:
//
//   1. no notifications at all            → secondary unit, or the handshake never landed
//   2. notifications arriving, wrong type  → app sees frames, ignores them, and does NOT print the
//                                            "secondary unit" hint either, because `sawFrame` is
//                                            true. This is the gap that made the 2026-08-05 paddle
//                                            failure unexplainable.
//   3. buttons frames arriving, bit map wrong → panel lights the wrong control
//
// This logs EVERY byte on the ASYNC characteristic with no interpretation, so the three separate.
//
// Paste into the app console, then CLICK THE BUTTON it adds (top-right). The button is required:
// `requestDevice` needs transient user activation, which console execution does not provide.
//
// Usage:  import('/@fs/Users/nford/Playground/ftms/docs/virtual-shifting/experiments/click-raw-probe.js')
;(() => {
  const SVC_FC82 = 0xfc82
  const SVC_LEGACY = '00000001-19ca-4651-86e5-fa29dcdd09d1'
  const ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1'
  const SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1'
  const SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1'
  const RIDE_ON = Uint8Array.from([0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e, 0x02, 0x03])

  const hex = (u8) =>
    Array.from(u8)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ')

  document.getElementById('click-raw-probe')?.remove()
  const btn = document.createElement('button')
  btn.id = 'click-raw-probe'
  btn.textContent = '🔍 Click raw probe'
  btn.style.cssText =
    'position:fixed;top:8px;right:8px;z-index:2147483647;padding:10px 16px;' +
    'background:#7c3aed;color:#fff;border:0;border-radius:10px;font:600 14px system-ui;cursor:pointer'
  document.body.appendChild(btn)

  const counts = { total: 0, buttons: 0, battery: 0, other: {} }

  btn.onclick = async () => {
    btn.disabled = true
    btn.textContent = 'probing…'
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'Zwift Click' }],
        optionalServices: [SVC_FC82, SVC_LEGACY, 'battery_service'],
      })
      console.log('[RAW] device:', device.name, device.id)
      device.addEventListener('gattserverdisconnected', () =>
        console.warn('[RAW] GATT DISCONNECTED at', new Date().toISOString())
      )

      const server = await device.gatt.connect()
      console.log('[RAW] gatt connected')

      let svc, which
      for (const uuid of [SVC_FC82, SVC_LEGACY]) {
        try {
          svc = await server.getPrimaryService(uuid)
          which = uuid
          break
        } catch {
          /* next */
        }
      }
      if (!svc) throw new Error('no Zwift service — is this a Click?')
      console.log('[RAW] service:', which === SVC_FC82 ? '0xFC82 (new fw)' : 'legacy 19ca')

      // Enumerate what the device actually exposes. If ASYNC is missing, everything downstream
      // is moot and the recipe needs revisiting for this firmware.
      const chars = await svc.getCharacteristics()
      console.log(
        '[RAW] characteristics:',
        chars.map((c) => `${c.uuid} {${Object.entries(c.properties).filter(([, v]) => v).map(([k]) => k).join(',')}}`)
      )

      const async_ = await svc.getCharacteristic(ASYNC)
      const syncTx = await svc.getCharacteristic(SYNC_TX)
      const syncRx = await svc.getCharacteristic(SYNC_RX)

      async_.addEventListener('characteristicvaluechanged', (e) => {
        const u8 = new Uint8Array(
          e.target.value.buffer,
          e.target.value.byteOffset,
          e.target.value.byteLength
        )
        counts.total += 1
        const type = u8[0]
        if (type === 0x23 && u8.length > 2 && u8[1] === 0x08) counts.buttons += 1
        else if (type === 0x19) counts.battery += 1
        else counts.other[type] = (counts.other[type] ?? 0) + 1
        // Every frame, verbatim. Volume is fine: the device streams ~10 Hz only while held.
        console.log(`[RAW ASYNC] len=${u8.length} type=0x${type.toString(16)}  ${hex(u8)}`)
      })
      syncTx.addEventListener('characteristicvaluechanged', (e) => {
        const u8 = new Uint8Array(
          e.target.value.buffer,
          e.target.value.byteOffset,
          e.target.value.byteLength
        )
        console.log(`[RAW SYNC-TX] ${hex(u8)}`)
      })

      // Subscribe BEFORE the handshake: the reply is an indication on SYNC TX, and a
      // subscription made afterwards misses it (CLICK-CONNECTION-ORDER.md).
      await async_.startNotifications()
      await syncTx.startNotifications()
      console.log('[RAW] subscribed ASYNC + SYNC TX')

      await syncRx.writeValueWithoutResponse(RIDE_ON)
      console.log('[RAW] handshake written — NOW PRESS EVERY BUTTON, one at a time')

      btn.textContent = '● probing — press buttons'
      btn.style.background = '#059669'

      window.__clickRaw = {
        counts,
        device,
        summary() {
          console.log('[RAW] summary:', JSON.parse(JSON.stringify(counts)))
          if (counts.total === 0) {
            console.warn(
              '[RAW] ZERO frames. Either this is the SECONDARY unit of the pair (its link ' +
                'publishes nothing and dies at ~61 s — connect the other one), or the handshake ' +
                'was not accepted.'
            )
          } else if (counts.buttons === 0) {
            console.warn(
              '[RAW] Frames ARE arriving but none are button frames (type 0x23 / byte1 0x08). ' +
                'The app would show a dark panel AND no "secondary unit" hint. Compare the type ' +
                'bytes above against PROTOCOLS.md §1.4.'
            )
          } else {
            console.log('[RAW] Button frames are arriving — the BLE path is fine.')
          }
          return counts
        },
        stop() {
          device.gatt?.disconnect()
          btn.remove()
        },
      }
      console.log('[RAW] when done: __clickRaw.summary()   /   __clickRaw.stop()')
    } catch (err) {
      console.error('[RAW] failed:', err)
      btn.disabled = false
      btn.textContent = '🔍 Click raw probe (retry)'
      btn.style.background = '#dc2626'
    }
  }

  console.log('[RAW] probe ready — click the purple button (top-right). A gesture is required.')
})()
