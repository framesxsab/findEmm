# Store submission checklist

## Included in this repository

- [x] MV3 package source and `npm run package:store` ZIP build workflow.
- [x] PNG icons at 16, 32, 48, and 128 pixels.
- [x] Least-privilege, click-triggered active-page capture with no persistent content script.
- [x] Consent gate naming local processing and optional Hunter transmission.
- [x] Encrypted local vault, searchable shortlist, single-record deletion, and full-vault deletion.
- [x] Local confirmation gate before editable email drafting.
- [x] HMAC-only durable provider suppression and selected-list-only encrypted handoff.
- [x] Store listing copy, permission justifications, and privacy disclosure source.
- [x] Public privacy-policy HTML ready for hosting.

## Publisher/dashboard actions still required

- [ ] Deploy the current `webstore/privacy-policy.html` over `https://framesxsab.github.io/findEmm/webstore/privacy-policy.html`, then verify the live page includes the Hunter, company-page, HMAC-suppression, shortlist, handoff, and deletion disclosures plus the current support contact. The live page was reachable on 2026-07-17 but still contained the older short policy.
- [ ] Capture genuine screenshots from the final loaded extension; do not use generated mockups as Store screenshots.
- [ ] Create or verify the Chrome Web Store developer account, upload the final `release/findemm-0.1.0.zip`, and complete payments/profile steps Google requires.
- [ ] Paste `LISTING.md` into the listing, upload genuine screenshots, choose a category, and provide support contact information.
- [ ] Complete Privacy Practices fields exactly as described in `LISTING.md`, set the public privacy-policy URL, and certify the disclosures.
- [ ] Keep Hunter disabled unless written commercial approval and an authorized operator account are documented. Keep company-page fetching disabled unless explicit approval and an exact-domain allowlist are documented.
- [x] Run `npm test`, `npm run check`, `npm run build`, and `npm run package:store` against the final source; verify the ZIP matches the tested build. Verified on 2026-07-17: 61 tests passed, syntax checks passed, the local API smoke passed with integrations disabled, and all 11 packaged files matched `dist/extension` by SHA-256.
- [ ] Perform a clean-profile Chrome smoke without real personal data: consent, clicked capture and field review, manual Research, source labels, local person-match confirmation before draft, shortlist search/filter/open/delete, selected-only handoff export/import downgrade, opt-out purge, CSV export, and full-vault clear.
- [ ] Verify Hunter-disabled and company-fetch-disabled health states. If approved integrations are not available, do not claim live-provider proof.
- [ ] Complete the rendered visual review in `design-qa.md`. Current source/static review does not satisfy this gate.
