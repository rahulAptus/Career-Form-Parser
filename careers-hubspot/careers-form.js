/**
 * Careers application form — HubSpot embed + resume parser.
 *
 * Drops a native HubSpot form onto the page, then wires the client-side parser
 * into it: the candidate picks a resume, the parser fills the fields, the
 * candidate corrects anything wrong, and HubSpot's own submission carries it
 * into the CRM. No Aptus backend is involved and no token exists in the page.
 *
 * Follows the same embed pattern as aptus-contact-form.html — `cssRequired:
 * false` with a `target`, which renders the form inline rather than in an
 * iframe, so the fields are reachable from this script.
 *
 * Usage in Webflow (Embed element, or page custom code before </body>):
 *
 *   <div id="careers-form"></div>
 *   <script type="module">
 *     import { mountCareersForm } from 'https://cdn.jsdelivr.net/gh/<org>/<repo>@<tag>/careers-form.js';
 *     mountCareersForm({
 *       formId: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
 *       job: {
 *         id: 'ADL-1042', title: 'Senior Data Engineer',
 *         area: 'Data Engineering', location: 'Bengaluru', workModel: 'Hybrid'
 *       }
 *     });
 *   </script>
 *
 * On a CMS-driven job page the `job` values come from the Collection item.
 */

import { readFile, ScannedPdfError, validateFile } from '../careers-resume-parser/readers.js';
import { parseResume } from '../careers-resume-parser/resume-parser.js';

const PORTAL_ID = '46652299';

/*
 * The account reports uiDomain "app-na2.hubspot.com", so it lives in na2 —
 * but aptus-contact-form.html embeds with region 'na1'. One of the two is
 * wrong, and a mismatched region makes the embed fail to render at all.
 *
 * Defaulting to the account's actual region. If the contact form is genuinely
 * working in production on na1, pass region:'na1' to mountCareersForm and
 * raise it — that would mean the account was migrated and the old embed is
 * being redirected, which is worth knowing before it stops being.
 */
const REGION = 'na2';
/*
 * The embed script is served per region: na2 portals load js-na2.hsforms.net,
 * not js.hsforms.net. Confirmed against the embed code HubSpot generated for
 * form 8ac965a3 on this portal.
 */
const embedUrl = region =>
  `https://js${region === 'na1' ? '' : '-' + region}.hsforms.net/forms/embed/v2.js`;
const UTM_KEY = 'aptus_utm';

/* ------------------------------------------------------------------ *
 * HubSpot form fields are React-controlled
 * ------------------------------------------------------------------ */

/**
 * Assigning `input.value` directly does not update React's internal state, so
 * HubSpot submits an empty field even though the UI looks correct. Going
 * through the prototype's native setter and then dispatching `input` is what
 * makes React notice.
 */
function setNativeValue(el, value) {
  // The setter is brand-checked against its own interface: calling the
  // HTMLInputElement one on a <select> throws "Illegal invocation". The
  // Applied-to fields are dropdowns, so getting this wrong threw inside
  // onFormReady and silently skipped every fill after it.
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype :
    el instanceof HTMLSelectElement   ? HTMLSelectElement.prototype :
                                        HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value); else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function fillText(form, name, value) {
  if (value === null || value === undefined || value === '') return false;
  const el = form.querySelector(`[name="${name}"]`);
  if (!el || el.type === 'file') return false;
  if (el.tagName === 'SELECT') {
    const match = [...el.options].find(o => o.value === String(value) || o.text === String(value));
    if (!match) return false;
    setNativeValue(el, match.value);
    return true;
  }
  setNativeValue(el, String(value));
  return true;
}

/** Tick the boxes in a HubSpot multi-select whose values are in `values`. */
function fillMulti(form, name, values) {
  const boxes = form.querySelectorAll(`input[type="checkbox"][name="${name}"]`);
  if (!boxes.length) return 0;
  const wanted = new Set(values);
  let ticked = 0;
  for (const box of boxes) {
    if (wanted.has(box.value) && !box.checked) {
      box.click(); // click(), not checked=true — React needs the real event
      ticked++;
    }
  }
  return ticked;
}

/** Amber outline plus a note, so the candidate knows what to double-check. */
function markForReview(form, name, message) {
  const el = form.querySelector(`[name="${name}"]`);
  const field = el?.closest('.hs-form-field');
  if (!field || field.querySelector('.aptus-review')) return;
  field.style.setProperty('--aptus-review', '1');
  if (el) { el.style.borderColor = '#e8c98a'; el.style.background = '#fffdf7'; }
  const note = document.createElement('p');
  note.className = 'aptus-review';
  note.textContent = message || 'Please check this — we read it from your resume.';
  note.style.cssText = 'margin:6px 0 0;font-size:11.5px;color:#8a6714;line-height:1.45';
  field.appendChild(note);
}

function clearReviewMarks(form) {
  form.querySelectorAll('.aptus-review').forEach(n => n.remove());
  form.querySelectorAll('.hs-form-field input, .hs-form-field select').forEach(el => {
    el.style.borderColor = '';
    el.style.background = '';
  });
}

/* ------------------------------------------------------------------ *
 * Attribution
 * ------------------------------------------------------------------ */

/**
 * UTM values are captured on first landing and kept for the session, because
 * a candidate rarely applies on the same pageview that brought them in — they
 * read Life at Aptus first, and by submission the query string is long gone.
 */
function captureUtm() {
  const params = new URLSearchParams(location.search);
  const fresh = {};
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const value = params.get(key);
    if (value) fresh[key] = value;
  }
  if (Object.keys(fresh).length) {
    try { sessionStorage.setItem(UTM_KEY, JSON.stringify(fresh)); } catch { /* private mode */ }
    return fresh;
  }
  try { return JSON.parse(sessionStorage.getItem(UTM_KEY) || '{}'); } catch { return {}; }
}

/* ------------------------------------------------------------------ *
 * Parser wiring
 * ------------------------------------------------------------------ */

const STATUS_ID = 'aptus-parse-status';

function status(form, text, tone = 'info') {
  let el = form.querySelector('#' + STATUS_ID);
  if (!el) {
    el = document.createElement('div');
    el.id = STATUS_ID;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    const file = form.querySelector('input[type="file"]');
    (file?.closest('.hs-form-field') || form).appendChild(el);
  }
  const tones = {
    info: 'background:#edf5fc;border:1px solid #bcd9f2;color:#1a5f96',
    ok: 'background:#f0f8ea;border:1px solid #d8ecc4;color:#456b28',
    warn: 'background:#fef8ec;border:1px solid #f3e2b8;color:#7a5c17',
    err: 'background:#fdecea;border:1px solid #f5c4bd;color:#a33227'
  };
  el.style.cssText = `margin-top:10px;padding:10px 13px;border-radius:9px;font-size:12.5px;line-height:1.5;${tones[tone]}`;
  el.textContent = text;
}

async function handleResume(form, file) {
  const invalid = validateFile(file);
  if (invalid) return status(form, invalid, 'err');

  clearReviewMarks(form);
  status(form, 'Reading your resume…');

  let result;
  try {
    result = parseResume(await readFile(file));
  } catch (err) {
    // A scan with no text layer is an expected outcome, not a failure. Say so
    // and let them type — never leave the form looking broken.
    status(form, err instanceof ScannedPdfError
      ? err.message
      : 'We could not read that file automatically. Please fill the form in below — your resume still uploads fine.',
      'warn');
    fillText(form, 'candidate_parse_confidence', 'Manual');
    return;
  }

  const { fields, confidence } = result;
  const map = [
    ['firstname', (fields.name || '').split(/\s+/)[0], 'name'],
    ['lastname', (fields.name || '').split(/\s+/).slice(1).join(' '), 'name'],
    ['email', fields.email, 'email'],
    ['phone', fields.phone, 'phone'],
    ['candidate_current_company', fields.currentCompany, 'currentCompany'],
    ['candidate_current_title', fields.currentTitle, 'currentTitle'],
    ['candidate_total_experience_years', fields.totalExperienceYears, 'totalExperienceYears'],
    ['candidate_linkedin_url', fields.linkedin, 'linkedin'],
    ['candidate_portfolio_url', fields.github || fields.portfolio, 'portfolio']
  ];

  let filled = 0;
  const review = [];
  for (const [fieldName, value, confidenceKey] of map) {
    if (!fillText(form, fieldName, value)) continue;
    filled++;
    if (confidence[confidenceKey] === 'low') {
      markForReview(form, fieldName);
      review.push(fieldName);
    }
  }

  const ticked = fillMulti(form, 'candidate_skills', fields.skills);

  // Record how much of this came from the parser. When the "Manual" and "Low"
  // share of submissions climbs, the parser is failing on real resumes — that
  // is what the parse-quality report on the dashboard is watching for.
  const overall = review.length > 2 ? 'Low' : review.length ? 'Medium' : 'High';
  fillText(form, 'candidate_parse_confidence', overall);

  if (!filled) {
    status(form, 'We could not pull much from that resume. Please fill the form in below.', 'warn');
    return;
  }
  status(form,
    review.length
      ? `Filled ${filled} field${filled === 1 ? '' : 's'}${ticked ? ` and ${ticked} skill${ticked === 1 ? '' : 's'}` : ''}. Please check the highlighted ones before submitting.`
      : `Filled ${filled} field${filled === 1 ? '' : 's'}${ticked ? ` and ${ticked} skill${ticked === 1 ? '' : 's'}` : ''}. Please review everything before submitting.`,
    review.length ? 'warn' : 'ok');
}

/* ------------------------------------------------------------------ *
 * Mount
 * ------------------------------------------------------------------ */

function loadEmbed(region) {
  if (window.hbspt) return Promise.resolve();
  const src = embedUrl(region);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return existing.addEventListener('load', resolve);
    const script = document.createElement('script');
    script.src = src;
    script.charset = 'utf-8';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Could not load the HubSpot form embed.'));
    document.head.appendChild(script);
  });
}

/** onFormReady hands back different shapes across embed versions. */
function nativeForm(ref) {
  if (!ref) return document.querySelector('.hs-form');
  if (ref instanceof HTMLFormElement) return ref;
  if (ref[0] instanceof HTMLFormElement) return ref[0];
  if (typeof ref.querySelector === 'function') return ref.querySelector('form') || ref;
  return document.querySelector('.hs-form');
}

export async function mountCareersForm({
  formId, job = {}, target = '#careers-form',
  portalId = PORTAL_ID, region = REGION, onSubmitted
} = {}) {
  if (!formId) throw new Error('mountCareersForm needs a formId.');
  const utm = captureUtm();
  await loadEmbed(region);

  window.hbspt.forms.create({
    region, portalId, formId, target, cssRequired: false,

    onFormReady(ref) {
      const form = nativeForm(ref);
      if (!form) return console.warn('[aptus] HubSpot form not found in the DOM.');

      // Job context and attribution are hidden fields on the contact; the
      // workflow copies them onto the deal it creates.
      //
      // Filled one at a time rather than in a loop that can abort: a single
      // unexpected field type used to throw here and take the resume listener
      // below down with it, so the form looked fine and parsed nothing.
      for (const [name, value] of [
        ['candidate_applied_job_id', job.id],
        ['candidate_applied_job_title', job.title],
        ['candidate_applied_career_area', job.area],
        ['candidate_applied_location', job.location],
        ['candidate_applied_work_model', job.workModel],
        ['candidate_utm_source', utm.utm_source],
        ['candidate_utm_medium', utm.utm_medium],
        ['candidate_utm_campaign', utm.utm_campaign]
      ]) {
        try {
          fillText(form, name, value);
        } catch (err) {
          console.warn(`[aptus] could not set ${name}:`, err);
        }
      }

      const file = form.querySelector('input[type="file"]');
      if (!file) {
        console.warn('[aptus] No file field on this form — the parser has nothing to read.');
        return;
      }
      file.addEventListener('change', e => {
        if (e.target.files?.[0]) handleResume(form, e.target.files[0]);
      });
      status(form, 'Upload your resume and we will fill in what we can. You can edit everything before submitting.');
    },

    onFormSubmitted() {
      if (typeof onSubmitted === 'function') onSubmitted(job);
    }
  });
}

export default mountCareersForm;
