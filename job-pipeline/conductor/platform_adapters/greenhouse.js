/**
 * Greenhouse ATS Platform Adapter
 *
 * Handles job applications on Greenhouse-powered career pages.
 * Greenhouse URLs typically: boards.greenhouse.io/{company}/jobs/{id}
 */

const GREENHOUSE_PATTERNS = [
  /boards\.greenhouse\.io/i,
  /greenhouse\.io\/embed/i,
  /job_app\[/i, // Greenhouse form field naming
];

async function detectPlatform(page, url) {
  // URL-based detection
  if (GREENHOUSE_PATTERNS.some(p => p.test(url))) return true;

  // DOM-based detection
  try {
    const ghForm = await page.$('form#application_form, form[action*="greenhouse"], div#main_content[class*="greenhouse"]');
    if (ghForm) return true;

    // Check for Greenhouse-specific field naming
    const ghField = await page.$('input[name^="job_app["]');
    if (ghField) return true;
  } catch {}

  return false;
}

async function fillForm(page, fields, job) {
  const fieldMappings = [
    { sel: '#first_name, input[name="job_app[first_name]"]', val: fields.first_name },
    { sel: '#last_name, input[name="job_app[last_name]"]', val: fields.last_name },
    { sel: '#email, input[name="job_app[email]"]', val: fields.email },
    { sel: '#phone, input[name="job_app[phone]"]', val: fields.phone },
    { sel: 'input[name*="linkedin" i], input[id*="linkedin" i]', val: fields.linkedin },
    { sel: 'input[name*="location" i], input[name*="city" i]', val: fields.location },
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
}

async function uploadResume(page, filePath) {
  // Greenhouse uses a file input with data-field="resume"
  const selectors = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][data-field="resume"]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"]', // fallback: first file input
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

  // Greenhouse sometimes hides the file input behind a button
  try {
    const uploadBtn = await page.$('button:has-text("Attach"), a:has-text("Attach")');
    if (uploadBtn) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5000 }),
        uploadBtn.click(),
      ]);
      await fileChooser.setFiles(filePath);
      return true;
    }
  } catch {}

  return false;
}

async function pasteCoverLetter(page, text) {
  // Greenhouse cover letter field
  const selectors = [
    'textarea[name*="cover_letter" i]',
    'textarea[id*="cover_letter" i]',
    '#cover_letter',
    'textarea[name="job_app[cover_letter]"]',
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.fill(text);
        return true;
      }
    } catch {}
  }
  return false;
}

async function parseQuestions(page) {
  const questions = [];
  try {
    // Greenhouse custom questions are in fieldsets or divs with class "field"
    const questionEls = await page.$$('.field, fieldset, [data-question]');
    for (const el of questionEls) {
      const label = await el.$('label');
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
    '#submit_app',
    'button[type="submit"]',
    'input[type="submit"][value*="Submit" i]',
    'button:has-text("Submit Application")',
    'button:has-text("Submit")',
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
  // Check which fields are filled
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
    platform: 'greenhouse',
    url,
    title,
    filledFields,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  name: 'greenhouse',
  detectPlatform,
  fillForm,
  uploadResume,
  pasteCoverLetter,
  parseQuestions,
  detectSubmitButton,
  checkpoint,
};
