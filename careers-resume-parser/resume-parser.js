/**
 * Aptus Data Labs — rule-based resume parser.
 *
 * No AI, no network calls, no build step. Runs entirely in the browser so a
 * candidate's resume never leaves their machine until they submit the form.
 *
 * The pipeline is four stages:
 *   text items  ->  lines  ->  sections  ->  fields
 *
 * Field extraction uses feature scoring rather than a single regex: every
 * candidate value is scored by a list of small feature functions and the
 * highest scorer wins. That keeps each rule independently readable, and makes
 * a wrong answer easy to trace back to the feature that caused it.
 *
 * Nothing here is certain. Every field carries a confidence, and the caller is
 * expected to show low-confidence values to the candidate for correction
 * rather than filing them silently.
 */

import { matchSkills } from './skills.js';

/* ------------------------------------------------------------------ *
 * 1. Lines — group text items that share a baseline
 * ------------------------------------------------------------------ */

/**
 * @param {TextItem[]} items  {text, x, y, width, height, fontSize, bold, page}
 * @returns {Line[]}          {text, items, x, y, fontSize, bold, page}
 */
export function groupIntoLines(items) {
  const usable = items.filter(i => i.text && i.text.trim());
  if (!usable.length) return [];

  const sorted = [...usable].sort((a, b) =>
    a.page - b.page || b.y - a.y || a.x - b.x);

  const lines = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const prev = current[current.length - 1];
    // Same line when the baselines are within half a line height. PDF
    // baselines wobble by a point or two on the same visual row, so an exact
    // comparison splits rows that clearly belong together.
    const sameRow = item.page === prev.page &&
      Math.abs(item.y - prev.y) < Math.max(prev.fontSize, item.fontSize) * 0.5;

    if (sameRow) current.push(item);
    else { lines.push(toLine(current)); current = [item]; }
  }
  lines.push(toLine(current));
  return lines;
}

function toLine(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  // Re-insert the spaces PDF extraction drops: a gap wider than a quarter of
  // the font size is a word break, not kerning.
  let text = '';
  sorted.forEach((item, i) => {
    if (i > 0) {
      const prev = sorted[i - 1];
      const gap = item.x - (prev.x + prev.width);
      if (gap > prev.fontSize * 0.25 && !text.endsWith(' ')) text += ' ';
    }
    text += item.text;
  });

  const fontSize = Math.max(...sorted.map(i => i.fontSize || 0));
  return {
    text: text.replace(/\s+/g, ' ').trim(),
    items: sorted,
    x: sorted[0].x,
    y: sorted[0].y,
    fontSize,
    // A line counts as bold only if most of it is — a single bold word inside
    // a sentence must not promote the whole line to a heading.
    bold: sorted.filter(i => i.bold).length > sorted.length / 2,
    page: sorted[0].page
  };
}

/* ------------------------------------------------------------------ *
 * 2. Sections — split lines on their headings
 * ------------------------------------------------------------------ */

const SECTION_PATTERNS = [
  ['experience',     /^(work|professional|employment|career)?\s*(experience|history|background)$/i],
  ['education',      /^(education|academic|qualifications?|academics)( *(&|and) *training)?$/i],
  ['skills',         /^(technical +)?(skills|competencies|technologies|expertise|tech +stack)$/i],
  ['projects',       /^(key +|selected +|personal +)?projects?$/i],
  ['certifications', /^(certifications?|licenses?|courses?|training)$/i],
  ['summary',        /^(summary|profile|objective|about( me)?|professional summary)$/i],
  ['awards',         /^(awards?|achievements?|honou?rs?|recognition)$/i],
  ['publications',   /^(publications?|papers?|research)$/i],
  ['languages',      /^languages?$/i],
  ['interests',      /^(interests?|hobbies|activities)$/i],
  ['contact',        /^(contact|personal) *(details?|information|info)?$/i]
];

/**
 * A line is a heading when it *reads* like one and *looks* like one.
 * Requiring both keeps "Experience working with Databricks" out of the
 * heading list while still catching a plain unstyled "EXPERIENCE".
 */
function headingKind(line, bodyFontSize) {
  const text = line.text.replace(/[:•\-–—_|]+\s*$/, '').trim();
  if (!text || text.length > 40) return null;

  const match = SECTION_PATTERNS.find(([, re]) => re.test(text));
  if (!match) return null;

  const looksLikeHeading =
    line.bold ||
    text === text.toUpperCase() ||
    line.fontSize > bodyFontSize + 0.5;

  return looksLikeHeading ? match[0] : null;
}

/**
 * @returns {{order: string[], sections: Record<string, Line[]>, header: Line[]}}
 *   `header` is everything above the first heading — where the name and
 *   contact details almost always live.
 */
export function groupIntoSections(lines) {
  const bodyFontSize = modeFontSize(lines);
  const sections = {};
  const order = [];
  const header = [];
  let currentKey = null;

  for (const line of lines) {
    const kind = headingKind(line, bodyFontSize);
    if (kind) {
      currentKey = kind;
      if (!sections[currentKey]) { sections[currentKey] = []; order.push(currentKey); }
      continue;
    }
    if (currentKey) sections[currentKey].push(line);
    else header.push(line);
  }
  return { order, sections, header };
}

/** The most common font size on the page — the body text size. */
function modeFontSize(lines) {
  const counts = new Map();
  for (const l of lines) {
    const size = Math.round(l.fontSize * 2) / 2;
    counts.set(size, (counts.get(size) || 0) + l.text.length);
  }
  let best = 11, bestCount = -1;
  for (const [size, count] of counts) if (count > bestCount) { best = size; bestCount = count; }
  return best;
}

/* ------------------------------------------------------------------ *
 * 3. Feature scoring
 * ------------------------------------------------------------------ */

/**
 * @param {T[]} candidates
 * @param {[fn: (c: T) => boolean, points: number][]} features
 * @returns {{value: T|null, score: number, ratio: number}}
 *   `ratio` is the winner's margin over the runner-up, which is what
 *   distinguishes a confident answer from a coin toss.
 */
function scoreBest(candidates, features) {
  if (!candidates.length) return { value: null, score: 0, ratio: 0 };

  const scored = candidates.map(c => ({
    c,
    score: features.reduce((sum, [fn, pts]) => sum + (fn(c) ? pts : 0), 0)
  })).sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top.score <= 0) return { value: null, score: top.score, ratio: 0 };

  const runnerUp = scored[1] ? Math.max(scored[1].score, 0) : 0;
  return { value: top.c, score: top.score, ratio: top.score / (runnerUp || 1) };
}

const confidenceFrom = (score, ratio) =>
  score >= 6 && ratio >= 1.5 ? 'high' : score >= 3 ? 'medium' : 'low';

/* ------------------------------------------------------------------ *
 * 4. Field extractors
 * ------------------------------------------------------------------ */

const RE = {
  email:    /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
  linkedin: /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[a-z0-9_-]+/i,
  github:   /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9_-]+/i,
  url:      /(?:https?:\/\/|www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s,;)]*)?/i,
  // Deliberately loose on grouping and strict on digit count. Numbers group
  // differently everywhere — +91 98765 43210, +44 20 7946 0958, (415) 555-0123
  // — so pinning the group sizes only ever excludes somebody's country. The
  // 10-to-15-digit check below is what actually decides.
  // The leading \(? matters: without it a match on "(415) 555-0182" starts at
  // the 4, so the parenthesised area code — the signal that says US — is lost
  // before normalisePhone ever sees it.
  phone:    /\+?\(?\d[\d\s().-]{7,18}\d/,
  // Aug 2021 – Present | 08/2021 - 12/2023 | 2021–2023
  dateRange: new RegExp(
    '(' +
      '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*\\d{4}' +
      '|\\d{1,2}[\\/.]\\d{4}' +
      '|\\d{4}' +
    ')' +
    '\\s*(?:-|–|—|to|until|through)\\s*' +
    '(' +
      'present|current|now|till date|date' +
      '|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?\\s*\\d{4}' +
      '|\\d{1,2}[\\/.]\\d{4}' +
      '|\\d{4}' +
    ')', 'i')
};

const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6,
                 aug:7, sep:8, sept:8, oct:9, nov:10, dec:11 };

const SECTION_WORDS = /\b(experience|education|skills|summary|objective|projects?|certifications?|resume|curriculum vitae|contact)\b/i;

function extractName(header) {
  if (!header.length) return { value: null, confidence: 'low' };

  const maxFontSize = Math.max(...header.map(l => l.fontSize));
  const candidates = header.slice(0, 8);

  const { value, score, ratio } = scoreBest(candidates, [
    [l => l.bold, 3],
    [l => l.fontSize >= maxFontSize - 0.1, 3],
    [l => /^[A-Z][a-z'.-]+(?:\s+[A-Z][a-z'.-]+){1,3}$/.test(l.text), 4],
    [l => /^[A-Z][A-Z\s'.-]{3,40}$/.test(l.text) && l.text.split(/\s+/).length <= 4, 2],
    [l => header.indexOf(l) === 0, 2],
    [l => l.text.split(/\s+/).length >= 2 && l.text.split(/\s+/).length <= 4, 1],
    // Hard negatives — a line with an @ or a digit is contact detail, not a name.
    [l => RE.email.test(l.text), -8],
    [l => /\d/.test(l.text), -5],
    [l => SECTION_WORDS.test(l.text), -6],
    [l => l.text.length > 40, -4],
    [l => /[|,•]/.test(l.text), -2]
  ]);

  return { value: value ? cleanName(value.text) : null, confidence: confidenceFrom(score, ratio) };
}

function cleanName(text) {
  const name = text.replace(/[|,•].*$/, '').replace(/\s+/g, ' ').trim();
  // Resumes very often set the name in all caps as a design choice. Dropping
  // "PRIYA SHARMA" straight into a form field looks like shouting, so
  // title-case it — but only when the whole string is uppercase, so a
  // deliberately mixed-case name like "van der Berg" survives untouched.
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, sep, ch) => sep + ch.toUpperCase());
}

/**
 * "Bengaluru, India" / "San Francisco, CA" / "Manchester, United Kingdom".
 *
 * The comma is required. A bare city name is indistinguishable from a surname
 * at this point in the document, and guessing wrong drops someone's name into
 * the location field — worse than leaving it blank for them to fill in.
 */
const PLACE = /^[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,2},\s*[A-Z][A-Za-z.'-]+(?:\s[A-Z][A-Za-z.'-]+){0,2}$/;

function extractLocation(header) {
  for (const line of header.slice(0, 6)) {
    // Contact rows pack several things onto one line separated by pipes,
    // bullets or middots — split before testing each piece.
    for (const part of line.text.split(/\s*[|·•]\s*/)) {
      const token = part.trim();
      if (!token || token.length > 44) continue;
      if (/[@\d]/.test(token) || SECTION_WORDS.test(token)) continue;
      if (PLACE.test(token)) return { value: token, confidence: 'medium' };
    }
  }
  return { value: null, confidence: 'low' };
}

function extractContact(allText) {
  const email = (allText.match(RE.email) || [])[0] || null;

  // Strip anything that could masquerade as a phone number before searching:
  // dates, ZIP-like runs and the email itself are the usual false positives.
  const phoneHunt = allText
    .replace(new RegExp(RE.email.source, 'gi'), ' ')
    .replace(new RegExp(RE.dateRange.source, 'gi'), ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ');

  // Contact details sit at the top of essentially every resume, so search the
  // header first. A project bullet further down that happens to contain a long
  // digit run should never outrank the number in the letterhead.
  const phone = findPhone(phoneHunt.slice(0, 600)) || findPhone(phoneHunt);

  const linkedin = (allText.match(RE.linkedin) || [])[0] || null;
  const github = (allText.match(RE.github) || [])[0] || null;

  let portfolio = null;
  for (const url of allText.match(new RegExp(RE.url.source, 'gi')) || []) {
    if (!/linkedin\.com|github\.com/i.test(url) && !url.includes('@')) { portfolio = url; break; }
  }

  return {
    email:    { value: email,    confidence: email ? 'high' : 'low' },
    phone:    { value: phone,    confidence: phone ? 'high' : 'low' },
    linkedin: { value: linkedin ? withProtocol(linkedin) : null, confidence: linkedin ? 'high' : 'low' },
    github:   { value: github ? withProtocol(github) : null,     confidence: github ? 'high' : 'low' },
    portfolio:{ value: portfolio ? withProtocol(portfolio) : null, confidence: portfolio ? 'medium' : 'low' }
  };
}

/** First digit run in `text` that plausibly is a phone number. */
function findPhone(text) {
  for (const raw of text.match(new RegExp(RE.phone.source, 'g')) || []) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 15) return normalisePhone(raw);
  }
  return null;
}

const withProtocol = u => /^https?:\/\//i.test(u) ? u : 'https://' + u.replace(/^\/+/, '');

function normalisePhone(raw) {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return '+' + digits;

  // A country code can only be inferred from a signal in the number itself.
  // A parenthesised three-digit area code — (415) 555-0182 — is a US/Canada
  // convention, and a bare 10-digit starting 6-9 is an Indian mobile, which is
  // the dominant case for Aptus. Anything else is left as digits rather than
  // guessed at: a wrong country code is worse than none.
  if (digits.length === 10 && /^\(\d{3}\)/.test(raw.trim())) return '+1' + digits;
  if (digits.length === 10 && /^[6-9]/.test(digits)) return '+91' + digits;
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return digits;
}

/* ---------- dates ---------- */

function parseMonthYear(text) {
  const t = text.trim().toLowerCase();
  if (/present|current|now|till date|^date$/.test(t)) return new Date();

  const named = t.match(/^([a-z]{3,9})\.?\s*(\d{4})$/);
  if (named && MONTHS[named[1].slice(0, 4)] !== undefined) {
    return new Date(+named[2], MONTHS[named[1].slice(0, 4)]);
  }
  if (named && MONTHS[named[1].slice(0, 3)] !== undefined) {
    return new Date(+named[2], MONTHS[named[1].slice(0, 3)]);
  }
  const numeric = t.match(/^(\d{1,2})[\/.](\d{4})$/);
  if (numeric) return new Date(+numeric[2], +numeric[1] - 1);

  const yearOnly = t.match(/^(\d{4})$/);
  if (yearOnly) return new Date(+yearOnly[1], 0);

  return null;
}

/**
 * Total professional experience, in years, from the date ranges found in the
 * experience section. Overlapping ranges are merged — concurrent roles must
 * not double-count, which is the classic way these numbers end up inflated.
 */
function totalExperienceYears(ranges) {
  const spans = ranges
    .map(r => [parseMonthYear(r.from), parseMonthYear(r.to)])
    .filter(([a, b]) => a && b && b >= a)
    .sort((a, b) => a[0] - b[0]);
  if (!spans.length) return null;

  const merged = [spans[0]];
  for (const [start, end] of spans.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = new Date(Math.max(last[1], end));
    else merged.push([start, end]);
  }
  const months = merged.reduce((sum, [a, b]) =>
    sum + (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()), 0);
  return Math.round(months / 12 * 10) / 10;
}

/* ---------- experience ---------- */

const COMPANY_HINT = /\b(inc|llc|ltd|limited|pvt|private|corp|corporation|technologies|technology|solutions|systems|labs?|consulting|services|group|gmbh|plc|co\.|company|software|analytics|digital)\b/i;
const TITLE_HINT = /\b(engineer|developer|scientist|analyst|manager|architect|consultant|lead|director|head|specialist|designer|administrator|intern|associate|principal|senior|junior|sr\.?|jr\.?|vp|president|officer|executive|coordinator|programmer)\b/i;

const stripBullet = t => t.replace(/^[•▪◦*\-–—]\s*/, '').trim();

/**
 * Date ranges anchor the section: each one starts an entry.
 *
 * The lines between two date ranges are ambiguous — the top of that block is
 * the previous role's responsibilities, and the bottom is the next role's
 * title and employer. So they are resolved bottom-up: offer the last couple of
 * lines to the incoming entry, and whatever it does not take stays with the
 * outgoing one. Deciding a line's role before knowing what follows it is what
 * makes single-pass versions of this attribute bullets to the wrong job.
 */
function extractExperience(lines) {
  const dateIdx = [];
  lines.forEach((line, i) => { if (RE.dateRange.test(line.text)) dateIdx.push(i); });
  if (!dateIdx.length) return { entries: [], ranges: [] };

  const entries = [];
  const ranges = [];

  dateIdx.forEach((d, n) => {
    const match = lines[d].text.match(RE.dateRange);
    const entry = { title: null, company: null, from: match[1], to: match[2], bullets: [] };
    ranges.push({ from: match[1], to: match[2] });

    // Some layouts put the title, the employer and the dates on one line.
    const sameLine = trimSeparators(lines[d].text.replace(match[0], ' ').replace(/\s+/g, ' '));
    if (sameLine) assignRole(entry, sameLine);

    const block = lines.slice(n === 0 ? 0 : dateIdx[n - 1] + 1, d);
    const candidates = block.slice(-2);
    let consumed = 0;

    for (let k = candidates.length - 1; k >= 0; k--) {
      if (entry.title && entry.company) break;
      const before = `${entry.title}|${entry.company}`;
      assignRole(entry, candidates[k].text);
      if (`${entry.title}|${entry.company}` === before) break; // took nothing; stop climbing
      consumed++;
    }

    // Whatever the incoming entry did not claim belongs to the previous one.
    if (n > 0) {
      entries[n - 1].bullets.push(
        ...block.slice(0, block.length - consumed).map(l => stripBullet(l.text)).filter(Boolean));
    }
    entries.push(entry);
  });

  entries[entries.length - 1].bullets.push(
    ...lines.slice(dateIdx[dateIdx.length - 1] + 1).map(l => stripBullet(l.text)).filter(Boolean));

  return { entries: entries.map(e => ({ ...e, bullets: e.bullets.slice(0, 8) })), ranges };
}

const ROLE_SPLIT = /\s*[|·•]\s*|\s+(?:at|@|,)\s+|\s*,\s*(?=[A-Z])|\s+[-–—]\s+/;

/**
 * Fill whichever of title/company is still empty.
 *
 * "Lead Frontend Engineer, Meridian Digital Ltd" is one line holding both, so
 * split first and place each half by its own hint rather than dropping the
 * whole string into title.
 */
function assignRole(entry, text) {
  const clean = trimSeparators(text);
  if (!clean || clean.length > 120) return;

  const parts = clean.split(ROLE_SPLIT).map(trimSeparators).filter(Boolean);
  if (parts.length > 1 && parts.length <= 3) {
    // Place confidently-hinted parts first so a "Ltd" fragment claims company
    // before an unhinted fragment falls through to it.
    const hinted = parts.filter(p => TITLE_HINT.test(p) || COMPANY_HINT.test(p));
    const rest = parts.filter(p => !hinted.includes(p));
    [...hinted, ...rest].forEach(p => assignOne(entry, p));
    return;
  }
  assignOne(entry, clean);
}

function assignOne(entry, text) {
  const clean = trimSeparators(text);
  if (!clean || clean.length > 90) return;

  const isCompany = COMPANY_HINT.test(clean);
  const isTitle = TITLE_HINT.test(clean);

  if (isTitle && !isCompany && !entry.title) { entry.title = clean; return; }
  if (isCompany && !isTitle && !entry.company) { entry.company = clean; return; }
  if (!entry.title) entry.title = clean;
  else if (!entry.company) entry.company = clean;
}

const trimSeparators = t => t.replace(/^[|,•\-–—\s]+|[|,•\-–—\s]+$/g, '').trim();

/* ---------- education ---------- */

const DEGREE = /\b(b\.?\s?tech|b\.?\s?e\.?|b\.?\s?sc|b\.?\s?com|b\.?\s?a\.?|bca|bba|m\.?\s?tech|m\.?\s?e\.?|m\.?\s?sc|m\.?\s?a\.?|mca|mba|ph\.?\s?d|bachelor|master|doctorate|diploma|hsc|ssc)\b/i;
const INSTITUTION = /\b(university|college|institute|school|academy|iit|nit|iiit|iim|bits)\b/i;

const stripYear = t =>
  trimSeparators(t.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s+/g, ' '));

function extractEducation(lines) {
  const entries = [];
  let current = null;

  for (const line of lines) {
    const text = line.text.trim();
    if (!text) continue;
    const year = (text.match(/\b(19|20)\d{2}\b/g) || []).pop() || null;

    // A bare year on its own line belongs to the entry above it.
    if (/^\W*(19|20)\d{2}\W*$/.test(text)) {
      if (current && !current.year) current.year = year;
      continue;
    }

    const hasDegree = DEGREE.test(text);
    const hasInstitution = INSTITUTION.test(text);

    if (hasDegree) {
      if (current) entries.push(current);
      current = { degree: null, institution: null, year };
      splitEducationLine(current, text);
    } else if (current && hasInstitution && !current.institution) {
      current.institution = stripYear(text);
      if (year && !current.year) current.year = year;
    } else if (!current && hasInstitution) {
      current = { degree: null, institution: stripYear(text), year };
    }
  }
  if (current) entries.push(current);
  return entries.slice(0, 5);
}

/** "BSc Computer Science, University of Manchester, 2016" -> degree + institution. */
function splitEducationLine(entry, text) {
  for (const part of text.split(/\s*[,|·]\s*/).map(stripYear).filter(Boolean)) {
    if (INSTITUTION.test(part) && !entry.institution) entry.institution = part;
    else if (DEGREE.test(part) && !entry.degree) entry.degree = part;
    else if (!entry.degree) entry.degree = part;
  }
  if (!entry.degree) entry.degree = stripYear(text);
}

/* ------------------------------------------------------------------ *
 * 5. Entry point
 * ------------------------------------------------------------------ */

/**
 * @param {TextItem[]} items - from readers.js
 * @returns parsed resume with a confidence per field
 */
export function parseResume(items) {
  const lines = groupIntoLines(items);
  const { sections, header, order } = groupIntoSections(lines);
  const allText = lines.map(l => l.text).join('\n');

  const name = extractName(header);
  const location = extractLocation(header);
  const contact = extractContact(allText);

  const experienceLines = sections.experience || [];
  const { entries: experience, ranges } = extractExperience(experienceLines);
  const years = totalExperienceYears(ranges);

  const education = extractEducation(sections.education || []);

  // Skills found inside a skills section are asserted; skills found elsewhere
  // are merely mentioned, so they score lower.
  const skillsSectionText = (sections.skills || []).map(l => l.text).join('\n');
  const skills = matchSkills(skillsSectionText, allText);

  const current = experience.find(e => /present|current|now|till/i.test(e.to || ''));

  return {
    fields: {
      name: name.value,
      location: location.value,
      email: contact.email.value,
      phone: contact.phone.value,
      linkedin: contact.linkedin.value,
      github: contact.github.value,
      portfolio: contact.portfolio.value,
      totalExperienceYears: years,
      currentCompany: current?.company || experience[0]?.company || null,
      currentTitle: current?.title || experience[0]?.title || null,
      skills: skills.map(s => s.name),
      experience,
      education
    },
    confidence: {
      name: name.confidence,
      location: location.confidence,
      email: contact.email.confidence,
      phone: contact.phone.confidence,
      linkedin: contact.linkedin.confidence,
      github: contact.github.confidence,
      portfolio: contact.portfolio.confidence,
      totalExperienceYears: years != null ? (ranges.length >= 2 ? 'medium' : 'low') : 'low',
      currentCompany: current?.company ? 'medium' : 'low',
      currentTitle: current?.title ? 'medium' : 'low',
      skills: skills.length >= 3 ? 'medium' : 'low',
      // Structural extraction is the weakest part of any rule-based parser.
      // "medium" here means every entry came out with a title, an employer and
      // a date range — never that the mapping between them is guaranteed right.
      experience: experience.length && experience.every(e => e.title && e.company) ? 'medium' : 'low',
      education: education.length && education.every(e => e.degree && e.institution) ? 'medium' : 'low'
    },
    debug: {
      lineCount: lines.length,
      sectionsFound: order,
      headerLines: header.map(l => l.text),
      dateRanges: ranges,
      skillMatches: skills
    }
  };
}
