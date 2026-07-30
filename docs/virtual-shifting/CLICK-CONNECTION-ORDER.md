# Zwift Click — Connection Order (the recipe that works)

> **Status: VALIDATED end-to-end from a browser, 2026-07-29.** A link established this way
> held **20+ minutes** while streaming button events at ~10 Hz. Every step below is here
> because omitting it, or doing it in a different order, was observed to fail.
>
> Evidence: [`experiments/16-bridged-zwift-session-capture.md`](experiments/16-bridged-zwift-session-capture.md).
> Byte-level reference: [`PROTOCOLS.md`](PROTOCOLS.md) §1.

---

## The one thing that matters most

**A Click pair has a PRIMARY and a SECONDARY, and you must connect the primary.**

The two units are physically identical, both advertise as `Zwift Click`, and Chrome's device
chooser shows no address — so you cannot tell them apart before connecting. But they behave
completely differently:

| | **Primary** | **Secondary** |
|---|---|---|
| Button frames (`0x23`) | streams at ~10 Hz | **never sends any** |
| Battery notifications | every ~5 s | never |
| Initial-status frame (`0x2a`) | within 0.5 s of handshake | never |
| Link lifetime | **20+ minutes and counting** | **dies at ~61 s, every time** |
| Carries the *other* unit's buttons | **yes** — this is the relay | n/a |

**The entire "Click disconnects after 44–90 s" problem was connecting to the secondary.** It is
not an authorisation timeout, not an idle timeout, and not a missing keep-alive — five
controlled runs showed 60.5–61.2 s regardless of handshake form or extra writes.

Because the primary relays the secondary's buttons, **you only ever need one BLE connection.**

---

## Connection order

Each step's rationale is a thing that actually went wrong.

### 1. Wake the unit — press any button on it

Asleep, a Click does not advertise and will not appear in the chooser. There is no way to wake
it from software. This must be UX copy: *"Press a button on your Click, then tap Connect."*

### 2. `requestDevice()` — one user gesture, per connection

```js
navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'Zwift Click' }],
  optionalServices: [ZWIFT_SVC_FC82, ZWIFT_SVC_LEGACY, 'battery_service', 'device_information'],
})
```

Both service UUIDs must be listed: the advertised one is firmware-dependent
(`0xFC82` post-Jan-2025, `00000001-19ca-…` before). Anything not pre-declared throws
`SecurityError` on access, so declare both and probe.

### 3. `gatt.connect()`, then discover

Probe `0xFC82` first, then the legacy `19ca` service.

### 4. Subscribe BEFORE the handshake

Order matters — the handshake reply arrives on a characteristic you must already be listening
to, and the reply is an **indication**, not a notification:

| Characteristic | Subscribe as | Why |
|---|---|---|
| `00000002-19ca-…` ASYNC | notifications | button frames, battery, status |
| `00000004-19ca-…` SYNC TX | **indications** | the handshake reply lands here |

Zwift also subscribes to `0100`, `0101`, `0102` and `2A19`. Harmless to copy; none of them
ever carried traffic in any capture, so none are required.

> Web Bluetooth's `startNotifications()` picks notify-vs-indicate from the characteristic's
> own properties — you do not choose. `0004` is indicate-only, so it works out.

### 5. Write the handshake to `00000003-19ca-…` SYNC RX

```
52 69 64 65 4F 6E 02 03      "RideOn" + 02 03
```

`writeValueWithoutResponse` — that is the only write property this characteristic has.

- **What Zwift sends is 8 bytes**, not the bare 6 (`experiments/16` §2). The device echoes
  back **exactly what you sent**, so a bare write gets a bare echo.
- **Either form works.** Five controlled runs found no behavioural difference. Use `02 03`
  anyway: it is what the official client does, and matching it costs nothing.
- The trainer answers `RideOn 02 02` — its reply is *not* a mirror. Clicks mirror.

### 6. Confirm you are on the primary — the first 3 seconds tell you

After the handshake the primary sends, within ~0.5 s:

1. `2a 08 …` initial status
2. `ff 05 00 …` status frame carrying the **serial as ASCII**
3. `23 08 ff ff ff ff 0f` button frames, continuously

**If you get silence, you are on the secondary.** Disconnect, tell the user to press a button
on the *other* unit, and connect that one. This is a normal, expected branch — not an error.

Do not wait 61 s to find out. Three seconds of silence after a successfully-echoed handshake is
enough to decide.

### 7. Read buttons

`0x23` frames, field 1 = a 32-bit **active-low** bitmap varint: a **cleared** bit means pressed.
All-released is `23 08 ff ff ff ff 0f`. Full bit map in [`PROTOCOLS.md`](PROTOCOLS.md) §1.4;
in code, `OUR_CLICK_BUTTONS` in `src/services/clickButtons.ts`.

Frames repeat at ~10 Hz while a button is held, so **edge-detect** (not-pressed → pressed) or
you will get ten events per press.

---

## Identifying which unit you are on

`2A25` Serial Number String is **on the Web Bluetooth blocklist** — Chrome refuses the read
*and* hides the characteristic, so the Device Information service appears to contain only
`2A26`/`2A27`/`2A29`. You cannot read the serial directly from a browser.

Two routes that work:

- **`device.id`** — Chrome's opaque, origin-scoped identifier. Not an address, but stable per
  unit on the same origin, so it answers "is this the same one as last time?".
- **Sniff the serial off the air.** The `FF 05` status frame carries it as ASCII hex
  (`34C4593D51A6`), and the `3c` device-information reply as `0A-…`/`0B-…`. Passive, so it
  cannot perturb anything. Serial tail → advertised address by setting the two high bits:
  `34C4593D51A6` → `f4:c4:59:3d:51:a6`.

---

## Things that do NOT help — do not add them

Each was tested and produced no change in link lifetime (`experiments/16` Phases 2–3):

| Thing | Verdict |
|---|---|
| `ff 04 00` after the handshake | ❌ sent twice on a live link; still dropped at 61.2 s |
| `RideOn 02 03` vs bare `RideOn` | ❌ no difference — 60.5–61.2 s either way |
| Writing to `0100` / `0101` / `0102` | ❌ Zwift never writes them either, in any capture |
| A client-side keepalive | ❌ the primary needs none; the secondary ignores traffic |
| Pairing/bonding | ❌ no SMP anywhere; the link is unencrypted throughout |

---

## Failure modes, and what they actually mean

| Symptom | Cause | Fix |
|---|---|---|
| Device not in the chooser | asleep | press a button on it first |
| Connects, handshake echoes, then total silence, drops at ~61 s | **you are on the secondary** | connect the other unit |
| `SecurityError` reading a characteristic | not in `optionalServices`, or blocklisted (`2A25`) | declare it, or use a workaround above |
| Ten events per button press | not edge-detecting | compare against the previous bitmap |
| `shiftUp` never fires | watching the wrong bit — the "+" paddle is `0x1000`, and `0x20` is the B button | see `OUR_CLICK_BUTTONS` |
| Reply has no status bytes | you sent the bare 6-byte `RideOn`; the device mirrors | expected, harmless |
