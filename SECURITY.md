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
- Optional token authentication via `VERO_CONTROL_TOKEN` environment variable

See `broker/server.js` and `docs/deployment.md` for configuration.
