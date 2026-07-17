# Threat model

## Assets

Captured prospect fields, recruiter inputs, source evidence, shortlist records, exported files, share passphrases, provider keys, suppression HMACs, and the local pairing token are sensitive. No asset is intentionally sent to a findEmm-operated service.

## Controls

- Server binds to `127.0.0.1`, requires `x-findemm-token`, and rejects other origins.
- Browser CORS permits only Chrome-extension origins; command-line requests without an Origin header still require the pairing token.
- Token is randomly generated on first run in ignored `server/data/config.json`; extension storage retains it only on the local browser profile.
- Active-page capture requires a click, accepts supported LinkedIn profile/company URLs, returns only allowlisted visible fields, and requires recruiter review before Research. No persistent content script or background collection is used.
- Optional Hunter credentials exist only in the local server process environment, are sent in `X-API-KEY`, and never enter Chrome storage, URLs, logs, or API responses.
- Hunter remains off without both a user-owned key and operator confirmation of written commercial approval. Consent names Hunter and the transmitted fields.
- A fresh provider-valid mailbox requires Hunter `valid` plus a verification date no more than 90 days old. It remains an identity-unconfirmed person candidate; only a separate local recruiter confirmation makes an address draftable.
- Provider opt-outs are checked before lookup and retained only as keyed SHA-256 HMAC values in the local suppression file. Suppression storage fails closed; cleartext matching extension records, contacts, and queued outreach are purged.
- Company-page lookup is off by default and requires explicit approval plus an exact-domain allowlist. Enabled requests apply HTTPS, agent-specific robots rules, response caps, host spacing, and no authentication.
- Extension uses minimum MV3 permissions and displays source evidence/status.
- Hunter calls are memory-cached, in-flight deduplicated, and serialized below the documented provider rate limit. Provider opt-outs stop enrichment before company-page lookup.
- Transient batch responses are memory-only, expire after one hour or restart, and are capped at 20 batches with oldest-first capacity eviction.
- Team handoffs use a versioned, authenticated AES-GCM envelope and a transient share passphrase. The encrypted payload is allowlisted and excludes the local API pairing token, notes, and queued drafts.
- Import caps file and record counts, sanitizes fields and URLs, regenerates external IDs, and makes no vault write until the user reviews a preview and confirms one merge.
- Only the explicitly chosen list is exported; unrelated opt-out identities are excluded. Imported person-specific claims are downgraded for local recheck. Exact profile URLs may merge automatically, ambiguous identity matches do not, and an existing local `Do not contact` state remains sticky.
- The searchable local shortlist exposes saved-state counts and supports confirmation-gated deletion of one record or deletion of the full encrypted vault.
- Users are warned to send the file and passphrase through separate channels and to delete the downloaded file after use.

## Non-goals

This is not a consent-management platform, identity-verification service, email delivery service, or guarantee that any contact detail is current or lawful to use. Mailbox validity does not prove person ownership; recruiter confirmation does not prove outreach consent. Handoffs are not hosted sync and provide no user identity, role-based access control, revocation, audit logging, or sender verification. Anyone with both the file and passphrase can decrypt it, and findEmm cannot revoke a copied file. Suppression HMACs reduce retained plaintext but remain sensitive if the separate local suppression secret or config file is compromised.
