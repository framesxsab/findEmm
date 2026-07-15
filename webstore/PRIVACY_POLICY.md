# findEmm Privacy Policy

Effective date: 2026-07-15

findEmm is a local-first Chrome extension for recruiter-directed prospect research. This policy applies to the extension and its local companion API.

## Data we handle

findEmm handles the prospect details that a recruiter enters or explicitly captures from the active page, including names, company details, public profile URLs, work email addresses, business phone numbers, notes, lists, and source evidence. It also handles the local API pairing token entered by the recruiter.

## How data is used and shared

Data is used only to provide the user-facing prospect-research, record-management, export, and draft-outreach features. findEmm does not operate a hosted collection service, sell data, use data for advertising, train models on it, or allow human review of user data.

The extension sends a lookup only when the recruiter requests research. It sends that lookup to the recruiter-run local API at `127.0.0.1`; the local API may access a recruiter-supplied company domain or a provider explicitly configured and authorized by the recruiter. findEmm does not bypass access controls, paywalls, CAPTCHAs, robots rules, or provider terms.

## Storage and security

Saved records and the local API pairing token are encrypted in Chrome local storage with AES-GCM. The encryption key is derived from the user’s vault passphrase with PBKDF2 and is held only while the extension popup is open. The passphrase is never stored or transmitted. Local API traffic is limited to the user’s machine.

## Retention and deletion

Records remain on the user’s device until the user removes them or clears extension storage. Local API batches are memory-only and disappear when the local API stops. Users can delete all extension data through Chrome’s extension storage controls.

## Contact

For privacy and support questions, contact framessab@gmail.com.
