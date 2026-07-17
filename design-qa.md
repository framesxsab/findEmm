# Design QA — Recruiter Command Deck

## Reference

Selected visual direction: Option 2, Recruiter Command Deck. Current source preserves its action-first hierarchy and adds a Placement Shortlist: person identity, evidence/status rows, local confirmation before drafting, save/list/queue actions, related or successor recommendations, encrypted handoff, and deletion controls.

## Static source review

- Capture is presented as an explicit click and the consent copy explains visible-field capture, review, local processing, and optional Hunter transmission.
- Contact copy distinguishes mailbox validity from person identity. Provider-valid results remain identity-unconfirmed, stale after 90 days, and require local confirmation before drafting.
- Shortlist source includes search, list filters, active/follow-up/Do-not-contact counts, queued-draft and role-change context, and record-open actions.
- Single-record deletion, full-vault deletion, `Do not contact`, and provider-opt-out purge are distinct destructive/safety paths.
- Handoff copy says only the chosen list is exported and shared person claims require local recheck.
- Keyboard-focus styles and reduced-motion handling are present in source.

Static source inspection does not prove rendered layout, focus order, clipping, browser APIs, dialogs, or destructive-action behavior.

## Visual capture

Browser capture remains unavailable in this session. The in-app browser runtime is installed, but it exposed no browser target on 2026-07-17. No rendered-screen comparison or interactive Chrome verification is claimed.

**final result: blocked**

## Required follow-up

Load the final `dist/extension` through `chrome://extensions` with the local API running and integrations disabled by default. At approximately 390px popup width, inspect:

- consent, vault lock/unlock, and clicked Capture review;
- empty, researched, saved, stale-provider, locally confirmed, and `Do not contact` person states;
- Shortlist empty/populated/search/filter/count states;
- recommendations and former-company successor reasons;
- single-delete and full-vault confirmation dialogs;
- selected-list handoff export, import preview, shared-claim downgrade, and merge;
- keyboard-only navigation, visible focus, screen-reader status updates, long values, scrolling, and reduced motion.

Resolve all P0–P2 visual or interaction gaps, capture genuine Store screenshots from that exact packaged build, then change the final result to `passed`.
