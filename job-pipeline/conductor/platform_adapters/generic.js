/**
 * Generic ATS Platform Adapter
 *
 * Best-effort form filling for simple HTML forms that don't match
 * a specific platform adapter. Works for basic name/email/file forms.
 */

async function detectPlatform(/* page, url */) {
  // Generic always matches as fallback — never call this for detection.
  // The bot uses this when no other adapter matches.
  return true;
}

async function fillForm(page, fields /*, job */) {
  // Try common field patterns
  const strategies = [
    // Strategy 1: name attributes
    { first: 'input[name*="first" i]', last: 'input[name*="last" i]', email: 'input[name*="email" i]', phone: 'input[name*="phone" i]' },
    // Strategy 2: id attributes
    { first: 'input[id*="first" i]', last: 'input[id*="last" i]', email: 'input[id*="email" i]', phone: 'input[id*="phone" i]' },
    // Strategy 3: placeholder text
    { first: 'input[placeholder*="first" i]', last: 'input[placeholder*="last" i]', email: 'input[placeholder*="email" i]', phone: 'input[placeholder*="phone" i]' },
    // Strategy 4: label associations
    { first: null, last: null, email: 'input[type="email"]', phone: 'input[type="tel"]' },
  ];

  // Try full name field first
  const nameSels = ['input[name*="full_name" i]', 'input[name="name"]', 'input[id="name"]', 'input[placeholder*="full name" i]'];
  for (const sel of nameSels) {
    try {
      const el = await page.$(sel);
      if (el) { await el.fill(fields.name); break; }
    } catch {}
  }

  // Then try first/last + email + phone from each strategy
  for (const strat of strategies) {
    await tryFill(page, strat.first, fields.first_name);
    await tryFill(page, strat.last, fields.last_name);
    await tryFill(page, strat.email, fields.email);
    await tryFill(page, strat.phone, fields.phone);
  }

  // LinkedIn
  await tryFill(page, 'input[name*="linkedin" i], input[placeholder*="linkedin" i]', fields.linkedin);

  // Location
  await tryFill(page, 'input[name*="location" i], input[name*="city" i], input[placeholder*="location" i]', fields.location);
}

async function tryFill(page, selector, value) {
  if (!selector || !value) return false;
  try {
    const el = await page.$(selector);
    if (el) {
      await el.fill(value);
      return true;
    }
  } catch {}
  return false;
}

async function uploadResume(page, filePath) {
  // Look for any file input, preferring ones labeled "resume"
  const selectors = [
    'input[type="file"][name*="resume" i]',
    'input[type="file"][id*="resume" i]',
    'input[type="file"][accept*="pdf" i]',
    'input[type="file"]',
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
  return false;
}

async function pasteCoverLetter(page, text) {
  const selectors = [
    'textarea[name*="cover" i]',
    'textarea[name*="letter" i]',
    'textarea[placeholder*="cover" i]',
    'textarea[id*="cover" i]',
    'div[contenteditable="true"]',
    'textarea', // last resort: first textarea
  ];

  for (const sel of selectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        if (sel === 'div[contenteditable="true"]') {
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
    // Look for label+input pairs
    const labels = await page.$$('label');
    for (const label of labels) {
      const text = await label.textContent();
      const forId = await label.getAttribute('for');
      if (!forId) continue;
      const input = await page.$(`#${forId}`);
      if (!input) continue;
      const type = await input.getAttribute('type') || await input.evaluate(n => n.tagName.toLowerCase());
      questions.push({ text: text.trim(), type });
    }
  } catch {}
  return questions;
}

async function detectSubmitButton(page) {
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Submit")',
    'button:has-text("Apply")',
    'button:has-text("Send")',
    'a:has-text("Submit")',
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
    platform: 'generic',
    url,
    title,
    filledFields,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  name: 'generic',
  detectPlatform,
  fillForm,
  uploadResume,
  pasteCoverLetter,
  parseQuestions,
  detectSubmitButton,
  checkpoint,
};
