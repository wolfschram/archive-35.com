/**
 * templates.js — Room Template CRUD for Archive-35 Mockup Engine
 *
 * Manages room template definitions: load, save, list, get by ID.
 * Templates are stored in templates/templates.json with room images
 * in templates/rooms/.
 *
 * Template JSON schema follows the spec from the build plan (Section 3.1.3).
 */

'use strict';

const fs = require('fs').promises;
const path = require('path');

// Resolve paths relative to the repo root (two levels up from src/)
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'templates');
const TEMPLATES_FILE = path.join(TEMPLATES_DIR, 'templates.json');
const ROOMS_DIR = path.join(TEMPLATES_DIR, 'rooms');

/**
 * Ensure the templates directory structure exists.
 */
async function ensureDirectories() {
  await fs.mkdir(TEMPLATES_DIR, { recursive: true });
  await fs.mkdir(ROOMS_DIR, { recursive: true });
}

/**
 * Load all templates from templates.json.
 * Returns empty array if file doesn't exist yet.
 *
 * @returns {Promise<object[]>} Array of template objects
 */
async function listTemplates() {
  try {
    const data = await fs.readFile(TEMPLATES_FILE, 'utf-8');
    const templates = JSON.parse(data);
    return templates.map(t => ({
      ...t,
      imagePath: resolveImagePath(t.image)
    }));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

/**
 * Get a single template by ID.
 *
 * @param {string} id - Template ID
 * @returns {Promise<object|null>} Template object or null if not found
 */
async function getTemplate(id) {
  const templates = await listTemplates();
  return templates.find(t => t.id === id) || null;
}

/**
 * Save a new template or update an existing one.
 *
 * @param {object} template - Template object (must have id)
 * @returns {Promise<object>} Saved template
 */
async function saveTemplate(template) {
  await ensureDirectories();

  if (!template.id) {
    throw new Error('Template must have an id');
  }

  const templates = await loadRawTemplates();

  const existingIndex = templates.findIndex(t => t.id === template.id);
  if (existingIndex >= 0) {
    templates[existingIndex] = { ...templates[existingIndex], ...template };
  } else {
    templates.push(template);
  }

  await fs.writeFile(TEMPLATES_FILE, JSON.stringify(templates, null, 2));

  return {
    ...template,
    imagePath: resolveImagePath(template.image)
  };
}

/**
 * Delete a template by ID.
 *
 * @param {string} id - Template ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteTemplate(id) {
  const templates = await loadRawTemplates();
  const filtered = templates.filter(t => t.id !== id);

  if (filtered.length === templates.length) {
    return false; // Not found
  }

  await fs.writeFile(TEMPLATES_FILE, JSON.stringify(filtered, null, 2));
  return true;
}

/**
 * Validate a template object has the required fields.
 *
 * @param {object} template - Template to validate
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateTemplate(template) {
  const errors = [];

  if (!template.id) errors.push('Missing id');
  if (!template.name) errors.push('Missing name');
  if (!template.image) errors.push('Missing image path');
  if (!template.dimensions) errors.push('Missing dimensions');
  if (!template.placementZones || !template.placementZones.length) {
    errors.push('Must have at least one placement zone');
  }

  if (template.placementZones) {
    template.placementZones.forEach((zone, i) => {
      if (!zone.corners) {
        errors.push(`Zone ${i}: missing corners`);
      } else {
        const required = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'];
        required.forEach(corner => {
          if (!zone.corners[corner] || zone.corners[corner].length !== 2) {
            errors.push(`Zone ${i}: invalid ${corner} corner`);
          }
        });
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

// --- Internal helpers ---

async function loadRawTemplates() {
  try {
    const data = await fs.readFile(TEMPLATES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

function resolveImagePath(imagePath) {
  if (!imagePath) return null;
  // If already absolute, return as-is
  if (path.isAbsolute(imagePath)) return imagePath;
  // Otherwise resolve relative to repo root
  return path.join(REPO_ROOT, imagePath);
}

module.exports = {
  listTemplates,
  getTemplate,
  saveTemplate,
  deleteTemplate,
  validateTemplate,
  ensureDirectories,
  TEMPLATES_DIR,
  ROOMS_DIR,
  REPO_ROOT
};
