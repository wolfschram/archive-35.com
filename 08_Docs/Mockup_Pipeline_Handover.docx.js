const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType, PageBreak, LevelFormat } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function cell(text, opts = {}) {
  const width = opts.width || 4680;
  const shading = opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined;
  const bold = opts.bold || false;
  const size = opts.size || 20;
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA }, margins: cellMargins, shading,
    children: [new Paragraph({ children: [new TextRun({ text, bold, size, font: "Arial" })] })]
  });
}

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 }, children: [new TextRun({ text, bold: true, size: 32, font: "Arial" })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 160 }, children: [new TextRun({ text, bold: true, size: 26, font: "Arial" })] });
}
function h3(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 120 }, children: [new TextRun({ text, bold: true, size: 22, font: "Arial" })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text, size: opts.size || 20, font: "Arial", bold: opts.bold, italics: opts.italics, color: opts.color })] });
}
function code(text) {
  return new Paragraph({ spacing: { after: 80 }, children: [new TextRun({ text, size: 18, font: "Courier New", color: "333333" })] });
}

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 32, bold: true, font: "Arial" }, paragraph: { spacing: { before: 300, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 26, bold: true, font: "Arial" }, paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true, run: { size: 22, bold: true, font: "Arial" }, paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets2", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets3", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets4", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets5", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets6", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ]
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children: [
      // TITLE
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: "MOCKUP-TO-MARKETING PIPELINE", bold: true, size: 40, font: "Arial", color: "1a1a1a" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: "Handover Documentation for Next Session", size: 24, font: "Arial", color: "666666" })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [new TextRun({ text: "Archive-35.com | February 23, 2026", size: 20, font: "Arial", color: "999999" })] }),

      // SECTION 1: WHAT'S BUILT
      h1("1. What's Built & Working"),

      h2("1.1 Mockup Compositing Engine (Port 8036)"),
      p("Full Sharp-based compositing pipeline that places Wolf's photography into photorealistic AI-generated room environments."),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3000, 6360],
        rows: [
          new TableRow({ children: [cell("Component", { width: 3000, bold: true, shading: "D5E8F0" }), cell("Status", { width: 6360, bold: true, shading: "D5E8F0" })] }),
          new TableRow({ children: [cell("compositor.js", { width: 3000 }), cell("Working. Green-edge overshoot + green-spill removal. Generates JPEG composites.", { width: 6360 })] }),
          new TableRow({ children: [cell("zone-detect.js", { width: 3000 }), cell("Working. 3 strategies: green-screen, frame, blank-wall. 22/24 templates at 84-95% confidence.", { width: 6360 })] }),
          new TableRow({ children: [cell("matcher.js", { width: 3000 }), cell("Working. 819 photos mapped to 24 templates. 100% coverage. 1,628 smart-match pairs.", { width: 6360 })] }),
          new TableRow({ children: [cell("prompt-generator.js", { width: 3000 }), cell("Working. 12 room presets. Auto-generates ChatGPT prompts with green-screen zones.", { width: 6360 })] }),
          new TableRow({ children: [cell("batch.js", { width: 3000 }), cell("Working. Concurrent batch processing with manifests. Needs smart-match mode integration.", { width: 6360 })] }),
          new TableRow({ children: [cell("server.js", { width: 3000 }), cell("Working. 20+ endpoints: templates, preview, batch, matching, prompts, zone detection.", { width: 6360 })] }),
          new TableRow({ children: [cell("templates.json", { width: 3000 }), cell("25 templates (1 test + 24 AI rooms). Auto-detected zones. IDs have trailing spaces from filenames.", { width: 6360 })] }),
        ]
      }),
      p(""),

      h2("1.2 Room Templates (24 AI-Generated)"),
      p("Wolf generated 24 photorealistic rooms from ChatGPT using provided prompts. All in templates/rooms/. All use #00FF00 green-screen zones."),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 2000, 1860, 2000],
        rows: [
          new TableRow({ children: [
            cell("Room Type", { width: 3500, bold: true, shading: "D5E8F0" }),
            cell("Zone Aspect", { width: 2000, bold: true, shading: "D5E8F0" }),
            cell("Photos Match", { width: 1860, bold: true, shading: "D5E8F0" }),
            cell("Detection", { width: 2000, bold: true, shading: "D5E8F0" }),
          ] }),
          new TableRow({ children: [cell("Living rooms (3)", { width: 3500 }), cell("1.56-1.77", { width: 2000 }), cell("510-561", { width: 1860 }), cell("Green 90-95%", { width: 2000 })] }),
          new TableRow({ children: [cell("Bedrooms (2)", { width: 3500 }), cell("1.64-2.06", { width: 2000 }), cell("308-540", { width: 1860 }), cell("Green 88-93%", { width: 2000 })] }),
          new TableRow({ children: [cell("Galleries (4)", { width: 3500 }), cell("1.47-3.37", { width: 2000 }), cell("4-449", { width: 1860 }), cell("Green 84-95%", { width: 2000 })] }),
          new TableRow({ children: [cell("Hotel lobbies (3)", { width: 3500 }), cell("2.42-3.71", { width: 2000 }), cell("4-135", { width: 1860 }), cell("Green 88-92%", { width: 2000 })] }),
          new TableRow({ children: [cell("Business (3)", { width: 3500 }), cell("2.35-3.14", { width: 2000 }), cell("4-135", { width: 1860 }), cell("Green 86-91%", { width: 2000 })] }),
          new TableRow({ children: [cell("Restaurant, Spa, Outdoor, Penthouse, Hallways", { width: 3500 }), cell("0.67-2.93", { width: 2000 }), cell("varies", { width: 1860 }), cell("Green/Wall", { width: 2000 })] }),
        ]
      }),
      p(""),

      h2("1.3 Sample Composites (13 Generated)"),
      p("Located in mockup-samples/. Photography successfully placed in rooms with no green edges."),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4680, 4680],
        rows: [
          new TableRow({ children: [cell("Composite", { width: 4680, bold: true, shading: "D5E8F0" }), cell("Quality", { width: 4680, bold: true, shading: "D5E8F0" })] }),
          new TableRow({ children: [cell("Iceland in Hotel Lobby", { width: 4680 }), cell("Excellent - panoramic fills wall perfectly", { width: 4680 })] }),
          new TableRow({ children: [cell("Italy in Living Room", { width: 4680 }), cell("Excellent - luxury feel, natural placement", { width: 4680 })] }),
          new TableRow({ children: [cell("Hawaii in Bedroom", { width: 4680 }), cell("Excellent - above-bed placement looks real", { width: 4680 })] }),
          new TableRow({ children: [cell("Antelope Canyon in Dark Gallery", { width: 4680 }), cell("Excellent - dramatic lighting match", { width: 4680 })] }),
          new TableRow({ children: [cell("South Africa in Business Lobby", { width: 4680 }), cell("Excellent - corporate setting works well", { width: 4680 })] }),
          new TableRow({ children: [cell("Grand Teton in Huddle Room", { width: 4680 }), cell("Good - sunset panoramic in conference room", { width: 4680 })] }),
          new TableRow({ children: [cell("Pano in Gallery Large Scale", { width: 4680 }), cell("Good - minor green reflection under bench", { width: 4680 })] }),
        ]
      }),
      p(""),

      // SECTION 2: MATCHING ENGINE RESULTS
      h1("2. Matching Engine Results"),

      h2("2.1 Coverage Summary"),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "819 photos analyzed, 100% have 1+ compatible template", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "510 photos (62%) have 6+ template matches", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "305 photos have 2-5 matches, 4 photos have exactly 1 match", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "1,628 smart-match pairs at max 2 per photo (configurable)", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "Tolerance: 15% aspect ratio mismatch (adjustable via API)", size: 20, font: "Arial" })] }),

      h2("2.2 Top Templates by Photo Count"),
      new Paragraph({ numbering: { reference: "bullets2", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Living room 1 (zone 1.67) = 561 photos", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets2", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Bedroom 2 (zone 1.64) = 540 photos", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets2", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Outdoor area (zone 1.57) = 510 photos", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets2", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Restaurant (zone 1.55) = 500 photos", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets2", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "Gallery 1 (zone 1.49) = 449 photos", size: 20, font: "Arial" })] }),

      // SECTION 3: COMMITS TO PUSH
      new Paragraph({ children: [new PageBreak()] }),
      h1("3. Unpushed Commits"),
      p("Run 'git push' from your machine. 4 commits pending:"),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [1800, 7560],
        rows: [
          new TableRow({ children: [cell("Commit", { width: 1800, bold: true, shading: "D5E8F0" }), cell("Description", { width: 7560, bold: true, shading: "D5E8F0" })] }),
          new TableRow({ children: [cell("566ba04", { width: 1800 }), cell("Phase 4+5: Template Manager, Preview Lab, Batch Queue, Gallery Browser", { width: 7560 })] }),
          new TableRow({ children: [cell("ca62790", { width: 1800 }), cell("Zone auto-detection engine (green-screen, frame, blank-wall) + download guide", { width: 7560 })] }),
          new TableRow({ children: [cell("be57fab", { width: 1800 }), cell("Green-edge overshoot + green-spill removal + 24 room templates + 13 sample composites", { width: 7560 })] }),
          new TableRow({ children: [cell("f857b77", { width: 1800 }), cell("Matching engine (matcher.js) + ChatGPT prompt generator (prompt-generator.js) + 7 API endpoints", { width: 7560 })] }),
        ]
      }),
      p(""),

      // SECTION 4: REMAINING PHASES
      h1("4. Remaining Phases to Build"),

      h2("Phase 2: Agent Social Posting Integration"),
      p("Feed mockup composites into the Agent's existing Instagram/Facebook/Pinterest posting pipeline."),
      new Paragraph({ numbering: { reference: "bullets3", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Create mockup_content.py: Generate mockup-specific captions ('See how this looks on your wall')", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets3", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Create mockup_queue.py: SQLite queue tracking draft > approved > posted status", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets3", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Modify social.py: Add post_mockup_to_instagram() and post_mockup_to_pinterest()", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets3", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Add Facebook Graph API support (same auth as Instagram in many cases)", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets3", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "Integrate into 2x/day schedule: morning = mockup, afternoon = photo (or alternate)", size: 20, font: "Arial" })] }),

      h2("Phase 3: Website 'See in Room' Gallery"),
      p("New page at archive-35.com/see-in-room.html showing mockups to website visitors."),
      new Paragraph({ numbering: { reference: "bullets4", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Create see-in-room.html: Responsive grid (4 col desktop, 2 mobile), filter by gallery + room type", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets4", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Create js/see-in-room.js: Lazy loading, lightbox, gallery/template filters", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets4", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "'Shop this print' CTA linking to product selector for that photo", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets4", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "Add nav link in gallery.html header", size: 20, font: "Arial" })] }),

      h2("Phase 4: Platform Formatting (Etsy/Pinterest)"),
      p("Generate platform-specific mockup sizes ready for listing."),
      new Paragraph({ numbering: { reference: "bullets5", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Etsy: 2000x2000 square crop centered on art", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets5", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Pinterest: 1000x1500 vertical crop, art prominent", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets5", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "Batch export with metadata CSV for bulk upload", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets5", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "generatePlatformMockup() already exists in compositor.js, just needs batch integration", size: 20, font: "Arial" })] }),

      // SECTION 5: KNOWN ISSUES
      h1("5. Known Issues & Fixes Needed"),

      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3000, 3360, 3000],
        rows: [
          new TableRow({ children: [
            cell("Issue", { width: 3000, bold: true, shading: "FDE8E8" }),
            cell("Impact", { width: 3360, bold: true, shading: "FDE8E8" }),
            cell("Fix", { width: 3000, bold: true, shading: "FDE8E8" }),
          ] }),
          new TableRow({ children: [
            cell("Template IDs have trailing spaces", { width: 3000 }),
            cell("'penthouse ' not 'penthouse'. Must match exact ID.", { width: 3360 }),
            cell("Rename files to remove trailing spaces, rebuild templates.json", { width: 3000 }),
          ] }),
          new TableRow({ children: [
            cell("Minor green reflection on floors", { width: 3000 }),
            cell("Gallery bench, some lobby floors show faint green.", { width: 3360 }),
            cell("Regenerate room images with 'no green reflections' in prompt, or tighten spill threshold", { width: 3000 }),
          ] }),
          new TableRow({ children: [
            cell("Hotel hallway: 20% confidence", { width: 3000 }),
            cell("Fallback detection, zone may be inaccurate.", { width: 3360 }),
            cell("Manual zone coordinates or regenerate image with clearer green zone", { width: 3000 }),
          ] }),
          new TableRow({ children: [
            cell("batch.js needs smart-match mode", { width: 3000 }),
            cell("Currently requires manual photo/template lists.", { width: 3360 }),
            cell("Wire matcher.js into batch.js createBatchJob() with mode: 'smart-match'", { width: 3000 }),
          ] }),
          new TableRow({ children: [
            cell("Git push needs auth", { width: 3000 }),
            cell("4 unpushed commits in Cowork VM.", { width: 3360 }),
            cell("Run 'git push' from Wolf's machine", { width: 3000 }),
          ] }),
        ]
      }),
      p(""),

      // SECTION 6: FILE MAP
      new Paragraph({ children: [new PageBreak()] }),
      h1("6. Complete File Map"),

      h2("6.1 Mockup Service (mockup-service/src/)"),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3500, 5860],
        rows: [
          new TableRow({ children: [cell("File", { width: 3500, bold: true, shading: "E8F0E8" }), cell("Purpose", { width: 5860, bold: true, shading: "E8F0E8" })] }),
          new TableRow({ children: [cell("server.js", { width: 3500 }), cell("Express server, 20+ endpoints. Port 8036.", { width: 5860 })] }),
          new TableRow({ children: [cell("compositor.js", { width: 3500 }), cell("Sharp-based compositing: homography warp, green-spill removal, overshoot.", { width: 5860 })] }),
          new TableRow({ children: [cell("homography.js", { width: 3500 }), cell("Matrix math for perspective transforms (8-DOF).", { width: 5860 })] }),
          new TableRow({ children: [cell("matcher.js", { width: 3500 }), cell("Aspect ratio compatibility: photos to templates. buildCompatibilityMatrix().", { width: 5860 })] }),
          new TableRow({ children: [cell("prompt-generator.js", { width: 3500 }), cell("ChatGPT prompts with green-screen zones. 12 room presets.", { width: 5860 })] }),
          new TableRow({ children: [cell("zone-detect.js", { width: 3500 }), cell("Auto-detect green zones in room images. 3 strategies.", { width: 5860 })] }),
          new TableRow({ children: [cell("batch.js", { width: 3500 }), cell("Concurrent batch jobs with manifests. Needs smart-match integration.", { width: 5860 })] }),
          new TableRow({ children: [cell("templates.js", { width: 3500 }), cell("Template CRUD operations, reads templates.json.", { width: 5860 })] }),
        ]
      }),
      p(""),

      h2("6.2 Templates & Samples"),
      new Paragraph({ numbering: { reference: "bullets6", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "templates/templates.json: 25 entries (1 test + 24 auto-detected rooms)", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets6", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "templates/rooms/*.png: 24 AI-generated room images from ChatGPT", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets6", level: 0 }, spacing: { after: 80 }, children: [new TextRun({ text: "mockup-samples/*.jpg: 13 test composites (Wolf's photos in rooms)", size: 20, font: "Arial" })] }),
      new Paragraph({ numbering: { reference: "bullets6", level: 0 }, spacing: { after: 120 }, children: [new TextRun({ text: "data/photos.json: 819 photos with dimensions, aspect ratios, orientations", size: 20, font: "Arial" })] }),

      h2("6.3 Key API Endpoints"),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [4000, 5360],
        rows: [
          new TableRow({ children: [cell("Endpoint", { width: 4000, bold: true, shading: "E8E0F0" }), cell("What It Does", { width: 5360, bold: true, shading: "E8E0F0" })] }),
          new TableRow({ children: [cell("GET /match/stats", { width: 4000 }), cell("Full coverage report: matched/unmatched/distribution", { width: 5360 })] }),
          new TableRow({ children: [cell("GET /match/photo/:id", { width: 4000 }), cell("Compatible templates for a photo (sorted by score)", { width: 5360 })] }),
          new TableRow({ children: [cell("GET /match/template/:id", { width: 4000 }), cell("Compatible photos for a template", { width: 5360 })] }),
          new TableRow({ children: [cell("GET /match/pairs", { width: 4000 }), cell("Smart-match pairs for batch generation", { width: 5360 })] }),
          new TableRow({ children: [cell("POST /prompt/generate", { width: 4000 }), cell("ChatGPT prompt for a specific aspect ratio + room type", { width: 5360 })] }),
          new TableRow({ children: [cell("GET /prompt/room-types", { width: 4000 }), cell("List 12 room presets (living room, hotel lobby, gallery, etc.)", { width: 5360 })] }),
          new TableRow({ children: [cell("POST /preview", { width: 4000 }), cell("Generate single mockup composite (returns JPEG)", { width: 5360 })] }),
          new TableRow({ children: [cell("POST /composite/batch", { width: 4000 }), cell("Start batch compositing job", { width: 5360 })] }),
          new TableRow({ children: [cell("POST /detect-all", { width: 4000 }), cell("Auto-detect zones in all room images, rebuild templates.json", { width: 5360 })] }),
        ]
      }),
      p(""),

      // SECTION 7: QUICK START
      h1("7. Quick Start for Next Session"),

      h2("7.1 To regenerate composites (after fixing room images):"),
      code("cd Archive-35.com"),
      code("node mockup-service/scripts/detect-rooms.js --rebuild"),
      code("# Then use /match/pairs endpoint to get photo-template combos"),
      code("# POST /preview with each pair to generate composites"),
      p(""),

      h2("7.2 To start the mockup service:"),
      code("cd Archive-35.com/mockup-service && npm start"),
      code("# Health check: http://localhost:8036/health"),
      code("# Match stats: http://localhost:8036/match/stats"),
      p(""),

      h2("7.3 To generate a ChatGPT prompt for a new room:"),
      code("curl -X POST http://localhost:8036/prompt/generate \\"),
      code("  -H 'Content-Type: application/json' \\"),
      code("  -d '{\"aspectRatio\": 3.25, \"roomType\": \"hotel-lobby\"}'"),
      p(""),

      h2("7.4 To push all pending commits:"),
      code("cd Archive-35.com && git push"),
      p("This pushes 4 commits: Phase 4+5, zone detection, green-spill fixes, matching engine."),

      // SECTION 8: WOLF'S DECISION POINTS
      new Paragraph({ children: [new PageBreak()] }),
      h1("8. Decisions for Wolf"),

      p("Before building the next phases, these decisions will shape the implementation:", { bold: true }),
      p(""),

      p("1. Green reflection cleanup: Should we regenerate the room images with updated ChatGPT prompts that explicitly say 'no green reflections on floors', or is the current green-spill code good enough?", { bold: true }),
      p(""),
      p("2. Instagram posting frequency: Use mockups as 1 of the 2 daily posts? Or add a 3rd daily post just for mockups?", { bold: true }),
      p(""),
      p("3. Website gallery priority: Build 'See in Room' page before or after social posting integration? The gallery is customer-facing but social drives traffic.", { bold: true }),
      p(""),
      p("4. Etsy/Pinterest: Generate all 1,628 pairs at once, or start with a curated set (e.g., top 100 by marketability score)?", { bold: true }),
      p(""),
      p("5. Template cleanup: Rename files to remove trailing spaces now, or live with the quirky IDs?", { bold: true }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/practical-dreamy-ride/mnt/Archive-35.com/08_Docs/Mockup_Pipeline_Handover.docx", buffer);
  console.log("Handover doc created: 08_Docs/Mockup_Pipeline_Handover.docx");
});
