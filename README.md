# findEmm

findEmm is a local-first Chrome extension for recruiters who want a calmer, more deliberate way to research and organize prospects. It helps you capture a profile you are viewing, review the details, maintain a private shortlist, and prepare a follow-up draft after you have confirmed the contact yourself.

It is built for recruiter-controlled data and responsible research—not scraping, mass outreach, or contact guessing.

## What you can do

- Capture visible details from the LinkedIn profile or company page you actively open.
- Add prospects manually or import a recruiter-controlled CSV.
- Keep an encrypted local shortlist with notes, status, and role-change context.
- See related-recruiter and successor suggestions from records you have already saved.
- Export a selected list as an encrypted handoff for another recruiter.
- Create a local email draft only after you confirm the person/contact match.

findEmm never sends email automatically. It does not bypass logins, CAPTCHAs, paywalls, website rules, or provider limits. It does not use breach data, generate person-specific email addresses, or guess personal phone numbers.

## Install locally

### Requirements

- Node.js 20 or later
- Google Chrome or another Chromium-based browser

### Start

```powershell
npm install
npm run start:server
```

Copy the pairing token printed by the server. Then:

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select the `extension` folder.
4. Open findEmm, create a vault passphrase, paste the pairing token, and unlock the vault.

For a production-style local build, run `npm run build` and load `dist/extension` instead.

## Importing contacts

Use only exports you are allowed to process. The included CSV template accepts a person’s name and company domain, with optional job, LinkedIn profile, work email, business phone, source, list, and do-not-contact fields.

Imports are reviewed before saving. Personal and ambiguous contact columns are rejected. A supplied email or phone is treated as recruiter-provided information—not proof that it belongs to a person or that outreach is appropriate.

## Privacy and responsible use

Your shortlist is stored locally in an encrypted vault. The extension asks for consent before capture and only reads visible fields from the page you choose to capture.

Optional research integrations are off by default. Enable one only when you have the required account, permission, and approval for your organization’s use. Respect opt-outs and use only data you are authorized to handle.

Read the [data policy](docs/DATA_POLICY.md) and [privacy policy](webstore/privacy-policy.html) before using findEmm with real contact data.

## Development

```powershell
npm test
npm run check
npm run build
```

To create a Chrome Web Store package, run `npm run package:store`. Maintainer-only publishing instructions live in [`webstore/`](webstore/).

## Contributing and security

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request, and report vulnerabilities privately using [SECURITY.md](SECURITY.md).

findEmm is licensed under the [Apache License 2.0](LICENSE).
