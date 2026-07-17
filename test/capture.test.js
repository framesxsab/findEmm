const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCapturedPage } = require('../extension/capture');

test('captures explicit LinkedIn profile fields without inventing a domain', () => {
  const captured = parseCapturedPage({
    url: 'https://www.linkedin.com/in/asha-rao/?trk=profile#about',
    h1: ' Asha Rao ',
    headline: 'Campus Recruiting Manager at Example Corp',
    company: 'Example Corp'
  });
  assert.equal(captured.kind, 'linkedin_profile');
  assert.deepEqual(captured.prospect, { name: 'Asha Rao', company: 'Example Corp', title: 'Campus Recruiting Manager', domain: '', profileUrl: 'https://www.linkedin.com/in/asha-rao/' });
  assert.deepEqual(captured.capturedFields, ['name', 'company', 'title', 'profileUrl']);
  assert.deepEqual(captured.missingFields, ['domain']);
});

test('uses a cleaned document title only as LinkedIn profile fallback', () => {
  const captured = parseCapturedPage({
    url: 'https://linkedin.com/in/dev-shah',
    documentTitle: '(2) Dev Shah - Senior Talent Partner @ Example | LinkedIn'
  });
  assert.deepEqual(captured.prospect, { name: 'Dev Shah', company: 'Example', title: 'Senior Talent Partner', domain: '', profileUrl: 'https://linkedin.com/in/dev-shah' });
  assert.deepEqual(parseCapturedPage({ url: 'https://example.com/team', documentTitle: 'Dev Shah - Recruiter' }).prospect, { name: '', company: '', title: '', domain: '', profileUrl: '' });
});

test('captures a LinkedIn company page as a company, not a person profile', () => {
  const captured = parseCapturedPage({
    url: 'https://www.linkedin.com/company/example/about/',
    h1: 'Example Ltd | LinkedIn',
    company: 'Unrelated Corp',
    headline: 'A global employer',
    documentTitle: 'Example Ltd: Overview | LinkedIn'
  });
  assert.equal(captured.kind, 'linkedin_company');
  assert.deepEqual(captured.prospect, { name: '', company: 'Example Ltd', title: '', domain: '', profileUrl: '' });
  assert.deepEqual(captured.capturedFields, ['company']);
});

test('rejects unsafe URLs and malformed capture input', () => {
  const blank = { name: '', company: '', title: '', domain: '', profileUrl: '' };
  assert.deepEqual(parseCapturedPage({ url: 'javascript:alert(1)', h1: 'Injected', headline: 'Recruiter at Evil' }), { kind: 'unsupported', prospect: blank, capturedFields: [], missingFields: ['name', 'company', 'title', 'domain', 'profileUrl'] });
  assert.deepEqual(parseCapturedPage(null).prospect, blank);
  assert.deepEqual(parseCapturedPage({ url: { href: 'https://linkedin.com/in/fake' }, h1: ['Fake'] }).prospect, blank);
});
