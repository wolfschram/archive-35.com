# Archive 35 — Automation Scripts

*Python scripts for content management and posting*

---

## Overview

These scripts run on Wolf's home server to automate:
- Post scheduling and publishing
- Caption generation assistance
- Queue management

---

## Setup

```bash
cd 06_Automation
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp config.yaml.example config.yaml
# Edit config.yaml with your API keys
```

---

## Scripts

### post_scheduler.py
Reads `_schedule.csv` and publishes posts at scheduled times.

### caption_generator.py
Generates caption drafts from image metadata.

### queue_manager.py
Manages the posting queue, moves files between Queue and Posted.

---

## Configuration

Edit `config.yaml` with:
- Platform API credentials
- Posting preferences
- File paths

---

## Status

🔴 **Not yet implemented** — Placeholder structure only

---

## Future Enhancements

- [ ] Instagram API integration (Meta Business)
- [ ] Auto-resize for platform requirements
- [ ] Analytics tracking
- [ ] Backup automation
