# Security Policy

## Scope

VERO-BAAMBI is a client-side browser application with no server component.
It processes audio locally and stores preferences in browser localStorage.

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

### Future Remote Features
When probe/client features are implemented:
- Will require explicit opt-in
- Will transmit metrics only, never audio content
- Will be local-network only by default
