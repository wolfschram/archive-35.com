/**
 * Lever ATS Adapter
 * Handles jobs.lever.co application forms
 */

const LEVER_PATTERNS = [
  'jobs.lever.co',
  'lever.co/apply',
];

module.exports = {
  name: 'lever',

  detectPlatform(page, url) {
    return LEVER_PATTERNS.some(p => url.includes(p));
  },

  async fillForm(page, fields, job) {
    // Lever uses a clean form with specific selectors
    const fieldMappings = [
      { sel: 'input[name="name"]', val: fields.name },
      { sel: 'input[name="email"]', val: fields.email },
      { sel: 'input[name="phone"]', val: fields.phone },
      { sel: 'input[name="org"]', val: '' }, // Current company - leave blank or fill
      { sel: 'input[name="urls[LinkedIn]"]', val: fields.linkedin },
      { sel: 'input[name="urls[Portfolio]"]', val: '' },
      { sel: 'input[name="urls[GitHub]"]', val: '' },
      { sel: 'input[name="urls[Twitter]"]', val: '' },
      { sel: 'input[name="urls[Other]"]', val: '' },
    ];

    for (const { sel, val } of fieldMappings) {
      if (val === undefined) continue;
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.click();
          await el.fill('');
          await el.type(val, { delay: 30 });
          console.log(`  [lever] Filled: ${sel}`);
        }
      } catch (e) {
        console.log(`  [lever] Skip ${sel}: ${e.message}`);
      }
    }

    // Handle location/additional fields by label text
    const inputs = await page.$$('.application-question input[type="text"]');
    for (const input of inputs) {
      try {
        const label = await input.evaluate(el => {
          return (el.closest('.application-question')?.querySelector('label')?.textContent || '').toLowerCase();
        });
        const val = await input.inputValue();
        if (val) continue;

        if (label.includes('location') || label.includes('city')) {
          await input.fill(fields.location || '');
        } else if (label.includes('linkedin')) {
          await input.fill(fields.linkedin || '');
        }
      } catch {}
    }
  },

  async uploadResume(page, resumePath) {
    // Lever has a "Resume/CV" file upload section
    const fileInputs = await page.$$('input[type="file"]');

    for (const input of fileInputs) {
      try {
        const label = await input.evaluate(el => {
          const section = el.closest('.application-dropzone') || el.closest('.section') || el.closest('div');
          return (section?.textContent || '').toLowerCase();
        });

        if (label.includes('resume') || label.includes('cv')) {
          await input.setInputFiles(resumePath);
          console.log('  [lever] Resume uploaded');
          return true;
        }
      } catch {}
    }

    if (fileInputs.length > 0) {
      await fileInputs[0].setInputFiles(resumePath);
      return true;
    }
    return false;
  },

  async uploadCoverLetter(page, coverLetterPath) {
    const fileInputs = await page.$$('input[type="file"]');
    for (const input of fileInputs) {
      try {
        const label = await input.evaluate(el => {
          const section = el.closest('.application-dropzone') || el.closest('.section') || el.closest('div');
          return (section?.textContent || '').toLowerCase();
        });
        if (label.includes('cover') || label.includes('letter')) {
          await input.setInputFiles(coverLetterPath);
          console.log('  [lever] Cover letter uploaded');
          return true;
        }
      } catch {}
    }
    if (fileInputs.length > 1) {
      await fileInputs[1].setInputFiles(coverLetterPath);
      return true;
    }
    return false;
  },

  async pasteCoverLetter(page, text) {
    const textareas = await page.$$('textarea');
    for (const ta of textareas) {
      try {
        const label = await ta.evaluate(el => {
          const q = el.closest('.application-question');
          return (q?.querySelector('label')?.textContent || '').toLowerCase();
        });
        if (label.includes('cover') || label.includes('additional') || label.includes('note')) {
          await ta.fill(text);
          console.log('  [lever] Cover letter pasted');
          return true;
        }
      } catch {}
    }
    return false;
  },
};
