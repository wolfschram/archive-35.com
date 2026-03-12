/**
 * Application Package Builder
 *
 * Creates the /ready/[company_name]/ folder structure defined in AGENT_CHARTER_v2.md:
 *
 *   /ready/[company_name]/
 *     ├── cover_letter.md          — Generated cover letter (Markdown)
 *     ├── cover_letter.docx        — Cover letter (Word doc for upload)
 *     ├── resume.pdf               — Copy of Wolf's resume
 *     ├── metadata.json            — Job details, score, status, timestamps
 *     └── qa_answers.md            — Standard Q&A answers (if available)
 *
 * Called when Wolf approves a cover letter.
 * The ATS bot reads from this folder to fill forms and upload files.
 */

const path = require('path');
const fs = require('fs');

const BASE_DIR = path.join(__dirname, '..');
const READY_DIR = path.join(BASE_DIR, 'ready');
const APPLIED_DIR = path.join(BASE_DIR, 'applied');
const TEMPLATES_DIR = path.join(BASE_DIR, 'templates');
const RESUME_SOURCE = path.join(TEMPLATES_DIR, 'Wolfgang Schram Resume PDF Feb 2026.pdf');

/**
 * Create a clean folder name from company name
 */
function companyFolder(company) {
  return (company || 'unknown')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

/**
 * Build the full application package for a job.
 *
 * @param {Object} db - SQLite database instance
 * @param {number} jobId - Job ID
 * @returns {Object} { success, packagePath, files[] }
 */
async function buildPackage(db, jobId) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: `Job ${jobId} not found` };

  // Get the latest cover letter
  const letter = db.prepare(
    'SELECT * FROM cover_letter_versions WHERE job_id = ? ORDER BY version DESC LIMIT 1'
  ).get(jobId);

  if (!letter) return { success: false, error: 'No cover letter found for this job' };

  // Load personal info (needed for docx export and Q&A)
  const personalInfo = {};
  try {
    const rows = db.prepare('SELECT key, value FROM personal_info').all();
    for (const r of rows) personalInfo[r.key] = r.value;
  } catch {}

  // Create folder: /ready/[Company_Name]/
  const folderName = companyFolder(job.company);
  const packagePath = path.join(READY_DIR, folderName);
  fs.mkdirSync(packagePath, { recursive: true });

  const files = [];

  // 1. Cover letter as Markdown
  const clMdPath = path.join(packagePath, 'cover_letter.md');
  fs.writeFileSync(clMdPath, letter.content, 'utf8');
  files.push({ name: 'cover_letter.md', path: clMdPath, type: 'cover_letter' });

  // 2. Cover letter as .docx with embedded LinkedIn hyperlink
  try {
    const docxExporter = require('./docx-exporter');
    const docxPath = path.join(packagePath, 'cover_letter.docx');
    await docxExporter.exportCoverLetter(letter.content, docxPath, {
      company: job.company,
      title: job.title,
      name: personalInfo.full_name || 'Wolfgang Schram',
    }, personalInfo);
    files.push({ name: 'cover_letter.docx', path: docxPath, type: 'cover_letter_docx' });
  } catch (e) {
    console.log(`  [package] DOCX export failed: ${e.message} — falling back to .txt`);
    // Fallback: save as .txt
    const txtPath = path.join(packagePath, 'cover_letter.txt');
    fs.writeFileSync(txtPath, letter.content, 'utf8');
    files.push({ name: 'cover_letter.txt', path: txtPath, type: 'cover_letter_txt' });
  }

  // 3. Copy resume PDF
  if (fs.existsSync(RESUME_SOURCE)) {
    const resumeDest = path.join(packagePath, 'Wolfgang_Schram_Resume.pdf');
    fs.copyFileSync(RESUME_SOURCE, resumeDest);
    files.push({ name: 'Wolfgang_Schram_Resume.pdf', path: resumeDest, type: 'resume' });
  } else {
    console.log(`  [package] WARNING: Resume not found at ${RESUME_SOURCE}`);
  }

  // 4. Metadata JSON
  const metadata = {
    job_id: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    source: job.source,
    score: job.score,
    status: job.status,
    cover_letter_version: letter.version,
    package_created: new Date().toISOString(),
    package_path: packagePath,
  };
  const metaPath = path.join(packagePath, 'metadata.json');
  fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
  files.push({ name: 'metadata.json', path: metaPath, type: 'metadata' });

  // 5. Q&A answers
  try {
    const qaContent = [
      `# Application Q&A — ${job.company}`,
      `## ${job.title}`,
      '',
      '### Standard Fields',
      `- **Full Name:** ${personalInfo.full_name || 'Wolfgang Schram'}`,
      `- **Email:** ${personalInfo.email || 'wolfbroadcast@gmail.com'}`,
      `- **Phone:** ${personalInfo.phone || ''}`,
      `- **Location:** ${personalInfo.location || 'Los Angeles, CA'}`,
      `- **LinkedIn:** ${personalInfo.linkedin_url || ''}`,
      '',
      '### Positioning',
      `- **Summary:** ${personalInfo.resume_summary || ''}`,
      `- **Target Titles:** ${personalInfo.target_titles || ''}`,
      `- **Salary Range:** ${personalInfo.salary_range || ''}`,
      '',
      '### Why This Company',
      `(Extracted from cover letter for ${job.company})`,
      '',
    ];

    const qaPath = path.join(packagePath, 'qa_answers.md');
    fs.writeFileSync(qaPath, qaContent.join('\n'), 'utf8');
    files.push({ name: 'qa_answers.md', path: qaPath, type: 'qa_answers' });
  } catch {}

  console.log(`  [package] Built package for ${job.company}: ${files.length} files in ${packagePath}`);

  return {
    success: true,
    packagePath,
    folderName,
    files,
    job: { id: job.id, company: job.company, title: job.title },
  };
}

/**
 * Move a package from /ready/ to /applied/ after submission.
 */
function archivePackage(db, jobId) {
  const job = db.prepare('SELECT company FROM jobs WHERE id = ?').get(jobId);
  if (!job) return { success: false, error: 'Job not found' };

  const folderName = companyFolder(job.company);
  const readyPath = path.join(READY_DIR, folderName);
  const appliedPath = path.join(APPLIED_DIR, folderName);

  if (!fs.existsSync(readyPath)) {
    return { success: false, error: `Package not found at ${readyPath}` };
  }

  fs.mkdirSync(APPLIED_DIR, { recursive: true });

  // Move (rename) from /ready/ to /applied/
  fs.renameSync(readyPath, appliedPath);

  console.log(`  [package] Archived: ${readyPath} → ${appliedPath}`);
  return { success: true, from: readyPath, to: appliedPath };
}

/**
 * Get the package path for a job (checks /ready/ first, then /applied/).
 */
function getPackagePath(db, jobId) {
  const job = db.prepare('SELECT company FROM jobs WHERE id = ?').get(jobId);
  if (!job) return null;

  const folderName = companyFolder(job.company);
  const readyPath = path.join(READY_DIR, folderName);
  const appliedPath = path.join(APPLIED_DIR, folderName);

  if (fs.existsSync(readyPath)) return { path: readyPath, location: 'ready' };
  if (fs.existsSync(appliedPath)) return { path: appliedPath, location: 'applied' };
  return null;
}

/**
 * List all packages in /ready/.
 */
function listReadyPackages() {
  if (!fs.existsSync(READY_DIR)) return [];

  return fs.readdirSync(READY_DIR)
    .filter(f => fs.statSync(path.join(READY_DIR, f)).isDirectory())
    .map(f => {
      const metaPath = path.join(READY_DIR, f, 'metadata.json');
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch {}
      const files = fs.readdirSync(path.join(READY_DIR, f));
      return {
        folder: f,
        path: path.join(READY_DIR, f),
        files,
        hasResume: files.some(fn => fn.endsWith('.pdf')),
        hasCoverLetter: files.some(fn => fn.startsWith('cover_letter')),
        ...meta,
      };
    });
}

module.exports = {
  buildPackage,
  archivePackage,
  getPackagePath,
  listReadyPackages,
  companyFolder,
  READY_DIR,
  APPLIED_DIR,
};
