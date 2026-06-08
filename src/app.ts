// Returns the full PWA HTML shell. The SPA logic lives in /static/app.js.
export function renderApp(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover, user-scalable=no" />
  <meta name="theme-color" content="#0b0f1a" />
  <meta name="description" content="Invoker — Enterprise Invoice, Report & Certificate management for hospitals and companies." />
  <title>Invoker — Enterprise Document Suite</title>
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.1/css/all.min.css" rel="stylesheet" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Sora:wght@600;700;800&family=Cinzel:wght@600;700;800;900&display=swap" rel="stylesheet" />
  <link href="/static/style.css" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js" defer></script>
  <script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js" defer></script>
</head>
<body data-theme="dark">
  <div id="splash" class="splash">
    <div class="splash-logo"></div>
    <div class="splash-name">INVOKER</div>
    <div class="splash-bar"><span></span></div>
  </div>

  <div id="app-root"></div>

  <div id="toast-host" class="toast-host"></div>
  <div id="modal-host"></div>

  <script src="/static/app.js" defer></script>
  <script>
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(console.error)
      })
    }
  </script>
</body>
</html>`
}
