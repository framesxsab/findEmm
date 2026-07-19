# Store submission checklist

## Included in this repository

- [x] MV3 package source and `npm run package:store` ZIP build workflow.
- [x] PNG icons at 16, 32, 48, and 128 pixels.
- [x] Least-privilege, click-triggered active-page capture with no persistent content script.
- [x] Consent gate naming local processing and optional Hunter transmission.
- [x] Encrypted local vault, searchable shortlist, single-record deletion, and full-vault deletion.
- [x] Preview-first recruiter CSV intake with explicit work/business schema, bounded parsing, pre/confirm/post-write HMAC screening, immediate alias-specific purge, DNC precedence, source provenance, revision-bound previews, and no automatic provider calls.
- [x] Local confirmation gate before editable email drafting.
- [x] HMAC-only durable provider suppression with pre/post-enrichment checks, unlock-time reconciliation/quarantine, and selected-list-only encrypted handoff with suppression-screened import, uncheckable-active exclusion, and blocking incoming-DNC conflicts.
- [x] Store listing copy, permission justifications, and privacy disclosure source.
- [x] Public privacy-policy HTML ready for hosting.

## Publisher/dashboard actions still required

- [x] Deploy the current `webstore/privacy-policy.html` over `https://framesxsab.github.io/findEmm/webstore/privacy-policy.html`, then verify the live page includes recruiter CSV intake, Hunter, company-page, HMAC-suppression, shortlist, handoff, and deletion disclosures plus the current support contact. Verified live HTTP 200 and current disclosures on 2026-07-19.
- [ ] Capture genuine screenshots from the final loaded extension; do not use generated mockups as Store screenshots.
- [ ] Create or verify the Chrome Web Store developer account, upload the final `release/findemm-0.1.0.zip`, and complete payments/profile steps Google requires.
- [ ] Paste `LISTING.md` into the listing, upload genuine screenshots, choose a category, and provide support contact information.
- [ ] Complete Privacy Practices fields exactly as described in `LISTING.md`, set the public privacy-policy URL, and certify the disclosures.
- [ ] Keep Hunter disabled unless written commercial approval and an authorized operator account are documented. Keep company-page fetching disabled unless explicit approval and an exact-domain allowlist are documented.
- [x] Run `npm test`, `npm run check`, `npm run build`, and `npm run package:store` against the final source; verify the ZIP matches the tested build. Verified on 2026-07-20: 94 tests passed, syntax checks passed, authenticated local API health/screening and uncheckable-contact `422` smoke checks passed with integrations disabled, and all 11 packaged files matched `dist/extension` by SHA-256. Current ZIP SHA-256: `0B056F784C9E6F40E248889987C2982A5968C154B54314EA3D8A372941CE8F76`.
- [ ] Perform a clean-profile Chrome smoke without real personal data: consent, unlock-time reconciliation and legacy uncheckable quarantine/repair, template download, synthetic recruiter CSV preview/confirm/immediate purge, final-screen rollback, suppression-screen failure behavior, imported-record Research, Hunter-disabled durable-opt-out blocking, clicked capture and field review, source labels, local person-match confirmation before draft, shortlist search/filter/open/delete, selected-only handoff export/screen/import downgrade, uncheckable-active exclusion, blocking incoming-DNC conflict, stale cross-popup read/write rejection, CSV export, and full-vault clear.
- [x] Verify Hunter-disabled and company-fetch-disabled health states. Verified on 2026-07-19 with the authenticated loopback health endpoint; no live-provider proof claimed.
- [ ] Complete the rendered visual review in `design-qa.md`. Current source/static review does not satisfy this gate.
