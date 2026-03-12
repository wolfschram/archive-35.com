/**
 * Workday ATS Adapter
 * Handles myworkdayjobs.com and wd5.myworkdayjobs.com application forms
 * Common employers: large enterprises, media companies
 */

const WORKDAY_PATTERNS = [
  'myworkdayjobs.com',
  'myworkday.com',
  'workday.com/en-US/applications',
];

module.exports = {
  name: 'workday',

  detectPlatform(page, url) {
    return WORKDAY_PATTERNS.some(p => url.includes(p));
  },

  async fillForm(page, fields, job) {
    // Workday is a complex SPA — need to wait for React to render
    await page.waitForTimeout(3000);

    // Workday uses data-automation-id attributes
    const fieldMappings = [
      { sel: '[data-automation-id="legalNameSection_firstName"] input', val: fields.first_name },
      { sel: '[data-automation-id="legalNameSection_lastName"] input', val: fields.last_name },
      { sel: '[data-automation-id="email"] input', val: fields.email },
      { sel: '[data-automation-id="phone-number"] input', val: fields.phone },
      { sel: '[data-automation-id="addressSection_city"] input', val: fields.location },
    ];

    for (const { sel, val } of fieldMappings) {
      if (!val) continue;
      try {
        const el = await page.$(sel);
        if (el && await el.isVisible()) {
          await el.click({ clickCount: 3 }); // Select all
          await el.type(val, { delay: 50 });
          console.log(`  [workday] Filled: ${sel}`);
        }
      } catch (e) {
        console.log(`  [workday] Skip ${sel}: ${e.message}`);
      }
    }

    // Workday often has "Source" dropdown — try to select LinkedIn or Website
    try {
      const sourceDropdown = await page.$('[data-automation-id="source"] button, [data-automation-id="sourceSection"] button');
      if (sourceDropdown) {
        await sourceDropdown.click();
        await page.waitForTimeout(500);
        const options = await page.$$('[data-automation-id="promptOption"]');
        for (const opt of options) {
          const text = await opt.textContent();
          if (text.toLowerCase().includes('linkedin') || text.toLowerCase().includes('website')) {
            await opt.click();
            console.log(`  [workday] Source set to: ${text}`);
            break;
          }
        }
      }
    } catch {}

    // Generic label-based filling for custom questions
    const allInputs = await page.$$('input[type="text"]');
    for (const input of allInputs) {
      try {
        const val = await input.inputValue();
        if (val) continue;
        const label = await input.evaluate(el => {
          const container = el.closest('[data-automation-id]') || el.closest('div');
          return (container?.textContent || '').toLowerCase().slice(0, 100);
        });
        if (label.includes('linkedin')) await input.fill(fields.linkedin || '');
        else if (label.includes('website') || label.includes('portfolio')) await input.fill(fields.linkedin || '');
      } catch {}
    }
  },

  async uploadResume(page, resumePath) {
    // Workday file upload uses data-automation-id="file-upload-input-ref"
    const fileInputs = await page.$$('input[type="file"]');
    for (const input of fileInputs) {
      try {
        await input.setInputFiles(resumePath);
        console.log('  [workday] Resume uploaded');
        await page.waitForTimeout(2000); // Wait for upload processing
        return true;
      } catch {}
    }

    // Sometimes Workday uses a button that triggers a hidden file input
    try {
      const uploadBtn = await page.$('[data-automation-id="file-upload-input-ref"]');
      if (uploadBtn) {
        await uploadBtn.setInputFiles(resumePath);
        return true;
      }
    } catch {}
    return false;
  },

  async uploadCoverLetter(page, coverLetterPath) {
    // Workday often allows multiple file uploads
    const fileInputs = await page.$$('input[type="file"]');
    if (fileInputs.length > 1) {
      try {
        await fileInputs[1].setInputFiles(coverLetterPath);
        console.log('  [workday] Cover letter uploaded');
        return true;
      } catch {}
    }
    return false;
  },

  async pasteCoverLetter(page, text) {
    const textareas = await page.$$('textarea');
    for (const ta of textareas) {
      try {
        const label = await ta.evaluate(el => {
          const container = el.closest('[data-automation-id]') || el.closest('div');
          return (container?.textContent || '').toLowerCase().slice(0, 100);
        });
        if (label.includes('cover') || label.includes('additional') || label.includes('summary')) {
          await ta.fill(text);
          console.log('  [workday] Cover letter pasted');
          return true;
        }
      } catch {}
    }
    return false;
  },
};
