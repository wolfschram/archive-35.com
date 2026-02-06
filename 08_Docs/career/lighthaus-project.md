# Lighthaus Project Reference

Load this file when Wolf is working on his personal AI assistant project.

---

## Project Overview

**Name:** Lighthaus (formerly "Jenny")

**Vision:** A personal AI assistant that bridges the gap between conversational AI and agentic AI — maintaining deep personal context across all interactions.

**Problem Being Solved:**
- Chat AI loses context between sessions
- Agentic AI (like Cowork) starts fresh every time
- No unified system that truly "knows" the user

---

## Core Concept

Lighthaus should:
- Maintain persistent context about Wolf
- Work across chat and agentic modes seamlessly
- Feel like a true collaborator, not a tool
- Learn and adapt to Wolf's style over time

---

## Technical Considerations

**Context Management:**
- How to persist relevant information without bloating prompts
- Selective memory retrieval vs. always-on context
- Handling updates and corrections to stored knowledge

**Architecture Options:**
- Wrapper around existing LLM APIs
- Custom context management layer
- Integration with file-based knowledge stores
- MCP (Model Context Protocol) integration

**Deployment:**
- Desktop app? Web app? Both?
- Local vs. cloud processing
- Privacy considerations (Wolf's data sensitivity)

---

## Competitive Landscape

**What exists:**
- ChatGPT memory (summarized, not transparent)
- Claude memory (RAG-based, tool-visible)
- Claude Cowork (agentic but no session memory)
- Custom GPTs (limited context, no agentic capability)

**Lighthaus differentiator:** True continuity across conversational and agentic modes, with transparent and user-controllable context.

---

## Development Status

Currently in: **Architecture & Strategy Phase**

Next steps to consider:
- Define MVP scope
- Choose technical stack
- Build proof of concept
- Test with real workflows

---

## Business Potential

Could be:
1. **Personal tool only** — Wolf's productivity enhancement
2. **Productized offering** — For other executives/knowledge workers
3. **Framework/template** — Open-source or licensed approach

**Key question:** Is the value in the tool itself, or in the methodology of building personal AI assistants?

---

## Connection to Job Search

Lighthaus demonstrates:
- Technical capability (Wolf can still build)
- Product thinking (identifying unmet needs)
- Innovation mindset
- Practical AI application beyond hype

**Interview talking point:** "I'm building my own AI assistant because I couldn't find one that truly maintained context the way I work. That's the same approach I bring to engineering leadership — if a tool doesn't exist, build it."
