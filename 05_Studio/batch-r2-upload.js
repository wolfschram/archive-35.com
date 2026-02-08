#!/usr/bin/env node
/**
 * Archive-35: Batch upload all originals to R2
 * Run: node 05_Studio/batch-r2-upload.js
 */
const { S3Client, PutObjectCommand } = require('./app/node_modules/@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
const envContent = fs.readFileSync(path.join(BASE, '.env'), 'utf8');
const env = {};
envContent.split('\n').forEach(l => {
  const m = l.match(/^([A-Z0-9_]+)=(.*)/);
  if (m) env[m[1]] = m[2];
});

const s3 = new S3Client({
  region: 'auto',
  endpoint: env.R2_ENDPOINT,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY }
});

const BUCKET = env.R2_BUCKET_NAME;
const PORTFOLIO = path.join(BASE, '01_Portfolio');

const collections = [
  { folder: 'Africa_' },
  { folder: 'Grand_Teton' },
  { folder: 'New_Zealand_' }
];

async function main() {
  console.log('Archive-35 Batch R2 Upload');
  console.log('Bucket:', BUCKET);
  console.log('========================\n');

  let uploaded = 0, skipped = 0, failed = 0;

  for (const c of collections) {
    const portfolioPath = path.join(PORTFOLIO, c.folder);
    const origDir = path.join(portfolioPath, 'originals');
    const galleryPath = path.join(portfolioPath, '_gallery.json');
    const photosPath = path.join(portfolioPath, '_photos.json');

    // Get slug from _gallery.json
    let slug;
    try {
      const gal = JSON.parse(fs.readFileSync(galleryPath, 'utf8'));
      slug = gal.slug;
    } catch (e) {
      slug = c.folder.toLowerCase().replace(/[_\s]+/g, '-').replace(/-+$/, '');
    }

    console.log(`\n--- ${c.folder} → R2 prefix: ${slug}/ ---`);

    // Get photo list from _photos.json
    let photos;
    try {
      photos = JSON.parse(fs.readFileSync(photosPath, 'utf8'));
    } catch (e) {
      // Fallback: scan originals directory
      const files = fs.readdirSync(origDir).filter(f => /\.(jpg|jpeg|tiff|tif|png)$/i.test(f));
      photos = files.map(f => ({ filename: f }));
    }

    for (const photo of photos) {
      const filePath = path.join(origDir, photo.filename);
      const baseName = photo.filename.replace(/\.[^.]+$/, '');
      const r2Key = `${slug}/${baseName}.jpg`;

      if (!fs.existsSync(filePath)) {
        console.log(`  SKIP (missing): ${photo.filename}`);
        skipped++;
        continue;
      }

      try {
        const fileBuffer = fs.readFileSync(filePath);
        const sizeMB = (fileBuffer.length / 1024 / 1024).toFixed(1);

        await s3.send(new PutObjectCommand({
          Bucket: BUCKET,
          Key: r2Key,
          Body: fileBuffer,
          ContentType: 'image/jpeg',
        }));

        uploaded++;
        console.log(`  [${uploaded}] ${r2Key} (${sizeMB}MB)`);
      } catch (e) {
        failed++;
        console.error(`  FAIL: ${r2Key} — ${e.message}`);
      }
    }
  }

  console.log('\n========================');
  console.log(`DONE: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed`);
  console.log(`Total: ${uploaded + skipped + failed}`);

  // Write result to file for verification
  const result = { uploaded, skipped, failed, timestamp: new Date().toISOString() };
  fs.writeFileSync(path.join(BASE, 'test-reports', 'r2-upload-result.json'), JSON.stringify(result, null, 2));
  console.log('\nResult saved to test-reports/r2-upload-result.json');
}

main().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
