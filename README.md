# findEmm

Open-source, local-first recruiter research for Chrome. findEmm lets a recruiter import recruiter-controlled ATS/CRM contacts or click to capture visible LinkedIn profile fields, review them, research configured sources, and manage an encrypted placement shortlist.

Product goal: replace a pile of disconnected spreadsheets and email-finder extensions with one compliant placement workflow—intake, capture, evidence, deduplication, shortlist, successor suggestions, and team handoff. It is not a way to evade provider quotas.

It does **not** bypass logins, CAPTCHAs, paywalls, robots rules, source contracts, or provider quotas. It does not use breach data, generate person-specific email guesses, or guess personal phone numbers.

## Quick start

1. Install Node 20+ and run `npm run start:server`.
2. Copy the printed pairing token.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select `extension/`.
4. Open findEmm, enter a vault passphrase plus the pairing token, unlock the vault, then search a prospect.

Capture is user-triggered. One click reads only visible name, title, company, and profile URL fields from the active LinkedIn profile or company page; it does not run in the background, discover contacts from LinkedIn, or submit anything until the recruiter reviews the form and clicks Research.

Run `npm test`, `npm run check`, and `npm run build` before a release. `npm run build` creates a loadable `dist/extension` directory.

## Import recruiter-owned contacts

The Shortlist view can seed the encrypted local vault from a recruiter-controlled CSV or ATS/CRM export. Download the in-product template or supply these headers:

- Required: a full `name` and explicit company `domain`.
- Optional: `company`, `title`, `profile_url` (a LinkedIn `/in/` person URL), `work_email`, `business_phone`, `source_url`, `source_note`, `list`, and `do_not_contact`.

Files are capped at 1 MB and 1,000 data rows. Parsing and validation happen in the extension. Generic, personal, mobile, home, and private email/phone columns are rejected; the file must explicitly label `work_email`/`business_email` and `business_phone`/`work_phone`. The domain is never inferred from an email. Before merge, only name, domain, and LinkedIn person URL are sent to the authenticated companion API on `127.0.0.1` for a local HMAC suppression check; no provider or website request runs. Provider-opt-out rows and any matching saved plaintext are removed immediately, ambiguous `Do not contact` conflicts block confirmation, and eligible additions enter the encrypted vault only after the recruiter reviews the preview and confirms. Existing DNC records also fail closed against first-name + last-name + domain variants, so adding or omitting a middle name cannot reopen Research or an import.

Imported email addresses remain `Recruiter supplied — identity unchecked`; imported phones must be recruiter-asserted business numbers. Neither is proof of ownership, currency, consent, or deliverability. A recruiter must independently confirm a person-email match before drafting. The source CSV remains on disk until the user deletes it. This is file import, not live ATS/CRM synchronization or a findEmm-owned contact database.

## Optional approved Hunter integration

Hunter Email Finder stays disabled unless the operator supplies a user-owned API key **and** confirms written commercial approval for this use. Hunter's current terms restrict competing services, so do not enable it without that approval.

```powershell
$env:FINDEMM_HUNTER_API_KEY='your-user-owned-key'
$env:FINDEMM_HUNTER_COMMERCIAL_APPROVAL='confirmed'
npm run start:server
```

The key remains in the local Node process environment. It is never stored by the extension, placed in request URLs, or returned by the local API. Results use a memory-only 24-hour cache and a conservative local rate gate. See [Hunter's API reference](https://hunter.io/api-documentation/) and [terms](https://hunter.io/terms-of-service) before enabling.

Hunter Email Finder returns a likely address and a mailbox status; it does not prove that the selected person owns the mailbox. findEmm treats only a Hunter `valid` result dated within the previous 90 days as a fresh provider-valid mailbox, keeps its identity unconfirmed, and makes it stale after 90 days. A recruiter must explicitly confirm the person match locally before findEmm enables the editable mail draft.

Every Hunter lookup requires a full person name and company domain locally, including handle-based requests. This lets a provider opt-out suppress both the LinkedIn-handle and name/domain routes; Capture never infers the domain, so the recruiter must enter it.

Provider opt-outs fail closed. The local server checks suppression both before enrichment and again after asynchronous provider/company-page work, before returning or persisting a result. It retains only keyed HMAC suppression values in ignored `server/data/suppressions.json`, blocks later matching lookups, and the extension purges matching cleartext identity, contact, and queued-outreach data. No plaintext opt-out identity is stored in that suppression file.

## Optional allowlisted company pages

Automated company-contact-page lookup is also off by default. Enable it only for exact domains the operator has reviewed and approved:

```powershell
$env:FINDEMM_PUBLIC_COMPANY_FETCH_APPROVAL='confirmed'
$env:FINDEMM_PUBLIC_COMPANY_DOMAINS='example.com,example.org'
npm run start:server
```

The local API checks the exact allowlist and robots rules, spaces requests to a host, limits response size, and labels any result as a company-level channel rather than a person-owned contact.

## Recruiter command deck

The popup supports a local workflow: clicked capture or manual entry, source review, save/deduplication, role-change history, successor and related-recruiter suggestions from saved records, notes, a draft-only follow-up queue, evidence export, single-record deletion, and a searchable placement shortlist. A recruiter-confirmed person match can open an editable email draft; nothing is sent automatically. See [acceptance criteria](docs/ACCEPTANCE_CRITERIA.md).

## Encrypted team handoff

A recruiter can export exactly one selected local list as a passphrase-protected handoff file and another recruiter can preview it before explicitly merging. Unrelated opt-out identities, local API pairing tokens, notes, and queued drafts are not included. Import requires the authenticated local companion API: known provider opt-outs and matching saved plaintext are removed immediately, and active records without a durable LinkedIn-handle or full-name/domain suppression alias are excluded. Exact LinkedIn person URLs deduplicate automatically; ambiguous name-and-company matches stay conflicts, an unresolved incoming `Do not contact` identity blocks the whole merge, and an existing local `Do not contact` state wins, including first-name + last-name + domain variants.

Every unlock suppression-screens the saved vault in bounded batches before outreach or export is enabled. Active legacy records without a canonical LinkedIn person URL or full name plus company domain remain quarantined from contact/export actions until the recruiter repairs that identity through Research. A known match is quarantined in the popup as soon as a valid screen returns, even if a newer preview replaces it; if deletion or reconciliation cannot be saved, contact and handoff actions remain blocked until a later unlock completes reconciliation. Manual Research likewise refuses to return a recruiter-entered person email or phone until that durable suppression alias exists.

Person-specific claims from a handoff, including provider-valid and recruiter-confirmed labels, are downgraded to `Shared contact — recheck required`. A recipient must confirm the person match locally before drafting.

Use a separate share passphrase, send the file and passphrase through different channels, and delete downloaded files when finished. The passphrase is not stored. This is encrypted file handoff, not hosted sync, user identity, role-based access control, revocation, audit logging, or sender verification.

## Result meaning

| Status | Meaning |
| --- | --- |
| Public company channel | Contact detail found on an explicitly enabled, allowlisted company page. It is not attributed to the selected person. |
| Provider-valid mailbox | Hunter reported the likely mailbox valid within 90 days. Identity remains unconfirmed. |
| Provider candidate or stale | Provider status is unknown, not valid, missing a date, or older than 90 days. |
| Recruiter supplied / shared contact | A human or handoff supplied the value, but findEmm has not confirmed identity or deliverability. |
| Recruiter-confirmed person match | The local recruiter attested that the email matches the person. This enables a local editable draft; it is not proof of consent. |

See [data policy](docs/DATA_POLICY.md), [threat model](docs/THREAT_MODEL.md), and [contributing guide](CONTRIBUTING.md).

## Chrome Web Store release

Run `npm run package:store` to create `release/findemm-0.1.0.zip`. Publisher-facing listing copy, privacy policy source, screenshot instructions, and submission checklist are in [webstore](webstore/). Do not submit until the public privacy-policy URL, genuine screenshots, and Chrome Web Store dashboard disclosures are complete.
