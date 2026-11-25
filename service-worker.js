/* Kora Vente - Service Worker (mode hors connexion)
   - Ne touche JAMAIS aux données de l'utilisateur (elles sont dans le localStorage du navigateur).
   - Pour forcer une mise à jour du cache après un changement de l'appli : change le numéro de VERSION ci-dessous. */
var VERSION = 'v1';
var CORE = 'koravente-core-' + VERSION;
var FONTS = 'koravente-fonts-v1';
var CORE_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];
var FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CORE).then(function (cache) {
      return Promise.all(CORE_FILES.map(function (u) {
        return fetch(new Request(u, { cache: 'reload' })).then(function (r) {
          if (!r.ok) throw new Error('Echec ' + u);
          return cache.put(u, r);
        });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // supprime seulement les anciens caches de Kora Vente
        if (k.indexOf('koravente-') === 0 && k !== CORE && k !== FONTS) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCore(req) {
  return caches.open(CORE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (r) {
      return r || c.match('./index.html') || c.match('./');
    });
  });
}

// Pages : on essaie Internet (pour avoir la dernière version), sinon (ou si c'est trop lent) la copie en cache
function pageStrategy(event) {
  var req = event.request;
  var net = fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CORE).then(function (c) { c.put('./index.html', copy); });
    }
    return res;
  });
  var timer;
  var slow = new Promise(function (resolve) {
    timer = setTimeout(function () { fromCore(req).then(resolve); }, 4000);
  });
  event.waitUntil(net.catch(function () {}));
  return Promise.race([
    net.then(function (r) { clearTimeout(timer); return r; }),
    slow
  ]).catch(function () {
    clearTimeout(timer);
    return fromCore(req);
  }).then(function (r) { return r || fromCore(req); });
}

// Autres fichiers : cache d'abord, mise à jour discrète en arrière-plan
function staleWhileRevalidate(event, cacheName) {
  var req = event.request;
  return caches.open(cacheName).then(function (cache) {
    return cache.match(req).then(function (cached) {
      var update = fetch(req).then(function (res) {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(function () { return cached; });
      event.waitUntil(update.catch(function () {}));
      return cached || update;
    });
  });
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (FONT_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(staleWhileRevalidate(event, FONTS));
    return;
  }
  if (url.origin !== self.location.origin) return; // WhatsApp, Chariow... : on ne touche à rien

  if (req.mode === 'navigate') {
    event.respondWith(pageStrategy(event));
    return;
  }
  event.respondWith(staleWhileRevalidate(event, CORE));
});
