# Recruiter contact-record acceptance criteria

## Recruiter workflow

- A recruiter can capture a page or enter prospect details, run permitted-source research, and land on a person record.
- The record presents every contact with value, type, status, source/evidence link when available, retrieval date, confidence, and plain-language reason.
- `Publicly found`, `Recruiter imported`, `Provider verified`, and `Pattern candidate — not verified` have distinct visible treatments. A pattern candidate cannot be used by the outreach draft action.
- A recruiter can save a record, move it among local lists, save a note, queue a draft-only follow-up, export the record as CSV, and open a mail client draft for a sourced work email.
- Saving, notes, lists, and follow-up queue state stay in Chrome local storage. The product never sends email or automatically contacts a prospect.

## Safety and release gates

- The local API accepts only an authenticated pairing token and listens on `127.0.0.1`.
- Company-page lookup is robots-aware, throttled, unauthenticated, and limited to supplied domains. Source restrictions, breach data, and personal-contact guessing are out of scope.
- `npm test`, `npm run check`, `npm run build`, MV3 manifest validation, and authenticated local API smoke tests must pass.
- Browser visual verification is required for final release signoff; if a Chrome automation surface is unavailable, that gap must be reported rather than claimed as completed.
