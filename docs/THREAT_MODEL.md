# Threat model

## Assets

Prospect inputs, exported results, provider keys, and the local pairing token are sensitive. No asset is intentionally sent to a findEmm-operated service.

## Controls

- Server binds to `127.0.0.1`, requires `x-findemm-token`, and rejects other origins.
- Token is randomly generated on first run in ignored `server/data/config.json`; extension storage retains it only on the local browser profile.
- Audit records hash/redact input identifiers and never log contact values or tokens.
- Company-page lookups validate HTTP(S), require allowed robots rules, cap body size, throttle per hostname, and never authenticate.
- Extension uses minimum MV3 permissions and displays source evidence/status.

## Non-goals

This is not a consent-management platform, an email delivery service, or a guarantee that any contact detail is current or lawful to use.
