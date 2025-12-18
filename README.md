# TSG VERO BAAMBI

**Browser-based broadcast metering for production workflows**

VERO BAAMBI is a local-first, dependency-minimised implementation of:

- Loudness metering (EBU R 128 / ITU-R BS.1770)
- Maximum true-peak level (ITU-R BS.1770)
- Quasi-peak PPM-style metering (EBU Tech 3205)
- Stereo correlation / vectorscope-style visualisation

## Name

- **VERO** — from Latin *vērus* (“true”)
- **BAAMBI** — Broadcast Audio Alignment & Metering for Broadcast Infrastructure

Part of the **TSG Suite**.

## Scope

Designed for verification and confidence monitoring in production environments where:

- the browser is an acceptable runtime,
- reproducible behaviour matters more than convenience plumbing,
- offline operation is a requirement, not a contingency.

## Design constraints

- **Local operation is the default.** Core metering runs entirely in the browser.
- **No third-party telemetry.** No analytics, tracking, or “phone-home” behaviour.
- **Static deploy.** Served as plain files; no bundling pipeline is required to run.
- **Repository-visible behaviour.** Claims here should be confirmable by reading the code and running the included verification.

## Quick start

Serve the repository root (ES modules require a local server):

~~~bash
python3 -m http.server 8080
# then open http://localhost:8080/
~~~

## Verification

A minimal verification harness exists to sanity-check core maths and metering behaviour:

~~~bash
node tests/metering-verification.js
~~~

For interactive checks with reference signals, see:

- `tools/verify-audio.html`
- `docs/verification.md`

## Remote metering (optional)

Remote metering is implemented as a probe → broker → client pipeline.

- **Opt-in.** Remote transport is disabled unless explicitly enabled in the UI.
- **Metrics-only.** The transport is intended to carry numeric meter values, not audio content.
- **Local-first networking.** The broker is expected to run on localhost or a trusted LAN.

Security note:

- The reference broker in `broker/` is a minimal relay. Treat it as **unauthenticated** unless you add authentication/TLS/reverse-proxy controls. Do not expose it directly to the public internet.

## Repository layout

~~~text
tsg-vero-baambi/
├── index.html                  # ESM entry point
├── probe.html                  # Remote probe UI
├── broker/                     # Metrics relay (Node.js)
└── src/
    ├── metering/               # Loudness, true peak, PPM-style, correlation
    ├── generators/             # Test signal generation
    ├── ui/                     # Meter renderers / vectorscope views
    ├── app/                    # App wiring + render/update loops
    └── remote/                 # Probe/broker/client transport modules
~~~

## Standards references

Primary standards and EBU documents referenced by this project:

- EBU R 128: Audio loudness normalisation & permitted maximum level  
  https://tech.ebu.ch/docs/r/r128.pdf

- EBU Tech 3341: “EBU Mode” metering to supplement EBU R 128  
  https://tech.ebu.ch/docs/tech/tech3341.pdf

- EBU Tech 3342: Loudness Range (LRA) algorithm  
  https://tech.ebu.ch/docs/tech/tech3342.pdf

- ITU-R BS.1770-5: Algorithms to measure audio programme loudness and true-peak audio level  
  https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf

- EBU Tech 3205: The EBU standard peak-programme meter (QPPM)  
  (Referenced by EBU R 128; obtain via EBU documentation channels.)

Latin reference for the name:

- Lewis & Short (public-domain lexicon): *vērus* — “true, real, actual, genuine”  
  https://alatius.com/ls/index.php?l=vero

## Licence

MIT Licence. Copyright 2025 David Thåst.
Maintained by David Thåst · https://github.com/FiLORUX
