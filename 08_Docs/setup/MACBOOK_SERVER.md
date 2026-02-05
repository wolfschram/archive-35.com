# MacBook Pro Server Setup

## Machine Specs
- Model: MacBook Pro 15" (2016)
- CPU: 2.9GHz Intel Core i7
- RAM: 16GB
- Storage: 2TB SSD
- macOS: [version to be confirmed]

## Purpose
This machine runs 24/7 as a local server for:
- Automation scripts (cron jobs)
- MCP servers
- Social media posting
- Analytics collection
- Daily reports

## Setup Checklist

### System
- [ ] Update macOS to latest supported version
- [ ] Enable automatic login
- [ ] Disable sleep when plugged in
- [ ] Configure energy saver settings

### Software
- [ ] Install Homebrew
- [ ] Install Python 3.x
- [ ] Install Node.js (for Electron/MCP)
- [ ] Install exiftool
- [ ] Install Git

### Google Drive
- [ ] Install Google Drive for Desktop
- [ ] Sign in with wolf@schramfamily.com
- [ ] Sync Archive-35.com folder
- [ ] Verify all files accessible

### Claude Desktop
- [ ] Install Claude Desktop
- [ ] Configure with Archive-35 system prompt
- [ ] Point to _CLAUDE/ folder

### Cron Jobs
- [ ] Set up daily automation schedule
- [ ] Configure launchd for persistent jobs

## Network
- [ ] Static IP on local network (recommended)
- [ ] UPS for power protection (recommended)

## Monitoring
- [ ] Set up email alerts for failures
- [ ] Log file location: 06_Automation/logs/
