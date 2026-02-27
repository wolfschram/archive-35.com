#!/usr/bin/env node
/**
 * Test: Frame moulding codes in preorder codes (Phase 4d)
 */

const MATERIAL_MAP = {
  canvas: { material: 'canvas', type: 'stretched', displayName: 'Canvas', additionals: ['semigloss', 'mirrorimage', 'c15', 'none', 'none'] },
  metal: { material: 'metal', type: 'hd', displayName: 'Metal HD', additionals: ['standoff'] },
  acrylic: { material: 'acrylic', type: 'da16', displayName: 'Acrylic' },
  paper: { material: 'paper', type: 'art', displayName: 'Fine Art Paper' },
  wood: { material: 'wood', type: 'natural', displayName: 'Natural Wood' },
};

function buildPreorderCode(material, printWidth, printHeight, subOptions = {}) {
  const mapping = MATERIAL_MAP[material];
  if (!mapping) throw new Error('Unknown material: ' + material);
  const orientation = printWidth >= printHeight ? 'horizontal' : 'vertical';
  const hasSubOptions = subOptions.subType || subOptions.mounting || subOptions.finish || subOptions.edge;
  const frameCode = subOptions.frame || '';
  if (!hasSubOptions && !frameCode) {
    const parts = ['1', mapping.material, mapping.type, orientation, String(printWidth), String(printHeight)];
    if (mapping.additionals && mapping.additionals.some(a => a !== 'none')) parts.push(...mapping.additionals);
    return parts.join('|');
  }
  let type = subOptions.subType || mapping.type;
  let additionals = [];
  switch (material) {
    case 'canvas': {
      if (type === 'rolled') type = 'canvas'; else type = 'stretched';
      const finish = subOptions.finish || 'semigloss';
      const edge = subOptions.edge || 'mirrorimage';
      additionals = [finish, edge];
      if (subOptions.subType === 'c15' || subOptions.subType === 'c075') additionals.push(subOptions.subType);
      additionals.push('none', 'none');
      break;
    }
    case 'metal': case 'acrylic': {
      const mounting = subOptions.mounting || '';
      if (mounting && mounting !== 'none') additionals = [mounting];
      break;
    }
    case 'wood': {
      const mounting = subOptions.mounting || '';
      if (mounting === 'frenchcleat') additionals = ['frenchcleat'];
      break;
    }
    case 'paper': break;
  }
  const parts = ['1', mapping.material, type, orientation, String(printWidth), String(printHeight)];
  if (additionals.length > 0 && additionals.some(a => a !== 'none')) parts.push(...additionals);
  if (frameCode) {
    const frameMountingType = material === 'paper' ? 'frame' : 'moulding';
    parts.push(frameMountingType, frameCode);
  }
  return parts.join('|');
}

const tests = [
  { name: 'Metal HD + standoff + floating frame 303-19',
    args: ['metal', 24, 16, {subType:'hd', mounting:'standoff', frame:'303-19'}],
    expected: '1|metal|hd|horizontal|24|16|standoff|moulding|303-19' },
  { name: 'Canvas c15 + floating frame 317-22',
    args: ['canvas', 24, 16, {subType:'c15', finish:'semigloss', edge:'mirrorimage', frame:'317-22'}],
    expected: '1|canvas|stretched|horizontal|24|16|semigloss|mirrorimage|c15|none|none|moulding|317-22' },
  { name: 'Paper art + picture frame 241-29',
    args: ['paper', 24, 16, {subType:'art', frame:'241-29'}],
    expected: '1|paper|art|horizontal|24|16|frame|241-29' },
  { name: 'Metal HD + standoff, no frame',
    args: ['metal', 24, 16, {subType:'hd', mounting:'standoff'}],
    expected: '1|metal|hd|horizontal|24|16|standoff' },
  { name: 'Canvas legacy (no sub-options, no frame)',
    args: ['canvas', 24, 16, {}],
    expected: '1|canvas|stretched|horizontal|24|16|semigloss|mirrorimage|c15|none|none' },
  { name: 'Acrylic da16 + floating frame 303-12',
    args: ['acrylic', 30, 20, {subType:'da16', frame:'303-12'}],
    expected: '1|acrylic|da16|horizontal|30|20|moulding|303-12' },
  { name: 'Metal frame only (no other sub-options)',
    args: ['metal', 24, 16, {frame:'303-19'}],
    expected: '1|metal|hd|horizontal|24|16|moulding|303-19' },
  { name: 'Paper pearl + picture frame white 241-22',
    args: ['paper', 20, 30, {subType:'pearl', frame:'241-22'}],
    expected: '1|paper|pearl|vertical|20|30|frame|241-22' },
  { name: 'Canvas rolled + floating frame natural 303-12',
    args: ['canvas', 36, 24, {subType:'rolled', finish:'matte', edge:'gallerywrap', frame:'303-12'}],
    expected: '1|canvas|canvas|horizontal|36|24|matte|gallerywrap|none|none|moulding|303-12' },
  { name: 'Wood natural + no frame (frame not applicable but test it)',
    args: ['wood', 24, 16, {subType:'natural'}],
    expected: '1|wood|natural|horizontal|24|16' },
];

let pass = 0, fail = 0;
tests.forEach((t, i) => {
  const result = buildPreorderCode(...t.args);
  if (result === t.expected) {
    console.log(`✅ Test ${i+1}: ${t.name}`);
    console.log(`   ${result}`);
    pass++;
  } else {
    console.log(`❌ Test ${i+1}: ${t.name}`);
    console.log(`   Expected: ${t.expected}`);
    console.log(`   Got:      ${result}`);
    fail++;
  }
});
console.log(`\n${pass}/${pass+fail} tests passed`);
process.exit(fail > 0 ? 1 : 0);
