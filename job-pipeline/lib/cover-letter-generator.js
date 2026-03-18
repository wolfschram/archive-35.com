/**
 * Cover Letter Generator — Two-Call Extract→Assemble Pipeline
 *
 * Call 1 (Extract): Reads job description + Wolf's context files → JSON facts
 * Call 2 (Assemble): Builds P→P→R cover letter from ONLY the extracted facts
 *
 * Post-assembly: Hallucination filter → self-score → retry if needed
 *
 * Uses Anthropic API directly via HTTPS (no SDK needed).
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const MODEL = 'claude-sonnet-4-5-20250929';

// Per-operation token limits from spec
const TOKEN_LIMITS = {
  extraction: 4096,
  assembly: 4096,
  scoring: 2048,
  hallucination: 2048,
};

// ─── Anthropic API Call ──────────────────────────────────────────────

function callClaude(apiKey, systemPrompt, userPrompt, maxTokens = 4096) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            reject(new Error(`Anthropic API error: ${parsed.error.message}`));
            return;
          }
          const text = parsed.content?.[0]?.text || '';
          resolve({
            text,
            model: parsed.model,
            input_tokens: parsed.usage?.input_tokens || 0,
            output_tokens: parsed.usage?.output_tokens || 0,
            stop_reason: parsed.stop_reason,
          });
        } catch (e) {
          reject(new Error(`Failed to parse API response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('API request timed out')); });
    req.write(body);
    req.end();
  });
}

// ─── Load Context Files ──────────────────────────────────────────────

function loadContextFiles() {
  const files = {};

  // Capability profile (enriched from Wolf_Schram_Capability_Profile.docx)
  const capPath = path.join(TEMPLATES_DIR, 'capability_profile.md');
  if (fs.existsSync(capPath)) {
    files['capability_profile.md'] = fs.readFileSync(capPath, 'utf8');
  }

  // Resume (extracted from Wolfgang Schram Resume PDF Feb 2026.pdf)
  const resumePath = path.join(TEMPLATES_DIR, 'resume.md');
  if (fs.existsSync(resumePath)) {
    files['resume.md'] = fs.readFileSync(resumePath, 'utf8');
  }

  // Cover letter examples
  const exDir = path.join(TEMPLATES_DIR, 'cover_letter_examples');
  if (fs.existsSync(exDir)) {
    for (const f of fs.readdirSync(exDir)) {
      if (f.endsWith('.md')) {
        files[`cover_letter_examples/${f}`] = fs.readFileSync(path.join(exDir, f), 'utf8');
      }
    }
  }

  return files;
}

// ─── Load QA Bank from DB ────────────────────────────────────────────

function loadQABank(db) {
  try {
    const rows = db.prepare('SELECT question, answer, category FROM qa_bank').all();
    return rows.map(r => `Q: ${r.question}\nA: ${r.answer}\nCategory: ${r.category}`).join('\n\n');
  } catch (e) {
    console.warn('  ⚠ Failed to load QA bank:', e.message);
    return '';
  }
}

// ─── Call 1: Extraction ──────────────────────────────────────────────

const EXTRACT_SYSTEM = `You are a research assistant. Your job is to extract ONLY verified facts from Wolf's context files that are relevant to a specific job application.

Rules:
- Only extract facts explicitly stated in the source files
- Include the source file and approximate location for each fact
- Classify each fact as a potential cover letter element
- Do NOT infer, combine, or embellish facts
- Do NOT add any information not present in the source files
- Output valid JSON only`;

function buildExtractPrompt(job, contextFiles, qaBank) {
  let prompt = `## Job Details
Company: ${job.company}
Title: ${job.title}
Description:
${job.description || 'No description available'}

## Company Research
${job.research_notes || job.company_summary || 'No research available'}

## Wolf's Context Files

`;
  for (const [name, content] of Object.entries(contextFiles)) {
    prompt += `### File: ${name}\n${content}\n\n`;
  }

  if (qaBank) {
    prompt += `### QA Bank (Verified Interview Answers)\n${qaBank}\n\n`;
  }

  prompt += `## Task
Extract all facts from the context files above that are relevant to the ${job.title} role at ${job.company}.

Output a JSON object with this structure:
{
  "relevant_facts": [
    {
      "fact": "exact fact or close paraphrase",
      "source_file": "filename where this fact appears",
      "category": "story|differentiator|metric|background|positioning",
      "relevance": "brief note on why this is relevant to the job"
    }
  ],
  "recommended_stories": ["story name 1", "story name 2"],
  "company_connection": "brief note on how Wolf's experience connects to this company's needs"
}`;

  return prompt;
}

// ─── Call 2: Assembly ────────────────────────────────────────────────

const ASSEMBLE_SYSTEM = `You are Wolf's cover letter writer. You write in his authentic voice: warm, direct, confident, no corporate jargon.

CRITICAL RULES:
- Use ONLY the facts provided in the JSON below. Do NOT add any accomplishments, metrics, companies, or stories not in the facts list.
- Follow the Problem→Product→Result (P→P→R) framework for every paragraph
- Never open with "I am writing to apply for..."
- Lead with PEOPLE, not technology
- Keep under 350 words (400 absolute max)
- No AI clichés: no "delve", "leverage", "utilize", "synergy", "passionate about"
- End with "Wolfgang Schram" signature
- Be specific to THIS company and role

Cover Letter Structure:
1. Opening hook — Connect Wolf's product to the company's specific need (1-2 sentences)
2. P→P→R paragraph 1 — Most relevant leadership story
3. P→P→R paragraph 2 — Second most relevant story or differentiator
4. Why this company — Specific reasons this role excites Wolf
5. Close — Forward-looking, confident, warm`;

function buildAssemblePrompt(job, extractedFacts, personalInfo, researchNotes) {
  return `## Job Details
Company: ${job.company}
Title: ${job.title}

## Company Research
${researchNotes || 'No specific research available — use general knowledge of the company'}

## Wolf's Profile
Name: ${personalInfo.full_name || 'Wolfgang Schram'}
Location: ${personalInfo.location || 'Los Angeles, CA'}
Positioning: ${personalInfo.positioning_statement || 'Leadership for leaders — empowerment, people development, ownership culture'}

## APPROVED FACTS (use ONLY these)
${JSON.stringify(extractedFacts, null, 2)}

## Task
Write a cover letter for the ${job.title} role at ${job.company} using ONLY the approved facts above. Follow the P→P→R framework. Output the cover letter text only — no commentary.`;
}

// ─── Hallucination Filter ────────────────────────────────────────────

const HALLU_SYSTEM = `You are a fact-checker. Your job is to verify that every factual claim in a cover letter is supported by the approved facts list.

Classify each claim as:
- "hard" — Numbers, dates, company names, team sizes, revenue, technologies, specific scope metrics. These REQUIRE evidence from the facts list.
- "soft" — General leadership philosophy statements, values, beliefs. These are allowed without evidence.

Output valid JSON only.`;

function buildHallucinationPrompt(letterText, extractedFacts) {
  return `## Cover Letter to Verify
${letterText}

## Approved Facts (source of truth)
${JSON.stringify(extractedFacts, null, 2)}

## Task
Extract every factual claim from the cover letter. For each claim, determine:
1. Is it "hard" (specific metrics/names/dates) or "soft" (general statements)?
2. If hard, does it have evidence in the approved facts list?

Output JSON:
{
  "claims": [
    {
      "claim_text": "the exact claim from the letter",
      "type": "hard" or "soft",
      "entity": "key entity (company name, number, etc.)",
      "has_evidence": true/false,
      "evidence_source": "matching fact or null"
    }
  ],
  "result": "pass" or "fail",
  "unverified_hard_claims": ["list of hard claims without evidence"],
  "summary": "brief assessment"
}`;
}

// ─── Self-Scoring ────────────────────────────────────────────────────

const SCORE_SYSTEM = `You are a cover letter quality reviewer for VP/SVP Engineering applications. Score the letter on a 1-10 scale.

Evaluation criteria:
- P→P→R structure (each paragraph has clear Problem→Product→Result)
- Specificity (uses concrete stories, not generic statements)
- Company relevance (tailored to this specific company and role)
- Voice (warm, direct, confident — no corporate jargon or AI clichés)
- Length (under 400 words)
- Opening (does NOT start with "I am writing to apply")
- Authenticity (sounds like a real person, not an AI)

Output valid JSON only.`;

function buildScorePrompt(letterText, job) {
  return `## Cover Letter
${letterText}

## Job Context
Company: ${job.company}
Title: ${job.title}

## Task
Score this cover letter 1-10 and provide brief feedback.

Output JSON:
{
  "score": <integer 1-10>,
  "strengths": ["strength 1", "strength 2"],
  "weaknesses": ["weakness 1"],
  "feedback": "one-paragraph feedback for improvement",
  "word_count": <estimated word count>
}`;
}

// ─── Parse JSON from LLM output ──────────────────────────────────────

function parseJSON(text) {
  // Try to extract JSON from markdown code blocks or raw text
  const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/(\{[\s\S]*\})/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  return JSON.parse(text);
}

// ─── Main Generation Pipeline ────────────────────────────────────────

/**
 * Generate a cover letter for a job.
 *
 * @param {object} db - Database instance
 * @param {string} apiKey - Anthropic API key
 * @param {number} jobId - Job ID
 * @param {object} options - { dryRun, skipHallucination }
 * @returns {object} { success, version, letter, score, hallucination, costs, error }
 */
async function generateCoverLetter(db, apiKey, jobId, options = {}) {
  const { dryRun = false } = options;

  // ─── Pre-checks ────────────────────────────────────────────────
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
  if (!job) throw new Error(`Job ${jobId} not found`);

  // Daily limit removed — generate as many as needed
  // (Cost tracking still happens via cost_estimate column for monitoring)

  // Load context
  const contextFiles = loadContextFiles();
  const qaBank = loadQABank(db);
  const personalInfo = {};
  try {
    const rows = db.prepare('SELECT key, value FROM personal_info').all();
    for (const r of rows) personalInfo[r.key] = r.value;
  } catch {}

  // Load research notes
  let researchNotes = '';
  try {
    const research = db.prepare('SELECT * FROM company_research WHERE job_id = ?').get(jobId);
    if (research) {
      researchNotes = [research.company_summary, research.culture_notes, research.key_people, research.recent_news]
        .filter(Boolean).join('\n\n');
    }
  } catch {}

  const costs = { extraction: {}, assembly: {}, hallucination: {}, scoring: {}, total_cost: 0 };
  const jobWithResearch = { ...job, research_notes: researchNotes };

  if (dryRun) {
    return {
      success: true, dryRun: true,
      extract_prompt: buildExtractPrompt(jobWithResearch, contextFiles, qaBank),
      assemble_prompt: '(generated after extraction)',
      context_files: Object.keys(contextFiles),
      qa_entries: qaBank ? qaBank.split('\n\n').length : 0,
    };
  }

  // ─── Call 1: Extraction ────────────────────────────────────────
  const extractResult = await callClaude(
    apiKey, EXTRACT_SYSTEM,
    buildExtractPrompt(jobWithResearch, contextFiles, qaBank),
    TOKEN_LIMITS.extraction
  );
  costs.extraction = { input_tokens: extractResult.input_tokens, output_tokens: extractResult.output_tokens };

  let extractedFacts;
  try {
    extractedFacts = parseJSON(extractResult.text);
  } catch (e) {
    throw new Error(`Extraction failed to return valid JSON: ${e.message}\nRaw: ${extractResult.text.slice(0, 500)}`);
  }

  // ─── Call 2: Assembly ──────────────────────────────────────────
  const assembleResult = await callClaude(
    apiKey, ASSEMBLE_SYSTEM,
    buildAssemblePrompt(jobWithResearch, extractedFacts, personalInfo, researchNotes),
    TOKEN_LIMITS.assembly
  );
  costs.assembly = { input_tokens: assembleResult.input_tokens, output_tokens: assembleResult.output_tokens };
  let letterText = assembleResult.text.trim();

  // ─── Hallucination Filter ─────────────────────────────────────
  const relevantFacts = (extractedFacts && extractedFacts.relevant_facts) || [];
  const halluResult = await callClaude(
    apiKey, HALLU_SYSTEM,
    buildHallucinationPrompt(letterText, relevantFacts),
    TOKEN_LIMITS.hallucination
  );
  costs.hallucination = { input_tokens: halluResult.input_tokens, output_tokens: halluResult.output_tokens };

  let halluCheck;
  try {
    halluCheck = parseJSON(halluResult.text);
  } catch {
    halluCheck = { result: 'pending', claims: [], unverified_hard_claims: [], summary: 'Failed to parse hallucination check' };
  }

  // ─── Self-Scoring (attempt 1) ─────────────────────────────────
  const scoreResult1 = await callClaude(
    apiKey, SCORE_SYSTEM,
    buildScorePrompt(letterText, job),
    TOKEN_LIMITS.scoring
  );
  costs.scoring = { input_tokens: scoreResult1.input_tokens, output_tokens: scoreResult1.output_tokens };

  let scoreData;
  try {
    scoreData = parseJSON(scoreResult1.text);
  } catch {
    scoreData = { score: 5, feedback: 'Failed to parse score response' };
  }

  // ─── Retry if score < 7 (max 1 retry) ─────────────────────────
  let needsReview = 0;
  let retryAttempt = false;

  if (scoreData.score < 7) {
    retryAttempt = true;
    // Regenerate with feedback
    const retryPrompt = buildAssemblePrompt(jobWithResearch, extractedFacts, personalInfo, researchNotes) +
      `\n\n## FEEDBACK FROM PREVIOUS ATTEMPT (score: ${scoreData.score}/10)\n${scoreData.feedback}\nWeaknesses: ${(scoreData.weaknesses || []).join(', ')}\n\nPlease address this feedback in your revised letter.`;

    const retryResult = await callClaude(apiKey, ASSEMBLE_SYSTEM, retryPrompt, TOKEN_LIMITS.assembly);
    costs.assembly.input_tokens += retryResult.input_tokens;
    costs.assembly.output_tokens += retryResult.output_tokens;
    letterText = retryResult.text.trim();

    // Re-score
    const scoreResult2 = await callClaude(apiKey, SCORE_SYSTEM, buildScorePrompt(letterText, job), TOKEN_LIMITS.scoring);
    costs.scoring.input_tokens += scoreResult2.input_tokens;
    costs.scoring.output_tokens += scoreResult2.output_tokens;

    try {
      scoreData = parseJSON(scoreResult2.text);
    } catch {
      scoreData = { score: 5, feedback: 'Failed to parse retry score' };
    }

    // Re-run hallucination check on new letter
    const halluResult2 = await callClaude(apiKey, HALLU_SYSTEM, buildHallucinationPrompt(letterText, relevantFacts), TOKEN_LIMITS.hallucination);
    costs.hallucination.input_tokens += halluResult2.input_tokens;
    costs.hallucination.output_tokens += halluResult2.output_tokens;
    try { halluCheck = parseJSON(halluResult2.text); } catch {}

    if (scoreData.score < 7) {
      needsReview = 1; // Wolf needs to manually review
    }
  }

  // ─── Calculate cost ────────────────────────────────────────────
  // Claude Sonnet pricing: $3/M input, $15/M output
  const costEntries = [costs.extraction, costs.assembly, costs.hallucination, costs.scoring];
  const totalInput = costEntries.reduce((sum, c) => sum + (c.input_tokens || 0), 0);
  const totalOutput = costEntries.reduce((sum, c) => sum + (c.output_tokens || 0), 0);
  costs.total_cost = Math.max(0, (totalInput * 3 / 1000000) + (totalOutput * 15 / 1000000));

  // ─── Save to database ─────────────────────────────────────────
  const lastVersion = db.prepare('SELECT MAX(version) as v FROM cover_letter_versions WHERE job_id = ?').get(jobId);
  const newVersion = (lastVersion?.v || 0) + 1;

  db.prepare(`
    INSERT INTO cover_letter_versions (job_id, version, content, self_score, hallucination_check, flagged_claims, model_used, prompt_tokens, completion_tokens, cost_estimate, needs_review)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    jobId, newVersion, letterText, scoreData.score,
    halluCheck.result || 'pending',
    JSON.stringify(halluCheck.unverified_hard_claims || []),
    MODEL, totalInput, totalOutput, costs.total_cost, needsReview
  );

  // Update job status
  const newStatus = needsReview ? 'PENDING_APPROVAL' : (halluCheck.result === 'fail' ? 'PENDING_APPROVAL' : 'COVER_LETTER_READY');
  db.prepare("UPDATE jobs SET status = ?, cover_letter = ?, date_updated = datetime('now') WHERE id = ?")
    .run(newStatus, letterText, jobId);

  return {
    success: true,
    job_id: jobId,
    version: newVersion,
    letter: letterText,
    score: scoreData.score,
    score_feedback: scoreData.feedback,
    hallucination: halluCheck.result,
    flagged_claims: halluCheck.unverified_hard_claims || [],
    needs_review: needsReview === 1,
    retry_attempted: retryAttempt,
    costs,
    model: MODEL,
  };
}

// ─── Register Prompts ────────────────────────────────────────────────

function registerPrompts(db) {
  const upsert = db.prepare(`
    INSERT INTO prompt_registry (name, template, variables, version, model_version)
    SELECT ?, ?, ?, COALESCE((SELECT MAX(version) FROM prompt_registry WHERE name = ?), 0) + 1, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM prompt_registry WHERE name = ? AND template = ?
    )
  `);

  const prompts = [
    { name: 'cover_letter_extract', template: EXTRACT_SYSTEM, variables: JSON.stringify(['job', 'context_files', 'qa_bank']) },
    { name: 'cover_letter_assemble', template: ASSEMBLE_SYSTEM, variables: JSON.stringify(['job', 'extracted_facts', 'personal_info', 'research']) },
    { name: 'hallucination_filter', template: HALLU_SYSTEM, variables: JSON.stringify(['letter_text', 'extracted_facts']) },
    { name: 'self_score', template: SCORE_SYSTEM, variables: JSON.stringify(['letter_text', 'job']) },
  ];

  for (const p of prompts) {
    upsert.run(p.name, p.template, p.variables, p.name, MODEL, p.name, p.template);
  }
}

module.exports = { generateCoverLetter, registerPrompts, loadContextFiles, callClaude, parseJSON };
