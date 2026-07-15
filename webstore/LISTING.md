# Chrome Web Store listing copy

## Name

findEmm — Local Prospect Research

## Summary

Research recruiter-supplied prospects from permitted public/company sources. Keep evidence-backed contact records, lists, notes, exports, and draft-only follow-ups encrypted on your device.

## Detailed description

findEmm is a local-first prospect-research companion for recruiters. Capture details from the page you choose, enter a person and company, then research permitted public company sources through your own local API.

- Review every contact with its source, retrieval date, confidence, and status.
- Keep public findings, recruiter-imported contacts, provider-verified contacts, and unverified pattern candidates clearly separate.
- Save encrypted local records, notes, local lists, and draft-only follow-up steps.
- Export evidence-backed records as CSV.
- Open an editable email draft for a sourced work email. findEmm never sends email automatically.

findEmm does not scrape signed-in sites, bypass paywalls/CAPTCHAs/robots rules, use breach data, guess personal phone numbers, sell contact data, or impose a data-broker quota.

## Single purpose

Enable recruiter-directed, evidence-backed prospect research and local contact-record management from permitted sources.

## Permission justifications

| Permission | Why it is needed |
| --- | --- |
| `storage` | Store consent and the encrypted local vault. |
| `activeTab` | Capture only the active page after the recruiter clicks Capture page. |
| `scripting` | Execute the one-time page-capture function after that explicit action. |
| `http://127.0.0.1:4317/*` | Call the recruiter-run local API; no hosted findEmm API is used. |

## Privacy Practices dashboard answers

- Handles: personal information, website content/page metadata, and user-generated notes.
- Purpose: only the extension’s recruiter-research and local record-management features.
- Sale/advertising: no.
- Human review: no.
- Privacy policy: use the public URL serving `webstore/privacy-policy.html` after publisher contact details are finalized.
