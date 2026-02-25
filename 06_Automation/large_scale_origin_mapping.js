const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType, 
        ShadingType, PageNumber } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function headerCell(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: "1A1A2E", type: ShadingType.CLEAR },
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, bold: true, color: "FFFFFF", font: "Arial", size: 18 })] })]
  });
}

function cell(text, width, shade) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: shade ? { fill: "F5F5F5", type: ShadingType.CLEAR } : undefined,
    margins: cellMargins,
    children: [new Paragraph({ children: [new TextRun({ text, font: "Arial", size: 18 })] })]
  });
}

// Data from analysis
const highConfidence = [
  ["104A9021-Pano-2.jpg", "91MP", "2.42", "White Sands NP", "HIGH", "Same camera sequence"],
  ["104A9055-Pano.jpg", "227MP", "2.56", "White Sands NP", "HIGH", "Same camera sequence"],
  ["104A9139-Pano.jpg", "79MP", "2.55", "White Sands NP", "HIGH", "Same camera sequence"],
  ["104A9145-Pano.jpg", "223MP", "3.48", "White Sands NP", "HIGH", "Same camera sequence"],
  ["104A9245-Pano.jpg", "166MP", "2.35", "White Sands NP", "HIGH", "Same camera sequence"],
  ["WOLF1974-Pano.jpg", "251MP", "4.01", "Los Angeles", "HIGH", "WOLF1975 in LA"],
  ["WOLF4675-Pano.jpg", "170MP", "3.87", "Iceland", "HIGH", "WOLF4663 in Iceland"],
  ["WOLF7261-Pano.jpg", "84MP", "2.19", "Grand Teton", "HIGH", "WOLF7228 in GT"],
  ["WOLF7271-Pano.jpg", "165MP", "2.04", "Grand Teton", "HIGH", "WOLF7301 in GT"],
  ["Wolf 4390.jpg", "52MP", "2.78", "Iceland", "HIGH", "Wolf 4389 in Iceland"],
  ["Wolf 5163.jpg", "45MP", "1.50", "Glacier NP", "HIGH", "Wolf 5158 in Glacier"],
  ["Wolf 6231.jpg", "55MP", "2.19", "New York", "HIGH", "Wolf 6232 in NY"],
  ["Wolf 6945.jpg", "130MP", "3.21", "Italy", "HIGH", "Wolf 6944 in Italy"],
];

const medConfidence = [
  ["WOLF2375-Pano.jpg", "123MP", "3.07", "Sequoia NP / Colorado", "MED", "Between sequences"],
  ["WOLF3219-Pano.jpg", "51MP", "2.30", "Death Valley / Iceland", "MED", "Trip boundary"],
  ["WOLF3501-Pano.jpg", "55MP", "2.36", "Death Valley / Iceland", "MED", "Trip boundary"],
  ["WOLF3537-Pano.jpg", "108MP", "2.44", "Death Valley / Iceland", "MED", "Trip boundary"],
  ["WOLF3565-Pano.jpg", "200MP", "2.02", "Death Valley / Iceland", "MED", "Trip boundary"],
  ["WOLF3592-Pano.jpg", "78MP", "1.74", "Iceland", "MED", "Near Iceland range"],
  ["WOLF7451.jpg", "72MP", "2.40", "Coast of CA / Grand Teton", "MED", "Trip boundary"],
  ["Wolf 3303.jpg", "52MP", "3.53", "Iceland / Death Valley", "MED", "Trip boundary"],
  ["Wolf 3343.jpg", "84MP", "4.81", "Death Valley / Iceland", "MED", "Trip boundary"],
  ["Wolf 3989.jpg", "122MP", "4.78", "Los Angeles", "MED", "Wolf 3987 in LA"],
  ["Wolf 4001.jpg", "114MP", "4.51", "Los Angeles", "MED", "Wolf 4008 in LA"],
  ["Wolf 4011.jpg", "207MP", "4.80", "Los Angeles", "MED", "Wolf 4008 in LA"],
  ["Wolf 4017.jpg", "147MP", "4.17", "Iceland / Los Angeles", "MED", "Trip boundary"],
  ["Wolf 4538.jpg", "339MP", "7.01", "Iceland", "MED", "Wolf 4530 in Iceland"],
  ["Wolf 4541.jpg", "111MP", "4.83", "Iceland", "MED", "Wolf 4530 in Iceland"],
  ["Wolf 4549.jpg", "135MP", "2.96", "Iceland", "MED", "Wolf 4556 in Iceland"],
  ["Wolf 4551.jpg", "109MP", "2.94", "Iceland", "MED", "Wolf 4556 in Iceland"],
  ["Wolf 4552.jpg", "151MP", "3.41", "Iceland", "MED", "Wolf 4556 in Iceland"],
  ["Wolf 5061.jpg", "72MP", "2.96", "Iceland / Glacier NP", "MED", "Trip boundary"],
  ["Wolf 5787.jpg", "124MP", "2.56", "Joshua Tree area", "MED", "Near Wolf 5858"],
  ["Wolf 5822.jpg", "133MP", "2.45", "Joshua Tree area", "MED", "Near Wolf 5858"],
  ["Wolf 5853.jpg", "218MP", "3.60", "Joshua Tree area", "MED", "Near Wolf 5858"],
  ["Wolf 5871.jpg", "115MP", "4.29", "Joshua Tree", "MED", "Wolf 5872 in JT"],
  ["Wolf 5908.jpg", "116MP", "2.08", "Joshua Tree / LA", "MED", "Between sequences"],
  ["Wolf 5975.jpg", "149MP", "3.86", "Los Angeles", "MED", "Wolf 5973 in LA"],
  ["Wolf 6012.jpg", "120MP", "3.07", "San Francisco", "MED", "Wolf 6019 in SF"],
  ["Wolf 6018.jpg", "217MP", "3.20", "San Francisco", "MED", "Wolf 6019 in SF"],
  ["Wolf 6071.jpg", "212MP", "2.75", "San Francisco / NY", "MED", "Between sequences"],
  ["Wolf 6679.jpg", "138MP", "2.17", "Germany", "MED", "Wolf 6679 match"],
  ["Wolf 6889.jpg", "110MP", "2.76", "Italy / Flowers", "MED", "Near Italy range"],
  ["Wolf 6898.jpg", "90MP", "1.60", "Italy", "MED", "Near Wolf 6895"],
];

const manual = [
  ["IMG_0140-Pano.jpg", "313MP", "2.50", "Unknown", "MANUAL", "No WOLF number pattern"],
  ["LA Flip.jpeg", "141MP", "1.51", "Los Angeles (from name)", "MANUAL", "Named LA Flip"],
];

function makeRows(data) {
  return data.map((row, i) => new TableRow({
    children: [
      cell(row[0], 2800, i % 2 === 1),
      cell(row[1], 800, i % 2 === 1),
      cell(row[2], 700, i % 2 === 1),
      cell(row[3], 2400, i % 2 === 1),
      cell(row[4], 800, i % 2 === 1),
      cell(row[5], 1860, i % 2 === 1),
    ]
  }));
}

const colWidths = [2800, 800, 700, 2400, 800, 1860];
const headerRow = new TableRow({
  children: [
    headerCell("Filename", 2800),
    headerCell("Size", 800),
    headerCell("Ratio", 700),
    headerCell("Probable Origin", 2400),
    headerCell("Conf.", 800),
    headerCell("Evidence", 1860),
  ]
});

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Arial", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1A1A2E" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "333333" },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
      }
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        children: [new TextRun({ text: "Archive-35 | Large Scale Photography Origin Mapping", font: "Arial", size: 16, color: "999999" })]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: "Page ", font: "Arial", size: 16, color: "999999" }), new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" })]
      })] })
    },
    children: [
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Large Scale Photography \u2014 Origin Mapping")] }),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun({ text: "Generated: February 24, 2026", color: "666666", size: 20 })
      ]}),
      new Paragraph({ spacing: { after: 120 }, children: [
        new TextRun("46 unique photos in the Large Scale Photography Stitch collection were cross-referenced against all other galleries using WOLF camera sequence numbers. 80 duplicates were already removed from the database.")
      ]}),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun({ text: "Summary: ", bold: true }),
        new TextRun("13 HIGH confidence matches, 31 MEDIUM confidence (need Wolf verification), 2 require manual identification.")
      ]}),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("High Confidence Matches (13)")] }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: colWidths,
        rows: [headerRow, ...makeRows(highConfidence)] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Medium Confidence \u2014 Needs Verification (31)")] }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: colWidths,
        rows: [new TableRow({ children: [
          headerCell("Filename", 2800), headerCell("Size", 800), headerCell("Ratio", 700),
          headerCell("Probable Origin", 2400), headerCell("Conf.", 800), headerCell("Evidence", 1860),
        ]}), ...makeRows(medConfidence)] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Manual Identification Required (2)")] }),
      new Table({ width: { size: 9360, type: WidthType.DXA }, columnWidths: colWidths,
        rows: [new TableRow({ children: [
          headerCell("Filename", 2800), headerCell("Size", 800), headerCell("Ratio", 700),
          headerCell("Probable Origin", 2400), headerCell("Conf.", 800), headerCell("Evidence", 1860),
        ]}), ...makeRows(manual)] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("Database Cleanup Summary")] }),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: "\u2022 158 corrupted paths fixed ", bold: true }),
        new TextRun("(trailing spaces in folder names)")
      ]}),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: "\u2022 80 duplicate Large Scale entries removed ", bold: true }),
        new TextRun("(kept origin gallery version)")
      ]}),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: "\u2022 16 new photos imported ", bold: true }),
        new TextRun("(Mexico 8, Washington DC 5, Yosemite NP 3)")
      ]}),
      new Paragraph({ spacing: { after: 80 }, children: [
        new TextRun({ text: "\u2022 import_photos.py patched ", bold: true }),
        new TextRun("(strips whitespace from paths and collection names)")
      ]}),
      new Paragraph({ spacing: { after: 200 }, children: [
        new TextRun({ text: "\u2022 Final DB: 838 photos across 48 collections", bold: true })
      ]}),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/sessions/tender-zen-johnson/mnt/Archive-35.com/06_Automation/Large_Scale_Origin_Mapping.docx", buffer);
  console.log("Done");
});
