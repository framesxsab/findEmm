# Contributing to findEmm

Thanks for contributing. findEmm is a local-first recruiter research tool, so changes must preserve user control, data minimization, and responsible use.

## Before you start

1. Open an issue or discussion for substantial changes.
2. Keep pull requests focused and explain the user-facing outcome.
3. Do not include real contact data, pairing tokens, exports, API keys, or files from `server/data/`.

## Development checks

Run these before opening a pull request:

```powershell
npm test
npm run check
npm run build
```

After cloning, run `npm run hooks:install` once. The pre-commit hook runs the test and syntax-check suite before every commit.

## Project boundaries

- Keep capture user-triggered and limited to visible fields on supported pages.
- Do not add login scraping, CAPTCHA bypasses, background collection, breach data, or generated contact guesses.
- Do not add automatic email sending or claims that mailbox validity proves a person’s identity.
- Use only authorized sources and retain clear source evidence for any new integration.
- Keep optional providers disabled by default and preserve opt-out handling.
- Keep user data local unless a feature clearly explains and obtains consent for a transfer.

For policy details, see the [data policy](docs/DATA_POLICY.md). Please report security issues privately rather than in a public issue; see [SECURITY.md](SECURITY.md).
