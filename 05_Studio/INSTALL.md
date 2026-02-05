# Archive-35 Studio Installation

## Prerequisites
- Node.js 18+ (https://nodejs.org)
- npm (comes with Node.js)
- macOS 10.15+

## Installation

1. Open Terminal

2. Navigate to the app folder:
   ```bash
   cd "/Users/wolfgangschram/My Drive (wolf@schramfamily.com)/My Drive/Archive-35.com/05_Studio/app"
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Start the app in development mode:
   ```bash
   npm start
   ```

## Building for Production

To create a standalone .app file:

```bash
npm run build
```

The built app will be in `05_Studio/app/dist/`

## Troubleshooting

### "npm not found"
Install Node.js from https://nodejs.org

### Sharp module errors
Run:
```bash
npm rebuild sharp
```

### Electron not starting
Try:
```bash
rm -rf node_modules
npm install
```

## Updating

Pull latest changes and reinstall:
```bash
git pull
npm install
```
