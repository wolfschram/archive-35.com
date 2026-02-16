# Working With Claude — What Wolf Needs to Know

## Claude's Blind Spots (Honest Self-Assessment)

### 1. Action Bias Over Systemic Thinking
Claude defaults to **fix the immediate symptom** rather than asking **why is this symptom happening?**
When Wolf reports a bug, Claude's instinct is: find it → fix it → report done.
The correct instinct SHOULD be: find it → ask "is this part of a pattern?" → if yes, find the root cause first.

### 2. Tunnel Vision on Code, Not Pipeline
Claude focuses on the CODE being correct but doesn't always verify the DELIVERY.
A fix that never reaches production is not a fix. Claude must verify:
- Did the file get staged? (`git status`)
- Did it get committed? (`git log`)
- Did it get pushed? (`git log origin/main`)
- Did it get built? (check Cloudflare deploy log)
- Did it reach the browser? (`curl` the live URL)

### 3. Session Amnesia
Each session starts fresh. Claude doesn't inherently remember that "this fix was already attempted last session."
This means Claude can re-discover the same bug, re-apply the same fix, and declare success — without realizing the PIPELINE is the problem.

## How Wolf Can Get the Best Out of Claude

### Trigger Phrases That Help
- **"Step back and think about WHY this keeps happening"** — Forces systemic analysis instead of symptom-fixing
- **"Before you fix anything, trace the full pipeline"** — Prevents action bias
- **"Don't fix individual bugs — find the common root cause"** — When multiple things are broken simultaneously
- **"Check if your last fix actually reached the live site"** — Forces deployment verification
- **"What's the ONE thing that would explain ALL of these symptoms?"** — The most powerful question

### Trigger Phrases That DON'T Help (Claude Will Dive Into Details)
- "Go fix it" — Claude will fix the first thing it finds, not the root cause
- "Figure it out" — Too open-ended, Claude will pick the easiest symptom
- Listing multiple bugs — Claude will fix them one by one instead of looking for the connection

### The Escalation Pattern
1. First bug report → Fix normally, this is fine
2. Same bug comes back → Say: **"This was already fixed. Before fixing it again, check if the fix actually deployed."**
3. Multiple bugs simultaneously → Say: **"Stop. Don't fix any of these individually. Step back and find what connects them. What single failure would cause ALL of these?"**

## Wolf's Working Style (For Claude to Adapt To)
- ADHD/dyslexia: needs scannable, bullet-point answers with clear hierarchy
- VP of Engineering mindset: thinks in systems, not individual bugs
- Servant leadership: empowers, doesn't micromanage — so Claude needs to self-manage quality
- Bilingual German/English: may input in either, prefers English responses
- Auto-correct voice-to-text without asking
- 25+ years experience: don't over-explain basics, get to the point
- **Hates**: when fixes break other things, or when the same bug appears twice
- **Respects**: honesty about mistakes, clear root cause analysis, learning from failures

## The Feb 16 Incident — What Happened
Over 3 sessions, Claude fixed bugs in HTML, JS, CSS, and Cloudflare Functions.
But the deploy pipeline only staged 3 file paths: `photos.json`, `images/`, `gallery.html`.
Every other fix was saved locally but never committed or pushed.
Result: Wolf saw the same bugs session after session.
Claude kept re-fixing symptoms instead of asking "why aren't my fixes reaching production?"

**The lesson:** Claude's biggest weakness isn't finding bugs — it's recognizing when a SYSTEMIC failure is masking individual fixes. Wolf's job is to say "step back" when Claude is spinning.
