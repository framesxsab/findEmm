(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.FindEmmCapture = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const fields = ['name', 'company', 'title', 'domain', 'profileUrl'];

  function text(value, max = 200) {
    return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max).trim() : '';
  }

  function withoutLinkedInChrome(value, max = 200) {
    return text(text(value, 500).replace(/^\(\d+\)\s*/, '').replace(/\s*(?:\||[-\u2013\u2014\u00b7\u2022])\s*LinkedIn\s*$/i, ''), max);
  }

  function personText(value) {
    const cleaned = withoutLinkedInChrome(value);
    return /^(?:linkedin(?: member)?|log in|sign in|sign up|join linkedin|welcome to your professional community)$/i.test(cleaned) ? '' : cleaned;
  }

  function companyText(value) {
    const cleaned = withoutLinkedInChrome(value);
    return /^(?:log in|sign in|sign up|welcome to your professional community)$/i.test(cleaned) ? '' : cleaned;
  }

  function pageUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url : null;
    } catch {
      return null;
    }
  }

  function splitHeadline(value) {
    const cleaned = personText(value);
    const match = cleaned.match(/^(.+?)(?:\s+at\s+|\s+@\s*)(.+)$/i);
    return match ? { title: personText(match[1]), company: companyText(match[2]) } : { title: cleaned, company: '' };
  }

  function titleFallback(value) {
    const cleaned = personText(value);
    if (!cleaned || /\b(?:log in|sign in|sign up|join linkedin)\b/i.test(cleaned)) return { name: '', title: '', company: '' };
    const parts = cleaned.split(/\s+[-\u2013\u2014]\s+/).map(personText).filter(Boolean);
    const name = parts.shift() || '';
    const headline = splitHeadline(parts[0] || '');
    return { name, title: headline.title, company: headline.company || companyText(parts[1]) };
  }

  function result(kind, prospect) {
    return { kind, prospect, capturedFields: fields.filter((field) => prospect[field]), missingFields: fields.filter((field) => !prospect[field]) };
  }

  function parseCapturedPage(raw = {}) {
    const empty = { name: '', company: '', title: '', domain: '', profileUrl: '' };
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result('unsupported', empty);
    const url = pageUrl(raw.url);
    const host = url?.hostname.toLowerCase().replace(/\.$/, '') || '';
    const linkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');
    const profile = linkedIn && /^\/in\/[^/]+(?:\/|$)/i.test(url.pathname);
    const companyPage = linkedIn && /^\/company\/[^/]+(?:\/|$)/i.test(url.pathname);

    if (companyPage) return result('linkedin_company', { ...empty, company: companyText(raw.h1) });
    if (!profile) return result('unsupported', empty);

    const headline = splitHeadline(raw.headline);
    const fallback = titleFallback(raw.documentTitle);
    url.search = '';
    url.hash = '';
    return result('linkedin_profile', {
      name: personText(raw.h1) || fallback.name,
      company: companyText(raw.company) || headline.company || fallback.company,
      title: headline.title || fallback.title,
      domain: '',
      profileUrl: url.href
    });
  }

  return { parseCapturedPage };
}));
