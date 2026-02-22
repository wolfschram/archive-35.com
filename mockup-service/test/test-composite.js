/**
 * Test script for the mockup compositing engine.
 * Generates a test mockup using a real photo from the photography/ directory.
 */

'use strict';

const path = require('path');
const fs = require('fs').promises;
const { generateMockup, generatePlatformMockup } = require('../src/compositor');
const { listTemplates } = require('../src/templates');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_DIR = path.join(__dirname, 'output');

async function runTests() {
  console.log('=== Archive-35 Mockup Engine — Test Suite ===\n');

  // Ensure output dir
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  // 1. Test template loading
  console.log('1. Loading templates...');
  const templates = await listTemplates();
  console.log(`   Found ${templates.length} template(s)`);
  if (templates.length === 0) {
    console.error('   ERROR: No templates found. Run generate-test-room.js first.');
    process.exit(1);
  }
  const template = templates[0];
  console.log(`   Using template: ${template.id} (${template.name})`);
  console.log(`   Image: ${template.imagePath}`);
  console.log(`   Zones: ${template.placementZones.length}`);

  // 2. Find a test photo
  console.log('\n2. Finding test photo...');
  const icelandDir = path.join(REPO_ROOT, 'photography', 'Iceland');
  const photos = await fs.readdir(icelandDir);
  const testPhoto = path.join(icelandDir, photos[0]);
  console.log(`   Using: ${photos[0]}`);

  // 3. Generate full-resolution mockup
  console.log('\n3. Generating full-resolution mockup (24x36)...');
  const startFull = Date.now();
  const fullMockup = await generateMockup({
    photoPath: testPhoto,
    template: template,
    printSize: '24x36',
    quality: 'high'
  });
  const fullTime = Date.now() - startFull;
  const fullPath = path.join(OUTPUT_DIR, 'test-mockup-full.jpg');
  await fs.writeFile(fullPath, fullMockup);
  console.log(`   Done in ${fullTime}ms — ${(fullMockup.length / 1024).toFixed(0)}KB`);
  console.log(`   Saved: ${fullPath}`);

  // 4. Generate platform-specific mockups
  const platforms = ['etsy', 'pinterest', 'web-full', 'web-thumb'];
  for (const platform of platforms) {
    console.log(`\n4. Generating ${platform} mockup...`);
    const start = Date.now();
    const result = await generatePlatformMockup({
      photoPath: testPhoto,
      template: template,
      printSize: '24x36',
      platform: platform,
      quality: 'high'
    });
    const elapsed = Date.now() - start;
    const outPath = path.join(OUTPUT_DIR, `test-mockup-${platform}.jpg`);
    await fs.writeFile(outPath, result);
    console.log(`   Done in ${elapsed}ms — ${(result.length / 1024).toFixed(0)}KB → ${outPath}`);
  }

  // 5. Test different print sizes
  console.log('\n5. Testing print size variations...');
  for (const size of ['16x24', '20x30', '24x36']) {
    const start = Date.now();
    const result = await generateMockup({
      photoPath: testPhoto,
      template: template,
      printSize: size,
      quality: 'high'
    });
    const elapsed = Date.now() - start;
    const outPath = path.join(OUTPUT_DIR, `test-mockup-${size.replace('x', '_')}.jpg`);
    await fs.writeFile(outPath, result);
    console.log(`   ${size}: ${elapsed}ms — ${(result.length / 1024).toFixed(0)}KB`);
  }

  console.log('\n=== All tests passed! ===');
  console.log(`Output files in: ${OUTPUT_DIR}`);
}

runTests().catch(err => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
