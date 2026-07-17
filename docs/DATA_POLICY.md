# Data and source policy

findEmm processes recruiter-supplied prospect data locally. The loopback server listens only on `127.0.0.1`; it has no account system and no hosted collection endpoint. Saved records and the local API pairing token are encrypted in Chrome local storage with AES-GCM using a passphrase held only while the popup is open.

Active-page capture happens only after the recruiter clicks Capture. On a supported LinkedIn profile or company page, the extension reads an allowlisted subset of visible fields: name, title, company, and profile URL when available. It does not capture in the background, infer a company domain, or obtain contact details from LinkedIn. The recruiter reviews every captured value before separately requesting Research.

Permitted sources are recruiter-supplied data, APIs for which the operator has authorization, and explicitly approved company pages. findEmm does not generate person-specific email addresses or phone numbers. A source result retains its retrieval time, type, scope, status, and source URL/evidence when available. Company-page contact channels are company-level and never establish person ownership.

Automated company-page fetching is disabled by default. It runs only when the operator confirms approval and configures an exact-domain allowlist. The local API then applies its robots policy check, host spacing, response-size limit, and unauthenticated HTTPS-only contact-page request.

The optional Hunter Email Finder adapter is disabled by default and may be enabled only with a user-owned API key and written commercial approval for this use. A recruiter-requested lookup sends the person's name and company domain, or a user-captured LinkedIn profile handle, to Hunter. Every route requires a full name and company domain locally so a person opt-out can suppress both handle and name/domain aliases. Capture does not infer the domain. The key stays in the local server environment and results are cached in memory for 24 hours.

Hunter's `valid` status describes mailbox validity, not ownership by the selected person. findEmm calls a provider-valid result fresh only when Hunter supplies a valid verification date no more than 90 days old. Missing, unknown, accept-all, future-dated, or older status remains unverified or stale. Provider, verification date, retrieval time, and source evidence stay visible. A recruiter must explicitly confirm the person match locally before an address can open an editable draft. This confirmation is a local human attestation, not proof of consent or provider-verified identity.

Provider `451` person opt-outs and provider-blocked domains fail closed before other enrichment. For a person opt-out, the local server persists only normalized keyed HMAC aliases in `server/data/suppressions.json`, future matching provider lookups are blocked, and the extension purges matching cleartext identity, contacts, and queued outreach. For a blocked domain, the server retains only a keyed domain HMAC and blocks later provider access for that domain. No plaintext identity, domain, or contact value is stored in the suppression file. Suppression HMACs remain until the operator deletes that file; deleting it removes the durable safeguard.

Encrypted team handoff is user-directed file export and import, not hosted synchronization. Only the list explicitly selected for export is encrypted with a separate share passphrase; unrelated opt-out identities, local API pairing tokens, notes, and queued drafts are excluded. Import is previewed before an explicit merge, exact profile URLs deduplicate, ambiguous identity matches remain conflicts, and existing local `Do not contact` state overrides incoming contacts. Person-specific provider, recruiter-confirmed, or imported claims are downgraded to `Shared contact — recheck required` on handoff and cannot enable drafting without a new local confirmation.

The user controls how a handoff file leaves the device. Send the file and passphrase through separate channels. A downloaded handoff remains on disk until the user deletes it. findEmm does not identify or verify a sender or recipient and provides no account system, role-based access control, revocation, or audit log for handoffs.

Forbidden: authentication-gated scraping, CAPTCHA bypass, paywall bypass, credential sharing, breach data, generated person-contact guesses, private/personal-phone discovery, and suppression of provider limits. Respect applicable privacy, employment, anti-spam, and data-protection law before contacting anyone.

The shortlist provides confirmed single-record deletion, and the vault control deletes all encrypted extension records and its saved pairing token. Delete exported handoff and CSV files separately from the file system. The local server keeps at most 20 transient batches in memory; each expires after one hour or disappears sooner on restart or capacity eviction.

For privacy questions, contact framessab@gmail.com.
