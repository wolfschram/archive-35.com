/**
 * CaFE Form Mapper — Maps internal metadata fields to CaFE form field names.
 *
 * CaFE form at: https://artist.callforentry.org/media_upload.php
 * Field names extracted from DOM inspection.
 */

const CafeFormMapper = {
  // Map: internal field name → CaFE form field name
  FIELD_MAP: {
    file:        'mediaFile',
    title:       'imageTitle',
    alt_text:    'imageAltText',
    medium:      'imageMedium',
    height:      'imageHeight',
    width:       'imageWidth',
    depth:       'imageDepth',
    for_sale:    'imageForSale',
    price:       'imagePrice',
    year:        'imageYearCompleted',
    description: 'imageDescription',
  },

  // CaFE discipline IDs (select dropdown values)
  DISCIPLINES: {
    'Photography': '28',
    'Digital Media': '5',
    'Mixed Media': '14',
    'Painting': '15',
    'Sculpture': '19',
  },

  // Unit field names (one per dimension)
  UNIT_FIELDS: {
    height: 'imageHeightUnits',
    width:  'imageWidthUnits',
    depth:  'imageDepthUnits',
  },

  /**
   * Build a FormData object ready for CaFE submission.
   *
   * @param {Object} metadata - Normalized metadata entry
   * @param {File|Blob} imageFile - The image file to upload
   * @param {Object} hiddenFields - Hidden form fields (pf_fk, pf_secret)
   * @returns {FormData}
   */
  buildFormData(metadata, imageFile, hiddenFields = {}) {
    const fd = new FormData();

    // File
    fd.append('mediaFile', imageFile, metadata.file);

    // Text fields
    fd.append('imageTitle', metadata.title);
    fd.append('imageAltText', metadata.alt_text);
    fd.append('imageMedium', metadata.medium);
    fd.append('imageDescription', metadata.description);

    // Dimensions + units
    fd.append('imageHeight', String(metadata.height));
    fd.append('imageHeightUnits', metadata.units);
    fd.append('imageWidth', String(metadata.width));
    fd.append('imageWidthUnits', metadata.units);
    fd.append('imageDepth', String(metadata.depth));
    fd.append('imageDepthUnits', metadata.units);

    // Selects
    fd.append('imageForSale', metadata.for_sale);
    if (metadata.price) fd.append('imagePrice', String(metadata.price));
    fd.append('imageYearCompleted', String(metadata.year));

    // Discipline (Photography = 28)
    const discId = this.DISCIPLINES[metadata.discipline] || '28';
    fd.append('primaryDiscipline', discId);

    // Public art
    fd.append('publicArt', metadata.public_art === 'Yes' ? 'Yes' : 'No');

    // Hidden fields from the form
    fd.append('sample_type', 'image');
    fd.append('newUpdateMedia', 'new');
    if (hiddenFields.pf_fk) fd.append('pf_fk', hiddenFields.pf_fk);
    if (hiddenFields.pf_secret) fd.append('pf_secret', hiddenFields.pf_secret);

    return fd;
  },

  /**
   * Fill form fields in the DOM (for visual form-filling approach).
   * Used when we want to show the form being filled before submit.
   *
   * @param {Object} metadata - Normalized metadata entry
   */
  fillFormFields(metadata) {
    const setVal = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) return false;
      if (el.tagName === 'SELECT') {
        // Find matching option
        for (const opt of el.options) {
          if (opt.value === String(value) || opt.text === String(value)) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }
        }
      } else if (el.tagName === 'TEXTAREA') {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    };

    setVal('imageTitle', metadata.title);
    setVal('imageAltText', metadata.alt_text);
    setVal('imageMedium', metadata.medium);
    setVal('imageDescription', metadata.description);
    setVal('imageHeight', String(metadata.height));
    setVal('imageHeightUnits', metadata.units);
    setVal('imageWidth', String(metadata.width));
    setVal('imageWidthUnits', metadata.units);
    setVal('imageDepth', String(metadata.depth));
    setVal('imageDepthUnits', metadata.units);
    setVal('imageForSale', metadata.for_sale);
    if (metadata.price) setVal('imagePrice', String(metadata.price));
    setVal('imageYearCompleted', String(metadata.year));
    setVal('primaryDiscipline', this.DISCIPLINES[metadata.discipline] || '28');
    setVal('publicArt', metadata.public_art === 'Yes' ? 'Yes' : 'No');
  },

  /**
   * Extract hidden form fields from the CaFE upload page DOM.
   * These are required for successful form submission.
   */
  extractHiddenFields() {
    const fields = {};
    const pfFk = document.querySelector('[name="pf_fk"]');
    const pfSecret = document.querySelector('[name="pf_secret"]');
    if (pfFk) fields.pf_fk = pfFk.value;
    if (pfSecret) fields.pf_secret = pfSecret.value;
    return fields;
  },
};

// Export for both contexts
if (typeof window !== 'undefined') {
  window.CafeFormMapper = CafeFormMapper;
}
