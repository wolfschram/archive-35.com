/**
 * Generic ATS Adapter
 * Fallback for unknown platforms — smart field detection by label/placeholder/name
 */

module.exports = {
  name: 'generic',

  detectPlatform() {
    return true; // Always matches as fallback
  },

  async fillForm(page, fields, job) {
    // Strategy: find all visible inputs, match by label/placeholder/name
    const inputs = await page.$$('input:visible, select:visible');

    for (const input of inputs) {
      try {
        const info = await input.evaluate(el => {
          const type = el.type || 'text';
          if (['hidden', 'submit', 'button', 'file', 'checkbox', 'radio'].includes(type)) return null;

          const name = (el.name || '').toLowerCase();
          const id = (el.id || '').toLowerCase();
          const ph = (el.placeholder || '').toLowerCase();
          const label = el.labels?.[0]?.textContent?.toLowerCase() || '';
          const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
          const allText = name + ' ' + id + ' ' + ph + ' ' + label + ' ' + ariaLabel;
          const hasValue = !!el.value;
          return { type, allText, hasValue };
        });

        if (!info || info.hasValue) continue;
        const t = info.allText;

        if (t.includes('first') && t.includes('name')) {
          await input.fill(fields.first_name || '');
          console.log('  [generic] Filled first name');
        } else if (t.includes('last') && t.includes('name')) {
          await input.fill(fields.last_name || '');
          console.log('  [generic] Filled last name');
        } else if ((t.includes('full') && t.includes('name')) || (t.includes('name') && !t.includes('first') && !t.includes('last') && !t.includes('company'))) {
          await input.fill(fields.name || '');
          console.log('  [generic] Filled full name');
        } else if (t.includes('email')) {
          await input.fill(fields.email || '');
          console.log('  [generic] Filled email');
        } else if (t.includes('phone') || t.includes('tel') || t.includes('mobile')) {
          await input.fill(fields.phone || '');
          console.log('  [generic] Filled phone');
        } else if (t.includes('linkedin')) {
          await input.fill(fields.linkedin || '');
          console.log('  [generic] Filled LinkedIn');
        } else if (t.includes('location') || t.includes('city') || t.includes('address')) {
          await input.fill(fields.location || '');
          console.log('  [generic] Filled location');
        } else if (t.includes('website') || t.includes('portfolio') || t.includes('url')) {
          await input.fill(fields.linkedin || '');
          console.log('  [generic] Filled website/portfolio');
        }
      } catch {}
    }
  },

  async uploadResume(page, resumePath) {
    const fileInputs = await page.$$('input[type="file"]');

    // Try to find specifically labeled resume upload
    for (const input of fileInputs) {
      try {
        const label = await input.evaluate(el => {
          const container = el.closest('div') || el.closest('label') || el.parentElement;
          return (container?.textContent || '').toLowerCase().slice(0, 200);
        });
        if (label.includes('resume') || label.includes('cv')) {
          await input.setInputFiles(resumePath);
          console.log('  [generic] Resume uploaded (labeled)');
          return true;
        }
      } catch {}
    }

    // Fallback: first file input
    if (fileInputs.length > 0) {
      try {
        await fileInputs[0].setInputFiles(resumePath);
        console.log('  [generic] Resume uploaded (first file input)');
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
          const container = el.closest('div') || el.closest('label') || el.parentElement;
          return (container?.textContent || '').toLowerCase().slice(0, 200);
        });
        if (label.includes('cover') || label.includes('letter')) {
          await input.setInputFiles(coverLetterPath);
          console.log('  [generic] Cover letter uploaded (labeled)');
          return true;
        }
      } catch {}
    }

    // Second file input is often cover letter
    if (fileInputs.length > 1) {
      try {
        await fileInputs[1].setInputFiles(coverLetterPath);
        console.log('  [generic] Cover letter uploaded (second file input)');
        return true;
      } catch {}
    }
    return false;
  },

  async pasteCoverLetter(page, text) {
    const textareas = await page.$$('textarea:visible');
    for (const ta of textareas) {
      try {
        const label = await ta.evaluate(el => {
          const container = el.closest('div') || el.parentElement;
          return (container?.textContent || '').toLowerCase().slice(0, 200);
        });
        if (label.includes('cover') || label.includes('letter') || label.includes('additional') || label.includes('message')) {
          await ta.fill(text);
          console.log('  [generic] Cover letter pasted');
          return true;
        }
      } catch {}
    }
    return false;
  },
};
