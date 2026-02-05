# DNS Settings for archive-35.com

## Overview
Domain registered with Squarespace, pointing to GitHub Pages.

## Current Configuration

### Registrar
- Provider: Squarespace
- Domain: archive-35.com
- Expires: February 2029

### DNS Management
URL: https://account.squarespace.com/domains/managed/archive-35.com/dns/dns-settings

### A Records (Root Domain)
These point archive-35.com to GitHub Pages servers:

| Host | Type | TTL | Value |
|------|------|-----|-------|
| @ | A | 4 hrs | 185.199.108.153 |
| @ | A | 4 hrs | 185.199.109.153 |
| @ | A | 4 hrs | 185.199.110.153 |
| @ | A | 4 hrs | 185.199.111.153 |

### CNAME Record (WWW Subdomain)
This points www.archive-35.com to GitHub:

| Host | Type | TTL | Value |
|------|------|-----|-------|
| www | CNAME | 4 hrs | wolfschram.github.io |

## GitHub Pages Configuration
URL: https://github.com/wolfschram/archive-35.com/settings/pages

- Source: Deploy from branch
- Branch: main
- Folder: / (root)
- Custom domain: archive-35.com
- Enforce HTTPS: ✓ (after certificate issued)

## CNAME File
Located at: 04_Website/dist/CNAME
Contents: archive-35.com

This file MUST be in the repo root for custom domain to work.

## Troubleshooting

### DNS not working
1. Check A records are correct
2. Wait up to 48 hours for propagation
3. Test with: dig archive-35.com

### HTTPS not working
1. Check "Enforce HTTPS" in GitHub Pages settings
2. Wait up to 24 hours for certificate
3. Certificate auto-renews

### Changes not showing
1. Clear browser cache
2. Check GitHub Actions for deploy status
3. Verify files in repo main branch
