# Security Policy

## Scope

VERO-BAAMBI is a client-side browser application. Optional remote metering features require a lightweight Node.js broker for metrics relay.

Core audio processing occurs locally. Preferences are stored in browser localStorage.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

If you discover a security issue, please report it by emailing:

**david@thast.se**

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment

You will receive acknowledgement within 48 hours.

## Security Considerations

### Audio Data
- All audio processing occurs in-browser
- No audio data is transmitted externally
- No audio is recorded or stored

### LocalStorage
- Only user preferences are stored (UI state, target levels)
- No sensitive data is persisted
- Clear via browser settings or `localStorage.clear()`

### Remote Features

The probe/broker/client architecture for distributed metering:

- Requires explicit user opt-in (disabled by default)
- Transmits numerical metrics only — no audio content
- Local-network by default; configurable for WAN with appropriate security
- Broker binds to `0.0.0.0`; deploy behind firewall for untrusted networks
- Optional access control, enforced only when configured (unset = trusted-network mode):
  - `VERO_CONTROL_TOKEN` — required token; clients supply it as a `?token=…` query
    parameter on the WebSocket URL, or an `Authorization: Bearer …` header
  - `VERO_ALLOWED_ORIGINS` — comma-separated `Origin` allow-list, mitigating
    cross-site WebSocket hijacking from an unrelated browser tab
- Per-message payload size is capped (512 KB) to bound abuse

When exposing the broker beyond a trusted LAN (e.g. the Fly.io deployment), set
both `VERO_CONTROL_TOKEN` and `VERO_ALLOWED_ORIGINS`.

See `broker/server.js` and `docs/deployment.md` for configuration.
