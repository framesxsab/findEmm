# Chrome Web Store listing copy

## Name

findEmm — Local Prospect Research

## Summary

Click to capture visible recruiter-profile fields, review sourced contacts, and manage an encrypted local placement shortlist.

## Detailed description

findEmm is a local-first prospect-research companion for placement and recruiting teams. Capture starts only when you click Capture on a supported active LinkedIn profile or company page. It reads visible name, title, company, and profile URL fields when available, then lets you review them before a separate Research request. It does not run in the background or extract contact details from LinkedIn.

- Review every contact with its source, retrieval date, confidence, scope, and status.
- Keep company channels, recruiter-supplied values, provider mailbox results, and shared claims clearly separate; never invent a person-specific email or phone number.
- Treat a fresh Hunter-valid mailbox as identity-unconfirmed; results become stale after 90 days.
- Require a local recruiter confirmation of the person match before opening an editable email draft. findEmm never sends email automatically.
- Save encrypted local records, notes, lists, role-change history, recommendations, and draft-only follow-up steps.
- Search and filter a local placement shortlist, open saved records, or confirm deletion of one record.
- Export exactly one selected list as a passphrase-protected handoff file and preview it before merging on another device. Pairing tokens, unrelated opt-out identities, notes, and queued drafts stay out of the file; shared identity claims require a new local check.
- Export record evidence as CSV.

findEmm does not scrape in the background, automate signed-in navigation, bypass paywalls/CAPTCHAs/robots rules, use breach data, generate person-email guesses, guess personal phone numbers, sell contact data, or send outreach automatically.

Hunter Email Finder is optional and off by default. If the local-API operator supplies an authorized Hunter account and confirms written commercial approval, a recruiter-requested lookup sends either the captured LinkedIn profile handle or the person's name and company domain to Hunter under the operator's account and provider terms. Provider credentials remain in the local server environment.

Every Hunter route requires the full name and company domain locally so opt-outs match both handle and name/domain aliases. Capture does not infer the company domain; the recruiter enters it before a Hunter lookup.

Automated company-contact-page fetching is also off by default. It requires explicit operator approval plus an exact-domain allowlist and returns only company-level channels.

Provider opt-outs are represented locally by keyed HMAC suppression values rather than plaintext identities; matching cleartext local records and queued outreach are purged. Encrypted handoff is a user-transferred file, not hosted sync. findEmm provides no user identity, role-based access control, revocation, audit logging, or sender verification. Send the file and passphrase separately and delete downloaded files when finished.

## Single purpose

Enable recruiter-directed, evidence-backed prospect research and encrypted local placement-shortlist management from user-reviewed fields and permitted sources.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `storage` | Store consent and the encrypted local vault. |
| `activeTab` | Read the active page only after the recruiter clicks Capture. |
| `scripting` | Execute the one-time visible-field capture after that explicit click; no persistent content script is installed. |
| `http://127.0.0.1:4317/*` | Call the recruiter-run local companion API; no hosted findEmm API is used. |

## Privacy Practices dashboard answers

- Handles: personal information, user-selected website content/page metadata, user-generated notes, authentication information for the local companion API, user-directed encrypted handoff files, and optional transmission of requested lookup fields to Hunter.
- Purpose: only the extension's recruiter-research, safety, export, and local record-management features.
- Sale/advertising: no.
- Human review: no developer or publisher human review; the user reviews and confirms their own records.
- Privacy policy: use the public URL serving `webstore/privacy-policy.html` after publisher contact details are confirmed.
