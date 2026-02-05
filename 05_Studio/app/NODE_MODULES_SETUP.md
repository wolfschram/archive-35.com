# Node Modules Setup (Google Drive Symlink)

**Why this exists:** node_modules is huge (~800MB, 1000+ packages) and causes sync issues with Google Drive. Instead, we use a symlink so:
- Code syncs via Google Drive ✓
- node_modules stays local per machine ✓

---

## First Time Setup (Each Machine)

### 1. Create local folder
```bash
mkdir -p ~/node_modules_studio
```

### 2. Create symlink (if not already present)
```bash
# Check if symlink exists
ls -la ~/My\ Drive\ \(wolf@schramfamily.com\)/My\ Drive/Archive-35.com/05_Studio/app/node_modules

# If it's a real folder, move it out first:
mv ~/My\ Drive\ \(wolf@schramfamily.com\)/My\ Drive/Archive-35.com/05_Studio/app/node_modules ~/node_modules_studio_backup

# Create symlink
ln -s ~/node_modules_studio ~/My\ Drive\ \(wolf@schramfamily.com\)/My\ Drive/Archive-35.com/05_Studio/app/node_modules
```

### 3. Install dependencies
```bash
cd ~/My\ Drive\ \(wolf@schramfamily.com\)/My\ Drive/Archive-35.com/05_Studio/app
npm install
```

---

## Daily Use

| Machine | What Happens |
|---------|--------------|
| **Dev Mac** | Edit code → syncs via Google Drive |
| **Run Mac** | Code syncs → run app with local node_modules |

No extra steps needed after initial setup.

---

## Troubleshooting

**"Cannot find module X"**
→ Run `npm install` — you probably haven't installed on this machine yet

**Symlink broken / points to wrong place**
→ Delete symlink, re-create pointing to `~/node_modules_studio`

**node_modules is a real folder (not symlink)**
→ Move it out: `mv node_modules ~/node_modules_backup`
→ Create symlink as shown above

---

*Created: 2026-02-04*
