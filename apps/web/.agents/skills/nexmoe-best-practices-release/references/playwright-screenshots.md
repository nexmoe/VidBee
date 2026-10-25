# Playwright Screenshot Capture Reference

This reference provides templates and best practices for capturing feature screenshots during release.

## Basic Screenshot Template

```javascript
import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Set viewport size
  await page.setViewportSize({ width: 1280, height: 800 });
  
  // Navigate to target page
  await page.goto('http://localhost:3000');
  
  // Wait for page to be fully loaded
  await page.waitForLoadState('networkidle');
  
  // Capture screenshot
  await page.screenshot({ path: 'screenshot.png' });
  
  await browser.close();
})();
```

## Common Viewport Sizes

| Device Type | Width | Height | Use Case |
|-------------|-------|--------|----------|
| Desktop (HD) | 1280 | 800 | Default, most features |
| Desktop (Full HD) | 1920 | 1080 | Wide layouts, dashboards |
| Laptop | 1366 | 768 | Common laptop resolution |
| Tablet (landscape) | 1024 | 768 | Responsive layouts |
| Mobile (portrait) | 375 | 667 | Mobile-first features |
| Mobile (landscape) | 667 | 375 | Mobile games, videos |

## Wait Strategies

### Wait for Network Idle

Use when page loads dynamic content via API:

```javascript
await page.goto('http://localhost:3000');
await page.waitForLoadState('networkidle');
```

### Wait for Specific Element

Use when targeting a specific feature component:

```javascript
await page.goto('http://localhost:3000');
await page.locator('.feature-component').waitFor({ state: 'visible' });
```

### Wait for Custom Condition

Use when waiting for app initialization:

```javascript
await page.goto('http://localhost:3000');
await page.waitForFunction(() => window.appReady === true);
```

### Wait for Timeout (Last Resort)

Use only when other strategies don't work:

```javascript
await page.goto('http://localhost:3000');
await page.waitForTimeout(2000); // Wait 2 seconds
```

## Interactive Screenshots

### Click to Show Feature

```javascript
// Navigate to page
await page.goto('http://localhost:3000');
await page.waitForLoadState('networkidle');

// Click button to open modal/dialog
await page.click('.demo-button');

// Wait for animation
await page.waitForTimeout(300);

// Capture
await page.screenshot({ path: 'feature-modal.png' });
```

### Fill Form

```javascript
// Navigate to form page
await page.goto('http://localhost:3000/form');

// Fill form fields
await page.fill('input[name="email"]', 'demo@example.com');
await page.fill('input[name="password"]', 'demo123');

// Capture filled state
await page.screenshot({ path: 'form-filled.png' });
```

### Hover State

```javascript
await page.goto('http://localhost:3000');

// Hover over element
await page.hover('.hover-demo');

// Wait for hover effect
await page.waitForTimeout(200);

await page.screenshot({ path: 'hover-state.png' });
```

## Screenshot Options

### Full Page Screenshot

Capture entire scrollable page:

```javascript
await page.screenshot({ 
  path: 'full-page.png',
  fullPage: true 
});
```

### Element-Specific Screenshot

Capture only a specific component:

```javascript
const element = await page.locator('.feature-component');
await element.screenshot({ path: 'component.png' });
```

### High DPI / Retina Display

Capture at 2x resolution:

```javascript
await page.setViewportSize({ width: 1280, height: 800 });
await page.screenshot({ 
  path: 'retina.png',
  deviceScaleFactor: 2 
});
```

## Server Management

### Start Dev Server (Node.js)

```bash
# Start server in background
npm run dev &
DEV_PID=$!

# Wait for server ready
until curl -s http://localhost:3000 > /dev/null; do
  sleep 1
done

# Run screenshot script
node capture.mjs

# Clean up
kill $DEV_PID
```

### Check Port Availability

```bash
# Check if port is in use
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
  echo "Port 3000 already in use"
else
  echo "Port 3000 available"
fi
```

## Error Handling

### Robust Screenshot Script

```javascript
import { chromium } from 'playwright';

(async () => {
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    
    await page.setViewportSize({ width: 1280, height: 800 });
    
    // Set timeout for navigation
    await page.goto('http://localhost:3000', { 
      timeout: 30000,
      waitUntil: 'networkidle' 
    });
    
    // Wait for critical element with timeout
    await page.locator('.app-loaded').waitFor({ 
      state: 'visible',
      timeout: 10000 
    });
    
    await page.screenshot({ path: 'screenshot.png' });
    
    console.log('Screenshot captured successfully');
    
  } catch (error) {
    console.error('Screenshot failed:', error.message);
    process.exit(1);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
```

## Multi-Screenshot Workflow

Capture multiple features in one script:

```javascript
import { chromium } from 'playwright';

const screenshots = [
  {
    name: 'oauth-login',
    url: 'http://localhost:3000/login',
    selector: '.oauth-buttons',
    actions: async (page) => {
      await page.click('.show-oauth-button');
    }
  },
  {
    name: 'dark-mode',
    url: 'http://localhost:3000',
    selector: '.app-container',
    actions: async (page) => {
      await page.click('.theme-toggle');
      await page.waitForTimeout(300);
    }
  }
];

(async () => {
  const browser = await chromium.launch();
  
  for (const shot of screenshots) {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(shot.url);
    await page.waitForLoadState('networkidle');
    
    if (shot.actions) {
      await shot.actions(page);
    }
    
    await page.locator(shot.selector).waitFor({ state: 'visible' });
    await page.screenshot({ path: `screenshots/${shot.name}.png` });
    
    await page.close();
    console.log(`✓ Captured ${shot.name}`);
  }
  
  await browser.close();
})();
```

## Best Practices

1. **Always wait for content**: Use `networkidle` or specific selectors, never rely on fixed timeouts alone
2. **Use consistent viewport sizes**: Stick to 1280x800 for most desktop features
3. **Handle animations**: Add small delays (200-300ms) after interactions that trigger animations
4. **Verify element visibility**: Always check critical elements are visible before capturing
5. **Clean up resources**: Always close browser in `finally` block
6. **Name screenshots descriptively**: Use `{version}-{feature-slug}.png` format
7. **Keep file sizes reasonable**: Aim for < 500KB per screenshot, compress if needed
8. **Test scripts before release**: Run screenshot scripts in dry-run mode first

## Installation Check

```bash
# Check if Playwright is installed
if npm list playwright > /dev/null 2>&1; then
  echo "Playwright installed"
else
  echo "Installing Playwright..."
  npm install -D playwright
  npx playwright install chromium
fi
```

## Troubleshooting

### Browser Launch Fails

```bash
# Install browser binaries
npx playwright install chromium
```

### Port Connection Refused

```bash
# Check if dev server is actually running
curl -I http://localhost:3000

# Check correct port number in package.json
cat package.json | grep -A 5 "scripts"
```

### Screenshot is Blank

- Add longer wait time after `goto()`
- Check if element selector is correct
- Verify page doesn't have authentication requirements
- Check browser console for errors: `page.on('console', msg => console.log(msg.text()))`

### Screenshot Too Large

```bash
# Compress PNG using built-in tools (macOS)
pngquant screenshot.png --quality=65-80 --output compressed.png

# Or use ImageMagick
convert screenshot.png -quality 80 compressed.png
```
