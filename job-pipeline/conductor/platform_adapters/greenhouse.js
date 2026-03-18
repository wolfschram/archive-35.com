/**
 * Greenhouse ATS Adapter
 * Handles boards.greenhouse.io application forms
 * Common employers: GitLab, many tech companies
 */

const GREENHOUSE_PATTERNS = [
  'boards.greenhouse.io',
  'greenhouse.io/embed',
  'job_app', // greenhouse URL param
];

module.exports = {
  name: 'greenhouse',

  detectPlatform(page, url) {
    return GREENHOUSE_PATTERNS.some(p => url.includes(p));
  },

  async fillForm(page, fields, job) {
    // Greenhouse uses standard HTML forms with known IDs
    const fieldMappings = [
      { sel: '#first_name', val: fields.first_name },
      { sel: '#last_name', val: fields.last_name },
      { sel: '#email', val: fields.email },
      { sel: '#phone', val: fields.phone },
      { sel: 'input[name="job_application[phone]"]', val: fields.phone },
      { sel: 'input[name="job_application[location]"]', val: fields.location },
      // Greenhouse custom fields — LinkedIn URL
      { sel: 'input[autocomplete="custom-question-linkedin-profile"]', val: fields.linkedin },
    ];

    for (const { sel, val } of fieldMappings) {
      if (!val) continue;
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          await el.fill('');
          await el.type(val, { delay: 30 });
          console.log(`  [greenhouse] Filled: ${sel}`);
        }
      } catch (e) {
        console.log(`  [greenhouse] Skip ${sel}: ${e.message}`);
      }
    }

    // Also try generic input matching for custom fields
    const inputs = await page.$$('input[type="text"], input[type="email"], input[type="tel"]');
    for (const input of inputs) {
      try {
        const label = await input.evaluate(el => {
          const id = el.id || el.name || '';
          const lbl = el.closest('div')?.querySelector('label')?.textContent || '';
          const ph = el.placeholder || '';
          return (id + ' ' + lbl + ' ' + ph).toLowerCase();
        });

        if (!label) continue;
        const val = await input.inputValue();
        if (val) continue; // Already filled

        if (label.includes('linkedin')) {
          await input.fill(fields.linkedin || '');
        } else if (label.includes('website') || label.includes('portfolio')) {
          await input.fill(fields.linkedin || '');
        } else if (label.includes('location') || label.includes('city')) {
          await input.fill(fields.location || '');
        }
      } catch {}
    }
  },

  async uploadResume(page, resumePath) {
    // Greenhouse has a file input for resume
    const fileInputs = await page.$$('input[type="file"]');

    for (const input of fileInputs) {
      try {
        const label = await input.evaluate(el => {
          const container = el.closest('.field') || el.closest('div');
          return (container?.textContent || '').toLowerCase();
        });

        if (label.includes('resume') || label.includes('cv')) {
          await input.setInputFiles(resumePath);
          console.log('  [greenhouse] Resume uploaded');
          return true;
        }
      } catch {}
    }

    // Fallback: first file input is usually resume
    if (fileInputs.length > 0) {
      try {
        await fileInputs[0].setInputFiles(resumePath);
        console.log('  [greenhouse] Resume uploaded (first file input)');
        return true;
      } catch {}
    }
    return false;
  },

  async uploadCoverLetter(page, coverLetterPath) {
    const fileInputs = await page.$$('input[type="file"]');

    for (const input of fileInputs) {
      try {
        const label = await input.evaluate(el => {
          const container = el.closest('.field') || el.closest('div');
          return (container?.textContent || '').toLowerCase();
        });

        if (label.includes('cover') || label.includes('letter')) {
          await input.setInputFiles(coverLetterPath);
          console.log('  [greenhouse] Cover letter uploaded');
          return true;
        }
      } catch {}
    }

    // Second file input is often cover letter
    if (fileInputs.length > 1) {
      try {
        await fileInputs[1].setInputFiles(coverLetterPath);
        console.log('  [greenhouse] Cover letter uploaded (second file input)');
        return true;
      } catch {}
    }
    return false;
  },

  async pasteCoverLetter(page, text) {
    // Some Greenhouse forms have a text area for cover letter
    const textareas = await page.$$('textarea');
    for (const ta of textareas) {
      try {
        const label = await ta.evaluate(el => {
          const container = el.closest('.field') || el.closest('div');
          return (container?.textContent || '').toLowerCase();
        });
        if (label.includes('cover') || label.includes('letter') || label.includes('additional')) {
          await ta.fill(text);
          console.log('  [greenhouse] Cover letter pasted into textarea');
          return true;
        }
      } catch {}
    }
    return false;
  },
};
