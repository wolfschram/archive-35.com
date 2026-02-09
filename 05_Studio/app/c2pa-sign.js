/**
 * Archive-35 C2PA Content Credentials Signer
 *
 * Signs a JPEG image with C2PA provenance metadata using Python c2pa-python.
 * Called during photo ingest to embed content credentials in web-optimized images.
 *
 * Prerequisites:
 *   pip install c2pa-python
 *   Certificate files in 07_C2PA/ directory
 *
 * Usage:
 *   const { signImageC2PA } = require('./c2pa-sign');
 *   await signImageC2PA(imagePath, { title, author, location, year });
 */

const { execFile, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ARCHIVE_BASE = path.join(__dirname, '..', '..');
const C2PA_DIR = path.join(ARCHIVE_BASE, '07_C2PA');
const CERT_CHAIN = path.join(C2PA_DIR, 'chain.pem');
const PRIVATE_KEY = path.join(C2PA_DIR, 'signer_pkcs8.key');

/**
 * Find a Python 3.10+ with c2pa module installed.
 * Electron's PATH is minimal, so we check common locations.
 */
let _resolvedPython = null;
function findPython() {
  if (_resolvedPython) return _resolvedPython;
  const candidates = [
    '/opt/homebrew/bin/python3',
    '/usr/local/bin/python3',
    'python3',
    'python'
  ];
  for (const py of candidates) {
    try {
      execFileSync(py, ['-c', 'import c2pa'], { timeout: 5000, stdio: 'pipe' });
      _resolvedPython = py;
      console.log(`C2PA: using Python at ${py}`);
      return py;
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Check if C2PA signing is available (cert + key + python module exist)
 */
function isC2PAAvailable() {
  try {
    return fs.existsSync(CERT_CHAIN) && fs.existsSync(PRIVATE_KEY) && !!findPython();
  } catch {
    return false;
  }
}

/**
 * Sign a single JPEG image with C2PA Content Credentials.
 *
 * @param {string} imagePath - Absolute path to the JPEG to sign (modified in-place)
 * @param {Object} metadata - Photo metadata
 * @param {string} metadata.title - Photo title
 * @param {string} [metadata.author='Wolf'] - Photographer name
 * @param {string} [metadata.location] - Location where photo was taken
 * @param {number|string} [metadata.year=2024] - Year photo was taken
 * @param {string} [metadata.description] - Photo description
 * @returns {Promise<{success: boolean, error?: string}>}
 */
function signImageC2PA(imagePath, metadata = {}) {
  return new Promise((resolve) => {
    if (!isC2PAAvailable()) {
      resolve({ success: false, error: 'C2PA certificates not found in 07_C2PA/' });
      return;
    }

    const title = metadata.title || path.basename(imagePath, '.jpg');
    const author = metadata.author || 'Wolf';
    const location = metadata.location || '';
    const year = parseInt(metadata.year) || 2024;
    const description = metadata.description || `Fine art photograph by ${author}`;

    // Inline Python script for signing
    const pythonScript = `
import sys, json, os, shutil, ctypes
try:
    import c2pa
except ImportError:
    print(json.dumps({"success": False, "error": "c2pa-python not installed. Run: pip install c2pa-python"}))
    sys.exit(0)

img_path = sys.argv[1]
meta = json.loads(sys.argv[2])
cert_path = sys.argv[3]
key_path = sys.argv[4]

with open(cert_path, 'rb') as f:
    cert = f.read()
with open(key_path, 'rb') as f:
    key = f.read()

signer_info = c2pa.C2paSignerInfo.__new__(c2pa.C2paSignerInfo)
ctypes.Structure.__init__(signer_info, b'es256', cert, key, None)

creative_work = {
    "@context": "https://schema.org",
    "@type": "Photograph",
    "author": [{"@type": "Person", "name": meta["author"], "url": "https://archive-35.com"}],
    "copyrightYear": meta["year"],
    "copyrightHolder": {"@type": "Person", "name": meta["author"]},
    "name": meta["title"],
    "description": meta["description"]
}
if meta.get("location"):
    creative_work["locationCreated"] = {"@type": "Place", "name": meta["location"]}

manifest = {
    "claim_generator": "Archive-35-Studio/1.0",
    "title": meta["title"],
    "assertions": [
        {"label": "stds.schema-org.CreativeWork", "data": creative_work},
        {"label": "c2pa.actions", "data": {"actions": [
            {"action": "c2pa.created", "softwareAgent": {"name": "Canon EOS", "version": "1.0"}}
        ]}}
    ]
}

try:
    builder = c2pa.Builder(manifest)
    signer = c2pa.Signer.from_info(signer_info)
    tmp_path = img_path + ".c2pa.tmp"
    with open(img_path, 'rb') as source:
        with open(tmp_path, 'w+b') as dest:
            builder.sign(signer, 'image/jpeg', source, dest)
    shutil.move(tmp_path, img_path)
    print(json.dumps({"success": True}))
except Exception as e:
    if os.path.exists(img_path + ".c2pa.tmp"):
        os.remove(img_path + ".c2pa.tmp")
    print(json.dumps({"success": False, "error": str(e)}))
`;

    const metaJson = JSON.stringify({
      title,
      author,
      location,
      year,
      description
    });

    const pythonBin = findPython();
    if (!pythonBin) {
      resolve({ success: false, error: 'No Python with c2pa module found. Install: pip3 install c2pa-python' });
      return;
    }

    execFile(pythonBin, ['-c', pythonScript, imagePath, metaJson, CERT_CHAIN, PRIVATE_KEY],
      { timeout: 30000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ success: false, error: `C2PA signing failed: ${error.message}${stderr ? ' — ' + stderr : ''}` });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch {
          resolve({ success: false, error: 'Failed to parse C2PA result' });
        }
      }
    );
  });
}

module.exports = { signImageC2PA, isC2PAAvailable };
