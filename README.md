# findEmm

Open-source, local-first recruiter enrichment for Chrome. findEmm helps a recruiter research a prospect from recruiter-supplied details, a company domain, permitted public company pages, CSV rows, and configured provider APIs.

It does **not** bypass logins, CAPTCHAs, paywalls, robots rules, source contracts, or provider quotas. It does not use breach data and never labels a generated email as verified.

## Quick start

1. Install Node 20+ and run `npm run start:server`.
2. Copy the printed pairing token.
3. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, then select `extension/`.
4. Open findEmm, paste the pairing token in Settings, then search a prospect.

Run `npm test`, `npm run check`, and `npm run build` before a release. `npm run build` creates a loadable `dist/extension` directory.

## Recruiter command deck

The popup follows a complete local workflow: capture or research a person, inspect contact provenance, save the record to a local list, add a note, queue a draft-only follow-up, export its evidence, or open an editable email draft for a sourced work email. Nothing is sent automatically. See [acceptance criteria](docs/ACCEPTANCE_CRITERIA.md).

## Result meaning

| Status | Meaning |
| --- | --- |
| Publicly found | Contact detail visibly found on a permitted public company page. |
| Provider verified | A configured provider stated it verified the contact. |
| Pattern candidate | A work-email pattern derived from name and domain. Not verified. |

See [data policy](docs/DATA_POLICY.md), [threat model](docs/THREAT_MODEL.md), and [contributing guide](CONTRIBUTING.md).

## Chrome Web Store release

Run `npm run package:store` to create `release/findemm-0.1.0.zip`. Publisher-facing listing copy, privacy policy source, screenshot instructions, and submission checklist are in [webstore](webstore/). Do not submit until the public privacy-policy URL, genuine screenshots, and Chrome Web Store dashboard disclosures are complete.
