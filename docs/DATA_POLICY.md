# Data and source policy

findEmm processes recruiter-supplied prospect data locally. The loopback server listens only on `127.0.0.1`; it has no account system and no hosted collection endpoint. Saved records and the local API pairing token are encrypted in Chrome local storage with AES-GCM using a passphrase that is held only while the popup is open.

Permitted sources are recruiter-imported data, APIs for which the recruiter has authorization, and public company pages that allow automated access under their robots policy. A source result must retain its URL, retrieval time, type, and an evidence snippet.

Forbidden: authentication-gated scraping, CAPTCHA bypass, paywall bypass, credential sharing, breach data, private/personal-phone discovery, and suppression of provider limits. Generated addresses are candidates only. Respect applicable privacy, employment, anti-spam, and data-protection law before contacting anyone.

To delete data, remove a record from the extension or clear the extension's local storage from Chrome. The local server keeps batches in memory only; restart it to discard them.

For privacy questions, contact framessab@gmai.com.
