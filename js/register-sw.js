// Registers the service worker so the app works offline.

// Register Service Worker for offline capability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('Service Worker listo'))
      .catch(e => console.warn('Error en Service Worker:', e));
  });
}
