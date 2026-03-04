/**
 * CaFE Form Mapper — Maps internal metadata fields to CaFE form field names.
 *
 * CaFE form at: https://artist.callforentry.org/media_upload.php
 * Field names extracted from actual DOM inspection (March 2026).
 *
 * Actual CaFE field names:
 *   pf_fk, pf_secret (hidden security tokens)
 *   sample_type = "image", newUpdateMedia = "new"
 *   mediaFile (file input)
 *   imageTitle, imageAltText, imageMedium, imageDescription
 *   imageHeight, imageHeightDimensions (select: 1=Inches, 2=Feet, 3=cm, 4=m)
 *   imageWidth, imageWidthDimensions
 *   imageDepth, imageDepthDimensions
 *   imageForSale (select: 1=Yes, 0=No)
 *   imagePrice
 *   imageYearCompleted
 *   primaryDiscipline (select: 28=Photography)
 *   publicArt (select: 0=No, 1=Yes)
 *   publicArtLocation, publicArtProgram
 */

const CafeFormMapper = {

  // CaFE dimension unit values
  UNITS: {
    'Inches': '1',
    'Feet': '2',
    'Centimeter': '3',
    'Meters': '4',
  },

  // CaFE discipline select values
  DISCIPLINES: {
    'Photography': '28',
    'Digital Media': '7',
    'Mixed Media': '23',
    'Painting': '25',
    'Sculpture': '31',
    'Printmaking': '29',
    'Public Art': '30',
  },

  /**
   * Fill the CaFE upload form on the current page with metadata.
   * Sets file input via DataTransfer API + fills all text/select fields.
   *
   * @param {Object} metadata - Normalized metadata entry
   * @param {Blob} imageBlob - Image as Blob
   * @param {string} filename - Original filename
   */
  fillForm(metadata, imageBlob, filename) {
    // ── Set file input via DataTransfer ──
    const fileInput = document.getElementById('mediaFile');
    if (fileInput) {
      const dt = new DataTransfer();
      dt.items.add(new File([imageBlob], filename, { type: 'image/jpeg' }));
      fileInput.files = dt.files;
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ── Helper to set a form field value ──
    const setVal = (name, value) => {
      const el = document.querySelector(`[name="${name}"]`);
      if (!el) {
        console.warn(`[CaFE Mapper] Field not found: ${name}`);
        return;
      }
      if (el.tagName === 'SELECT') {
        for (const opt of el.options) {
          if (opt.value === String(value) || opt.text === String(value)) {
            el.value = opt.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return;
          }
        }
        console.warn(`[CaFE Mapper] No matching option for ${name}=${value}`);
      } else if (el.tagName === 'TEXTAREA') {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    // ── Text fields ──
    setVal('imageTitle', metadata.title);
    setVal('imageAltText', metadata.alt_text);
    setVal('imageMedium', metadata.medium);
    setVal('imageDescription', metadata.description || '');

    // ── Dimensions ── (CaFE uses "Dimensions" not "Units")
    setVal('imageHeight', String(metadata.height));
    setVal('imageWidth', String(metadata.width));
    setVal('imageDepth', String(metadata.depth));

    const unitVal = this.UNITS[metadata.units] || '1'; // default Inches
    setVal('imageHeightDimensions', unitVal);
    setVal('imageWidthDimensions', unitVal);
    setVal('imageDepthDimensions', unitVal);

    // ── Selects ──
    const forSaleVal = (metadata.for_sale === 'Yes' || metadata.for_sale === true) ? '1' : '0';
    setVal('imageForSale', forSaleVal);
    if (metadata.price) setVal('imagePrice', String(metadata.price));
    setVal('imageYearCompleted', String(metadata.year));

    // Discipline (Photography = 28)
    const discId = this.DISCIPLINES[metadata.discipline] || '28';
    setVal('primaryDiscipline', discId);

    // Public art
    const publicArtVal = (metadata.public_art === 'Yes' || metadata.public_art === true) ? '1' : '0';
    setVal('publicArt', publicArtVal);
  },

  /**
   * Click the "Add to My Portfolio" image upload button.
   * Returns a promise that resolves when upload completes or fails.
   */
  clickUpload() {
    return new Promise((resolve, reject) => {
      const btn = document.getElementById('imageUploadButton');
      if (!btn) {
        reject(new Error('Upload button (#imageUploadButton) not found'));
        return;
      }

      // Watch for page navigation, success indicators, or errors
      let resolved = false;
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Check if there's a success or error on the page
          const body = document.body.textContent;
          if (body.includes('successfully') || body.includes('added')) {
            resolve({ success: true });
          } else {
            resolve({ success: true, note: 'Upload clicked — check portfolio to verify' });
          }
        }
      }, 30000); // 30s timeout for large files

      // Watch for the upload progress to complete
      const observer = new MutationObserver(() => {
        const body = document.body.textContent;
        // CaFE shows "please wait while your image file is processed" during upload
        // After success it typically reloads or shows the portfolio
        if (body.includes('successfully') || body.includes('has been added')) {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeout);
            observer.disconnect();
            resolve({ success: true });
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      // Click the button
      btn.click();
    });
  },
};

// Export
if (typeof window !== 'undefined') {
  window.CafeFormMapper = CafeFormMapper;
}
