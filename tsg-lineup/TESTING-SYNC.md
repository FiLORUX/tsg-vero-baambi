# WebRTC Sync Testing Checklist

## ✅ Pre-Testing

- [ ] Två devices på samma nätverk (WiFi/Ethernet)
- [ ] Modern browser (Chrome/Edge/Safari/Firefox)
- [ ] Console access (F12 eller Cmd+Option+I)

## 🧪 Test 1: Basic Connection

### Master Device (Laptop)
1. Öppna: `file:///Users/david/Documents/GitHub/tsg/tsg-lineup.html?room=test&role=master&state=sync`
2. Öppna console (Cmd+Option+I)
3. Verifiera:
   - [ ] `[SYNC] Auto-initializing as MASTER for room: test`
   - [ ] `[MASTER] Offer ready. Show this as QR code: eyJ...`
   - [ ] Sync status top-right: `🟡 MASTER` (connecting)
4. Kopiera HELA offer-strängen från console

### Slave Device (iPad/Phone/Second Browser)
1. Öppna: `file:///Users/david/Documents/GitHub/tsg/tsg-lineup.html?room=test&state=sync`
2. Öppna console
3. Kör: `initSlave("PASTE_OFFER_HERE")`
4. Verifiera:
   - [ ] `[SLAVE] DataChannel open - receiving timecode`
   - [ ] `[SLAVE] Answer ready. Show this as QR code: eyJ...`
5. Kopiera answer-strängen

### Complete Handshake (Master)
1. På master console, kör: `acceptAnswer("PASTE_ANSWER_HERE")`
2. Verifiera:
   - [ ] `[MASTER] DataChannel open - broadcasting timecode`
   - [ ] `[MASTER] Answer accepted - connection established`
   - [ ] Master UI: `🟢 MASTER`
   - [ ] Slave UI: `🟢 SLAVE`
   - [ ] Slave UI: `Δ X.Xms (X.Xf)` (offset display)

## 🎯 Test 2: Timecode Sync Verification

### Visual Check
- [ ] Båda devices visar SYNC mode (efter LIP SYNC)
- [ ] Timecode uppdateras simultant på båda screens
- [ ] Countdown (om aktivt) synkar exakt

### Audio/Video Sync Check
- [ ] Flash (vit nederst) händer simultant på båda devices
- [ ] Pip (1 kHz tone) hörs samtidigt på båda devices
- [ ] Emphasis pip (1.2 kHz, varje 4:e sekund) synkar

### Offset Measurement
Slave visar offset top-right: `Δ 23.5ms (1.2f)`

**Förväntade värden:**
- Local network (WiFi): 5-50ms
- Same machine (two browsers): 1-10ms
- Cross-internet: 50-200ms

**Acceptabelt:** ±2 frames (< 80ms @ 25fps, < 67ms @ 30fps)

## 🔧 Test 3: Latency Compensation

### iPad Speakers (~120ms latency)
Slave URL: `?room=test&latency=-0.120&state=sync`

Verifiera:
- [ ] Offset kompenseras (borde minska med ~120ms)
- [ ] Audio pip synkar bättre med visual flash

### Bluetooth Speakers (~200ms latency)
Slave URL: `?room=test&latency=-0.200&state=sync`

## 🐛 Test 4: Error Handling

### WebRTC Not Supported
1. Öppna i gammal browser (IE11)
2. Verifiera:
   - [ ] `[MASTER] WebRTC not supported in this browser`
   - [ ] UI: `🔴 MASTER` (failed status)

### Connection Loss
1. Stäng master tab
2. På slave, verifiera:
   - [ ] `[SLAVE] DataChannel closed`
   - [ ] UI: `⚪ SLAVE` (disconnected)
   - [ ] Offset försvinner från UI

### Invalid SDP Data
1. Kör `initSlave("invalid_data")`
2. Verifiera graceful error message

## 📊 Test 5: Stress Test

### Network Conditions
- [ ] Test på WiFi (2.4GHz)
- [ ] Test på WiFi (5GHz)
- [ ] Test på Ethernet
- [ ] Test med hög network load (download fil samtidigt)

### Device Count
- [ ] 1 master + 1 slave
- [ ] 1 master + 2 slaves (öppna två slave tabs) - LIMITATION: Endast 1-to-1 stöd just nu

### Long Running
- [ ] Kör sync i 5 minuter
- [ ] Kör sync i 30 minuter
- [ ] Verifiera offset drift över tid (ska stabiliseras av exponential smoothing)

## 🎬 Test 6: State Synchronization

### Master State Changes
1. Master i SYNC mode
2. Tryck Space → MOS mode
3. Verifiera slave följer till MOS
4. Tryck Space → STEREO IDENT
5. Verifiera slave följer

### Countdown Sync
Master URL: `?room=test&role=master&state=sync&countdown=00:00:10:00`

Verifiera:
- [ ] Slave får countdown från master
- [ ] Countdown räknar ner simultant
- [ ] Nollblink synkar exakt

## ✅ Success Criteria

**PASS om:**
- ✅ Connection etableras utan errors
- ✅ Timecode synkar inom ±2 frames
- ✅ Audio/video sync pattern matchar
- ✅ Offset stabiliseras efter 2-3 sekunder
- ✅ State changes propagerar till slave
- ✅ UI indicators reflekterar korrekt status

**FAIL om:**
- ❌ Connection timeout (>30 sekunder)
- ❌ Offset drift >5 frames över tid
- ❌ Audio/video misalignment >100ms
- ❌ State changes inte synkar
- ❌ Crashes eller console errors

## 🐛 Known Limitations

1. **1-to-1 only**: Endast en slave per master (WebRTC mesh för multi-slave kommer i framtiden)
2. **Manual handshake**: Måste kopiera/klistra SDP i console (QR code UI kommer)
3. **Same network recommended**: Cross-internet fungerar men kräver TURN server för vissa NAT
4. **Browser compatibility**: Kräver modern browser med WebRTC support

## 📝 Bug Report Template

Om du hittar buggar, rapportera med:
```
Device: [iPad Pro 2021 / MacBook Pro M1 / etc]
Browser: [Safari 17.2 / Chrome 120 / etc]
Network: [WiFi 5GHz / Ethernet / etc]
URL: [full URL med params]
Console errors: [paste errors here]
Expected: [vad du förväntade dig]
Actual: [vad som hände]
Steps to reproduce: [1. 2. 3.]
```

---

**Test completed:** ___________
**Tester:** ___________
**Result:** PASS / FAIL
**Notes:** ___________
