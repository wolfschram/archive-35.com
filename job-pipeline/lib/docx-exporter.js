/**
 * DOCX Exporter — Creates formatted .docx cover letters
 *
 * Called by package-builder.js to produce cover_letter.docx in /ready/[company]/
 * Uses the same formatting logic as server.js /api/cover-letter/export-docx
 *
 * Features:
 *   - Wolf's name as bold header
 *   - Contact line with clickable email and LinkedIn hyperlinks
 *   - Clean paragraph formatting (Arial 11pt)
 *   - US Letter page size, 1" margins
 */

const { Document, Packer, Paragraph, TextRun, ExternalHyperlink } = require('docx');
const fs = require('fs');

/**
 * Export a cover letter to .docx with embedded LinkedIn hyperlink.
 *
 * @param {string} content - The cover letter text (with letterhead)
 * @param {string} outputPath - Full path for the .docx file
 * @param {Object} opts - { company, title, name }
 * @param {Object} personalInfo - { linkedin_url, email, ... } from personal_info table
 */
async function exportCoverLetter(content, outputPath, opts = {}, personalInfo = {}) {
  const name = opts.name || personalInfo.full_name || 'Wolfgang Schram';

  const paragraphs = content.split('\n').map(line => {
    const trimmed = line.trim();

    // Bold name header
    if (trimmed === name || trimmed === 'Wolf Schram' || trimmed === 'Wolfgang Schram') {
      return new Paragraph({
        spacing: { after: 40 },
        children: [new TextRun({ text: trimmed, bold: true, size: 24, font: 'Arial' })]
      });
    }

    // Contact info line (pipe-separated, contains email or LinkedIn)
    if (trimmed.includes('|') && (trimmed.includes('@') || trimmed.includes('linkedin'))) {
      const parts = trimmed.split('|').map(s => s.trim());
      const children = [];
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) children.push(new TextRun({ text: ' | ', size: 19, font: 'Arial', color: '555555' }));
        const part = parts[i];

        // Email — clickable mailto link
        const emailMatch = part.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
        if (emailMatch) {
          children.push(new ExternalHyperlink({
            children: [new TextRun({ text: emailMatch[1], style: 'Hyperlink', size: 19, font: 'Arial' })],
            link: 'mailto:' + emailMatch[1],
          }));
        // LinkedIn — clickable URL
        } else if (part.match(/linkedin\.com/i)) {
          const url = part.startsWith('http') ? part : 'https://' + part;
          children.push(new ExternalHyperlink({
            children: [new TextRun({ text: part, style: 'Hyperlink', size: 19, font: 'Arial' })],
            link: url,
          }));
        } else {
          children.push(new TextRun({ text: part, size: 19, font: 'Arial', color: '555555' }));
        }
      }
      return new Paragraph({ spacing: { after: 200 }, children });
    }

    // Sign-off
    if (trimmed === 'Best regards,' || trimmed === 'Sincerely,') {
      return new Paragraph({
        spacing: { before: 200, after: 40 },
        children: [new TextRun({ text: trimmed, size: 22, font: 'Arial' })]
      });
    }

    // Empty line
    if (!trimmed) {
      return new Paragraph({ spacing: { after: 80 }, children: [] });
    }

    // Regular paragraph
    return new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: trimmed, size: 22, font: 'Arial' })]
    });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
        }
      },
      children: paragraphs
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return { success: true, path: outputPath, size: buffer.length };
}

module.exports = { exportCoverLetter };
