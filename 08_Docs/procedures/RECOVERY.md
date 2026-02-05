# Recovery Procedures

## Website Down

### Check GitHub Pages Status
1. Go to https://github.com/wolfschram/archive-35.com/settings/pages
2. Verify source is set to main branch
3. Check for any error messages

### Check DNS
1. Go to Squarespace DNS settings
2. Verify A records point to GitHub IPs
3. Verify CNAME points to wolfschram.github.io

### Redeploy
```bash
cd "/Users/wolfgangschram/My Drive (wolf@schramfamily.com)/My Drive/Archive-35.com/04_Website/dist"
git push origin main --force
```

## Lost Files

### Restore from Google Drive
1. Open Google Drive web interface
2. Check Trash for deleted files
3. Use version history for modified files

### Restore from GitHub
1. Check commit history for previous versions
2. Revert to earlier commit if needed

### Restore from 09_Backups/
1. Find most recent backup before issue
2. Copy files back to original location

## Corrupted JSON

### _master.json
Rebuild from individual _gallery.json files

### _photos.json
Re-run photo analysis on gallery

### _queue.json
Start fresh, re-add pending posts

## API Issues

### Rate limited
Wait and retry. Check API dashboard for limits.

### Invalid token
Regenerate API key, update .env file

## Emergency Contacts
- GitHub Support: https://support.github.com
- Squarespace Support: https://support.squarespace.com
- Artelo Support: info@artelo.io
