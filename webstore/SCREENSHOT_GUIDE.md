# Genuine Chrome Web Store screenshot guide

Do not use design mockups or generated images as Store screenshots. Capture the actual extension after loading `dist/extension` in Chrome.

1. Run `npm run start:server` and copy the printed local pairing token.
2. Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/extension`.
3. Open findEmm; capture the consent and secure-vault flow, then unlock it with a non-production passphrase and pairing token.
4. Capture at least these real states:
   - Empty Person record with the local-only message.
   - Research form after an intentional page capture.
   - Contact record with source-backed and pattern-candidate status treatments.
   - Saved record with a local list and draft-only follow-up queue.
5. Remove any real names, emails, tokens, personal notes, browser profile data, or sensitive page content before uploading.

Use screenshots that match the current release ZIP and Store description. Do not claim provider verification, unlimited data, or automatic email sending unless those capabilities are actually implemented and policy-compliant.
