# Contributing

Keep findEmm local-first and evidence-based. New sources must document their permission basis, terms/robots behavior, rate limit, evidence mapping, retention, opt-out behavior, and tests. Do not add login scraping, background LinkedIn collection, automated navigation, CAPTCHA/payload bypasses, breach datasets, generated person-email guesses, personal-phone guessing, or claims of identity verification from mailbox validation.

Active-page capture must remain click-triggered and limited to allowlisted visible fields. The recruiter reviews captured values before Research; capture must not infer a company domain, extract contacts from LinkedIn, or run as a persistent content script.

Provider keys belong only in the local server process environment. Never enable Hunter in this product without written commercial approval, never place provider keys in extension storage or URLs, and treat provider `451` responses as opt-outs. A provider-valid mailbox remains identity-unconfirmed, expires to stale after 90 days, and cannot enable drafting until a recruiter explicitly confirms the person match locally.

Durable provider suppression must remain fail-closed and HMAC-only: store no plaintext identity or contact values, check suppression before provider access, and purge matching cleartext records and queued outreach after an opt-out. Company-page fetching must remain off unless both explicit approval and an exact-domain allowlist are configured.

Keep team handoffs minimal and fail-closed: export only the chosen list and allowlisted fields, never unrelated opt-out identities, the pairing token, notes, or queued drafts; authenticate the versioned envelope; preview before one confirmed write; regenerate imported IDs; merge only exact profile URLs; downgrade shared identity/provider claims; and preserve any existing local `Do not contact` state. Do not describe file handoff as hosted sync, identity, access control, revocation, audit, or sender verification.

Keep transient batches memory-only, capped at 20, and expired after one hour or server restart. Preserve shortlist search/filter behavior and confirmed single-record deletion without adding a hosted database.

Before a pull request run `npm test`, `npm run check`, and `npm run build`. Exercise clicked capture, local confirmation, opt-out purge, shortlist deletion, and handoff downgrade paths. Browser visual verification remains a separate release gate. Do not commit `server/data/`, pairing tokens, suppression files, exports, or contact details.
