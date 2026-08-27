# Aptus Careers — resume parser & form glue

Browser-side code for the Aptus Data Labs careers application form. Served to the
live Webflow site via jsDelivr, so **this repo is public and contains only what a
browser must fetch**.

```
careers-resume-parser/
  resume-parser.js   rule-based parser: text items -> lines -> sections -> fields
  skills.js          controlled skills vocabulary (75 canonical skills + aliases)
  readers.js         PDF / DOCX / TXT readers (pdf.js + mammoth, loaded on demand)

careers-hubspot/
  careers-form.js    embeds the HubSpot form and wires the parser into it
```

The HubSpot setup scripts, CRM schema, sample resumes, tests and build specs are
deliberately **not** here — they document portal configuration and internal notes
that do not belong on a public CDN.

## What it does

A candidate uploads a resume. It is parsed **in their browser** — no AI, no API
calls, and the file is never transmitted — and the parsed values pre-fill the
application form. The candidate corrects anything wrong, and HubSpot's own form
submission carries it into the CRM.

Fields the parser fills: name, location, email, phone, LinkedIn/GitHub, current
company and title, total experience (computed from date ranges with overlaps
merged), and skills matched against the controlled vocabulary.

Every field carries a confidence. Low-confidence values are flagged for the
candidate to check rather than filed silently — rule-based parsing is reliable on
contact details and much weaker on work history, so the human stays the final
validator.

## Use in Webflow

Site settings → Custom code → Footer (sets the `hubspotutk` cookie, without which
repeat applicants create duplicate contacts):

```html
<script id="hs-script-loader" async defer src="//js-na2.hs-scripts.com/46652299.js"></script>
```

On the job template page, a div plus an Embed element:

```html
<div id="careers-form"></div>
<script type="module">
  import { mountCareersForm } from 'https://cdn.jsdelivr.net/gh/rahulAptus/Career-Form-Parser@v1.0.0/careers-hubspot/careers-form.js';

  mountCareersForm({
    formId: '<hubspot form guid>',
    job: {
      id:        '<-- CMS: Job ID -->',
      title:     '<-- CMS: Name -->',
      area:      '<-- CMS: Career area -->',
      location:  '<-- CMS: Location -->',
      workModel: '<-- CMS: Work model -->'
    }
  });
</script>
```

**Pin a version tag, never `@main`.** jsDelivr caches aggressively and a push to
main would otherwise change the live careers page with no deploy step.

The CMS Option values for career area and work model must match the HubSpot
dropdown options character for character — a mismatch is dropped silently and the
deal arrives with a blank column.

## Two things that look like bugs and are not

**HubSpot form fields are React-controlled.** Assigning `input.value` leaves the
field looking filled and submitting empty. `careers-form.js` goes through the
prototype's native value setter and dispatches a real `input` event, and ticks
checkboxes with `click()` rather than `checked = true`. Keep that if you rewrite it.

**The embed is region-specific.** This portal is on **na2**, so the script is
`js-na2.hsforms.net`, not `js.hsforms.net`. A mismatched region fails to render at
all.

## Releasing

```bash
git tag v1.0.1 && git push origin v1.0.1
```

Then update the version in the Webflow embed. jsDelivr serves the new tag within
a few minutes; existing tags are immutable, so nothing changes underneath you.
