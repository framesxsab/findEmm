# Genuine Chrome Web Store screenshot guide

Do not use design mockups or generated images as Store screenshots. Capture the actual final extension after loading `dist/extension` in Chrome.

1. Run `npm run start:server` and copy the printed local pairing token. Leave Hunter and automated company-page fetching disabled unless the publisher has documented approval to test them.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension`.
3. Open findEmm; capture the consent and secure-vault flow, then unlock and suppression-reconcile it with a non-production passphrase and pairing token.
4. Use only publisher-owned, synthetic, or explicitly permitted example data. Never expose a real token, passphrase, email, phone number, note, or browser-profile detail.
5. Capture real states that demonstrate:
   - Empty Person record and local-vault language.
   - Clicked Capture on a supported page followed by the Research form with fields awaiting review. Show no background or automatic submission claim.
   - A record distinguishing a company channel, recruiter-supplied/shared candidate, and provider mailbox status. Do not fabricate a live Hunter result.
   - The **Confirm person match** action and the resulting local-attestation label before the editable draft becomes available.
   - Placement Shortlist search, filters, counts, role-change/queue context, and record open action.
   - Recruiter CSV preview using synthetic work-contact data, including additions/updates/conflicts, immediate known-opt-out deletion copy, and the statement that no provider lookup ran.
   - Confirmation dialog for single-record deletion without completing it on valuable data.
   - A synthetic legacy record without a durable suppression alias visibly quarantined from contact/export, followed by its identity-repair Research path.
   - Selected-list encrypted handoff preview showing local suppression screening, exclusion of an active uncheckable identity, a blocking incoming-DNC conflict, and that shared claims require local recheck.
6. Remove the synthetic test vault and delete the source/template/export/handoff test files after capture.

Use screenshots that match the current release ZIP and Store description. Do not claim provider-verified identity, unlimited data, hosted team access, automatic email sending, or completed browser QA unless each claim has current evidence.
