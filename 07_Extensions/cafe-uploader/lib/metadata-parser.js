/**
 * Metadata Parser — Reads cafe_metadata.csv or submission.json
 * and normalizes to a common internal format.
 */

const MetadataParser = {
  /**
   * Parse a metadata file (auto-detects CSV vs JSON).
   * @param {string} text - Raw file content
   * @param {string} filename - Original filename (for format detection)
   * @returns {Array<Object>} Normalized metadata array
   */
  parse(text, filename) {
    if (filename.endsWith('.json')) {
      return this.parseJSON(text);
    }
    return this.parseCSV(text);
  },

  /**
   * Parse submission.json format.
   * Expects an array of objects (from cafe_export.py).
   */
  parseJSON(text) {
    const data = JSON.parse(text);
    const items = Array.isArray(data) ? data : (data.metadata || data.images || []);

    return items.map(item => this.normalize({
      file: item.file || item.filename,
      title: item.title || item.imageTitle || '',
      alt_text: item.alt_text || item.imageAltText || '',
      medium: item.medium || item.imageMedium || 'Digital photograph, archival pigment print',
      description: item.description || item.imageDescription || '',
      height: item.height || 20,
      width: item.width || 30,
      depth: item.depth || 0.1,
      units: item.units || 'Inches',
      for_sale: item.for_sale || item.imageForSale || 'Yes',
      price: item.price || item.imagePrice || '',
      year: item.year || item.imageYearCompleted || new Date().getFullYear(),
      discipline: item.discipline || 'Photography',
      public_art: item.public_art || item.publicArt || 'No',
    }));
  },

  /**
   * Parse cafe_metadata.csv format.
   * Header row + data rows, comma-separated with quoted fields.
   */
  parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = this._parseCSVLine(lines[0]);
    const items = [];

    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const values = this._parseCSVLine(lines[i]);
      const row = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = (values[idx] || '').trim();
      });

      items.push(this.normalize({
        file: row.file || row.filename || '',
        title: row.title || row.imageTitle || '',
        alt_text: row.alt_text || row.imageAltText || '',
        medium: row.medium || row.imageMedium || 'Digital photograph, archival pigment print',
        description: row.description || row.imageDescription || '',
        height: parseFloat(row.height || row.imageHeight) || 20,
        width: parseFloat(row.width || row.imageWidth) || 30,
        depth: parseFloat(row.depth || row.imageDepth) || 0.1,
        units: row.units || 'Inches',
        for_sale: row.for_sale || row.imageForSale || 'Yes',
        price: row.price || row.imagePrice || '',
        year: parseInt(row.year || row.imageYearCompleted) || new Date().getFullYear(),
        discipline: row.discipline || 'Photography',
        public_art: row.public_art || row.publicArt || 'No',
      }));
    }

    return items;
  },

  /**
   * Parse a single CSV line, handling quoted fields with commas.
   */
  _parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current);
    return result;
  },

  /**
   * Normalize a raw metadata object to the internal format.
   */
  normalize(raw) {
    return {
      file: raw.file,
      title: String(raw.title || '').substring(0, 60),
      alt_text: String(raw.alt_text || '').substring(0, 125),
      medium: String(raw.medium || 'Digital photograph, archival pigment print').substring(0, 60),
      description: String(raw.description || '').substring(0, 300),
      height: parseFloat(raw.height) || 20,
      width: parseFloat(raw.width) || 30,
      depth: parseFloat(raw.depth) || 0.1,
      units: raw.units || 'Inches',
      for_sale: raw.for_sale === 'Yes' || raw.for_sale === true ? 'Yes' : 'No',
      price: raw.price ? String(raw.price) : '',
      year: parseInt(raw.year) || new Date().getFullYear(),
      discipline: raw.discipline || 'Photography',
      public_art: raw.public_art === 'Yes' || raw.public_art === true ? 'Yes' : 'No',
      // Validation flags
      _valid: true,
      _errors: [],
    };
  },

  /**
   * Validate a normalized metadata entry against CaFE limits.
   */
  validate(entry) {
    const errors = [];
    if (!entry.file) errors.push('Missing filename');
    if (!entry.title) errors.push('Missing title');
    if (entry.title.length > 60) errors.push(`Title too long: ${entry.title.length}/60`);
    if (entry.alt_text.length > 125) errors.push(`Alt text too long: ${entry.alt_text.length}/125`);
    if (entry.medium.length > 60) errors.push(`Medium too long: ${entry.medium.length}/60`);
    if (entry.description.length > 300) errors.push(`Description too long: ${entry.description.length}/300`);
    if (!entry.year || entry.year < 1900) errors.push('Invalid year');

    entry._errors = errors;
    entry._valid = errors.length === 0;
    return entry;
  },
};

// Export for both content script and popup contexts
if (typeof window !== 'undefined') {
  window.MetadataParser = MetadataParser;
}
