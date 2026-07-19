# findEmm Privacy Policy

Effective date: 2026-07-19

findEmm is a local-first Chrome extension for recruiter-directed prospect research. This policy applies to the extension and its local companion API.

## Data we handle

findEmm handles prospect details that a recruiter enters or explicitly captures, including names, company details, job titles, public profile URLs, work email addresses, business phone numbers, notes, list placement, role-change history, follow-up state, and source evidence. It also handles the local API pairing token entered by the recruiter.

Capture occurs only after the user clicks Capture on a supported active LinkedIn profile or company page. It reads an allowlisted subset of visible name, title, company, and profile URL fields when available. It does not run in the background, infer a company domain, capture contact details from LinkedIn, or generate person-specific email or phone guesses. The user reviews captured fields before separately choosing Research.

The user may explicitly choose a recruiter-controlled CSV or ATS/CRM export. findEmm locally parses allowlisted name, company, title, domain, LinkedIn `/in/` person URL, explicitly labeled work email, recruiter-asserted business phone, source evidence, list, and `Do not contact` fields. It rejects generic, personal, private, home, mobile, cell, and WhatsApp email/phone columns and does not retain unknown columns. The raw file is not uploaded or stored by findEmm.

## How data is used and shared

Data is used only to provide findEmm's user-facing prospect-research, safety, shortlist, export, and draft-support features. findEmm does not operate a hosted collection service, sell data, use data for advertising, train models on it, or allow the developer or publisher to review user data.

CSV parsing, validation, and preview occur in the extension. Before the user can confirm additions, only each accepted row's name, company domain, and LinkedIn person URL are sent to the authenticated local companion API on `127.0.0.1` for comparison with keyed suppression HMACs. This check makes no Hunter or website request, is not retained as a batch, never returns HMAC values, and returns only the row index plus `checkable`, `suppressed`, `matchedLinkedIn`, `matchedPerson`, and `blockedDomain` booleans. Matching person opt-outs are excluded and matching saved plaintext is deleted immediately using only the identity-alias type that matched. Existing `Do not contact` state also fails closed across first-name + last-name + domain middle-name/profile variants. Other normalized additions are encrypted only after explicit confirmation. Imported contacts remain identity-unchecked and cannot enable a draft until the local recruiter independently confirms the person-email match.

When the user clicks Research, the reviewed fields and any work contact they entered are sent to the recruiter-run local API at `127.0.0.1`. A recruiter-entered person email or phone is rejected unless the normalized identity has a canonical LinkedIn `/in/` URL or a full name plus company domain, so the durable suppression store can be checked. Automated company-contact-page lookup is off by default. If the operator explicitly enables it and configures an exact-domain allowlist, the local API may request that allowlisted company's public contact page and label any result as a company-level channel.

Hunter Email Finder is optional and off by default. If the operator supplies a user-owned Hunter key and confirms written commercial approval, a requested lookup sends either the user-captured LinkedIn profile handle or the person's name and company domain to Hunter. Every route requires a full name and company domain locally so provider opt-outs can suppress both handle and name/domain aliases; Capture does not infer the domain. The local API checks durable person suppression before enrichment and again after asynchronous enrichment, before returning a result or storing a transient batch. Provider credentials remain in the local server environment. Hunter mailbox validity does not prove identity: a valid result is treated as fresh for at most 90 days and remains identity-unconfirmed until the local recruiter confirms the person match. That confirmation enables only an editable local mail draft; findEmm never sends a message automatically.

When the user chooses encrypted team handoff, findEmm creates a passphrase-protected file containing only the selected list. Unrelated opt-out identities, the local API pairing token, notes, and queued drafts are excluded. Provider-valid, recruiter-confirmed, imported, and other person-specific claims become `Shared contact — recheck required` for the recipient. The user decides whether and how to transfer the file; findEmm does not upload it. Handoff import uses the same local suppression screen before preview and confirmation: known opt-outs are excluded, matching saved plaintext is deleted immediately, and active records without a durable suppression alias are excluded. Other additions are previewed before a confirmed merge; an unresolved incoming `Do not contact` identity blocks the whole file, and an existing local DNC overrides incoming contacts, including first-name + last-name + domain middle-name/profile variants.

Import suppression checks are point-in-time comparisons across the local companion and Chrome storage, not a single transaction. findEmm screens again after an import write, rolls incoming additions back if that final screen fails, and purges a newly matched identity. Valid matched results are retained in the popup before stale preview checks; matching actions and handoff export stay blocked if deletion cannot be saved. Every vault unlock screens all saved records in bounded batches and keeps sensitive actions disabled if reconciliation fails; active uncheckable legacy records remain quarantined from contact/export while Research can repair the missing alias. A suppression recorded after the final completed screen can still require later reconciliation, and a vault revision change disables stale open popups until re-unlock.

## Storage and security

Saved records and the local API pairing token are encrypted in Chrome local storage with AES-GCM. The key is derived from the user's vault passphrase with PBKDF2 and is held only while the extension popup is open. The vault passphrase is never stored or transmitted. Encrypted writes and deletion are serialized by the extension background worker and compare a storage revision so a stale popup cannot overwrite a newer vault. Unlock-time suppression reconciliation must succeed before sensitive record actions are enabled. Local API traffic is limited to the user's machine.

On a provider person opt-out, the local server stores only normalized keyed SHA-256 HMAC aliases in ignored local server data, blocks future matching provider access, and the extension purges matching cleartext identity, contact, and queued-outreach data. A provider-blocked domain is retained only as a keyed domain HMAC and blocks later provider access for that domain. The suppression file contains no plaintext identity, domain, or contact value, and suppression storage fails closed if unavailable or corrupt.

The handoff passphrase is separate from the vault passphrase and is not stored. Users should transfer the file and passphrase through separate channels. Handoff is encrypted file transfer, not hosted synchronization: findEmm provides no user identity, role-based access control, revocation, audit logging, or sender verification. Anyone who obtains both a handoff file and its passphrase can decrypt it.

## Retention and deletion

Saved records remain in the encrypted local vault until the user confirms deletion, clears the entire vault, or a known provider opt-out causes matching saved plaintext to be deleted during Research or import screening. Clearing the vault also removes its saved local API pairing token. Source CSV files, downloaded CSV exports, and handoff files remain on disk until the user deletes them separately.

The local API retains at most 20 transient batches in memory. Each expires after one hour, on restart, or sooner through oldest-first capacity eviction. Provider lookup caches are memory-only and disappear on restart.

Suppression HMACs persist in local `server/data/suppressions.json` so later matching provider lookups remain blocked. The operator can delete that local file with other local server data, but doing so removes the durable opt-out safeguard.

## Contact

For privacy and support questions, contact framessab@gmail.com.
