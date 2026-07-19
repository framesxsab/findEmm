# Design QA — Recruiter Command Deck

## Reference

Selected visual direction: Option 2, Recruiter Command Deck. Current source preserves its action-first hierarchy and adds a Placement Shortlist: person identity, evidence/status rows, local confirmation before drafting, save/list/queue actions, related or successor recommendations, encrypted handoff, and deletion controls.

## Static source review

- Capture is presented as an explicit click and the consent copy explains visible-field capture, review, local processing, and optional Hunter transmission.
- Contact copy distinguishes mailbox validity from person identity. Provider-valid results remain identity-unconfirmed, stale after 90 days, and require local confirmation before drafting.
- Shortlist source includes search, list filters, active/follow-up/Do-not-contact counts, queued-draft and role-change context, and record-open actions.
- Shortlist source includes recruiter CSV template/download, local preview, explicit confirmation for additions, immediate known-opt-out deletion copy, HMAC suppression-screen language, and a clear boundary that import does not automatically call providers.
- Single-record deletion, full-vault deletion, `Do not contact`, and provider-opt-out purge are distinct destructive/safety paths.
- Vault copy explains unlock-time opt-out reconciliation; active records without a durable suppression identity visibly remain quarantined from contact/export while Research can repair them.
- Handoff copy says only the chosen list is exported, import requires local suppression screening, active uncheckable identities are excluded, unresolved incoming DNC conflicts block the merge, and shared person claims require local recheck.
- The three view controls use named ARIA tabs/panels with roving focus and Left/Right/Home/End keyboard navigation; keyboard-focus styles and reduced-motion handling are present in source.
- Research prevents duplicate submits while a permitted-source request is in progress, announces that state, and restores the control on every result or failure path.

Static source inspection does not prove rendered layout, focus order, clipping, browser APIs, dialogs, or destructive-action behavior.

## Visual capture

On 2026-07-19, the packaged `dist/extension` was loaded as a real unpacked MV3 extension in Playwright Chromium on Windows and exercised at a 390 × 780 viewport. The consent dialog rendered and scrolled, consent acceptance worked, and the popup had no horizontal overflow (`scrollWidth === clientWidth === 390`). Keyboard navigation moved from Person to Shortlist with Right Arrow and to Research with End, updated `aria-selected`, and showed a visible focus indicator. Vault creation/unlock completed its suppression reconciliation against the running local companion API; the health check correctly reported Hunter and company-page lookup disabled; a synthetic LinkedIn-identified prospect completed the Hunter-disabled Research path without generating a guessed contact. No console or page errors were observed during this smoke.

The smoke does not cover every state in the real-Chrome release matrix below. In particular, clicked capture on a live permitted LinkedIn page, file download/upload paths, suppression timing/failure injection, handoff paths, two-popup stale-write behavior, destructive confirmations, reduced motion, and assistive-technology announcements still require release-gate verification. The captured Chromium views are QA evidence, not Chrome Web Store screenshots.

**final result: blocked**

## Required follow-up

Load the final `dist/extension` through `chrome://extensions` with the local API running and integrations disabled by default. At approximately 390px popup width, inspect:

- consent, vault lock/unlock/reconciliation, legacy uncheckable-record quarantine/repair, and clicked Capture review;
- empty, researched, saved, stale-provider, locally confirmed, and `Do not contact` person states;
- Shortlist empty/populated/search/filter/count states;
- recruiter CSV choose/preview/error/confirm states, including long validation feedback and an ambiguous DNC block;
- recommendations and former-company successor reasons;
- single-delete and full-vault confirmation dialogs;
- selected-list handoff export, suppression-screened import preview, uncheckable-identity exclusion, blocking incoming-DNC conflict, shared-claim downgrade, and merge;
- keyboard-only navigation, visible focus, screen-reader status updates, long values, scrolling, and reduced motion.

Resolve all P0–P2 visual or interaction gaps, capture genuine Store screenshots from that exact packaged build, then change the final result to `passed`.
