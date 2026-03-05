/**
 * Lever ATS Platform Adapter
 *
 * Handles job applications on Lever-powered career pages.
 * Lever URLs typically: jobs.lever.co/{company}/{id} or {company}.lever.co
 */

const LEVER_PATTERNS = [
  /jobs\.lever\.co/i,
  /\.lever\.co/i,
  /lever-jobs-embed/i,
];

async function detectPlatform(page, url) {
  if (LEVER_PATTERNS.some(p => p.test(url))) return true;

  try {
    const leverForm = await page.$('.application-form, form[action*="lever"], .lever-application');
    if (leverForm) return true;
    // Lever uses specific class names
    const leverEl = await page.$('.posting-page, .posting-headline');
    if (leverEl) return true;
  } catch {}

  return false;
}

async function fillForm(page, fields, job) {
  // Lever uses card-based layout with specific field names
  const fieldMappings = [
    { sel: 'input[name="name"]', val: fields.name },
    { sel: 'input[name="email"]', val: fields.email },
    { sel: 'input[name="phone"]', val: fields.phone },
    { sel: 'input[name="org"], input[name="company"]', val: '' }, // Current company (skip)
    { sel: 'input[name*="linkedin" i], input[placeholder*="linkedin" i]', val: fields.linkedin },
    { sel: 'input[name*="location" i]', val: fields.location },
  ];

  for (const { sel, val } of fieldMappings) {
    if (!val) continue;
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        await el.fill(val);
      }
    } catch {}
  }

  // Lever multi-step: some forms have "Continue" between sections
  try {
    const continueBtn = await page.$('button:has-text("Continue"), button:has-text("Next")');
    if (continueBtn && await continueBtn.isVisible()) {
      // Don't auto-click — let Wolf decide
    }
  } catch {}
}

async function uploadResume(page, filePath) {
  // Lever uses drag-and-drop or file input for resume
  const selectors = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"].resume-upload',
    '.resume-upload input[type="file"]',
    'input[type="file"]', // fallback
  ];

  for (const sel of selectors) {
    try {
      const input = await page.$(sel);
      if (input) {
        await input.setInputFiles(filePath);
        return true;
      }
    } catch {}
  }

  // Lever sometimes has a "Upload resume" button
  try {
    const uploadArea = await page.$('.resume-upload-area, [data-qa="resume-upload"]');
    if (uploadArea) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        uploadArea.click(),
      ]);
      await fileChooser.setFiles(filePath);
      return true;
    }
  } catch {}

  return false;
}

async function pasteCoverLetter(page, text) {
  const selectors = [
    'textarea[name*="comments" i]', // Lever uses "comments" for cover letter
    'textarea[name*="cover" i]',
    'textarea.application-answer',
    '.ql-editor', // Quill rich text editor (some Lever instances)
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        if (sel === '.ql-editor') {
          // Rich text editor — use keyboard
          await el.click();
          await page.keyboard.insertText(text);
        } else {
          await el.fill(text);
        }
        return true;
      }
    } catch {}
  }
  return false;
}

async function parseQuestions(page) {
  const questions = [];
  try {
    const questionEls = await page.$$('.application-question, .custom-question, [data-qa="question"]');
    for (const el of questionEls) {
      const label = await el.$('label, .question-label');
      if (!label) continue;
      const text = await label.textContent();
      const input = await el.$('input, textarea, select');
      const type = input ? await input.getAttribute('type') || await input.evaluate(n => n.tagName.toLowerCase()) : 'unknown';
      questions.push({ text: text.trim(), type, element: el });
    }
  } catch {}
  return questions;
}

async function detectSubmitButton(page) {
  const selectors = [
    'button[type="submit"]',
    'button:has-text("Submit application")',
    'button:has-text("Submit")',
    'button.postings-btn',
    'a.postings-btn:has-text("Submit")',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el && await el.isVisible()) return el;
    } catch {}
  }
  return null;
}

async function checkpoint(page) {
  const url = page.url();
  const title = await page.title();
  const filledFields = [];
  try {
    const inputs = await page.$$('input:not([type="hidden"]), textarea, select');
    for (const input of inputs) {
      const name = await input.getAttribute('name') || await input.getAttribute('id') || '';
      const value = await input.inputValue().catch(() => '');
      if (value) filledFields.push(name);
    }
  } catch {}

  return {
    platform: 'lever',
    url,
    title,
    filledFields,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  name: 'lever',
  detectPlatform,
  fillForm,
  uploadResume,
  pasteCoverLetter,
  parseQuestions,
  detectSubmitButton,
  checkpoint,
};
