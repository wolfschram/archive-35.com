# Procedure: Add New Gallery

## Prerequisites
- Photos exported as JPG or TIFF
- Gallery name decided
- Basic info: location, dates, story

## Method 1: Archive-35 Studio (Recommended)
1. Open Archive-35 Studio
2. Go to "Content Ingestion" tab
3. Click "New Gallery"
4. Drag & drop photos or select folder
5. Fill in gallery info when prompted
6. Review AI-generated descriptions
7. Click "Process"
8. Photos moved to 01_Portfolio/[gallery-name]/

## Method 2: Manual (via Claude Desktop)
1. Create folder: 01_Portfolio/[gallery-name]/
2. Create subfolders: originals/, web/
3. Copy full-res photos to originals/
4. Tell Claude Desktop: "Process new gallery [name]"
5. Claude will resize images and create JSON files

## Method 3: Inbox Drop
1. Copy photos to 00_Inbox/
2. Tell Claude Desktop: "Process inbox"
3. Follow prompts for gallery assignment

## After Processing
- Verify _gallery.json created
- Verify _photos.json created
- Verify web/ has resized images
- Preview website locally
- Deploy when ready
