/* Okul Asistanı — arka plan çalışanı
   Yalnızca "uygulama olarak yükle" özelliği için gereklidir.
   Hiçbir şeyi önbelleğe almaz; uygulamalar, veriler ve sohbet istekleri doğrudan tarayıcıya bırakılır.
   İnternet yoksa ana sayfa yerine sade bir "bağlantı yok" ekranı gösterir. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

const BAGLANTI_YOK = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bağlantı yok — Okul Asistanı</title><meta name="theme-color" content="#14213d">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ee;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#14213d}
.k{max-width:340px;margin:24px;text-align:center;background:#fff;border:1px solid #e6e2d8;border-radius:18px;padding:28px 22px;box-shadow:0 10px 30px rgba(20,33,61,.08)}
h1{font-size:20px;margin:12px 0 6px}p{color:#5b6475;font-size:14.5px;line-height:1.5;margin:0 0 18px}
button{border:0;background:#14213d;color:#fff;font-weight:700;font-size:15px;padding:12px 20px;border-radius:12px}</style></head>
<body><div class="k"><div style="font-size:40px">📡</div><h1>İnternet bağlantısı yok</h1>
<p>Okul Asistanı'nı açmak için internete bağlanın. Verileriniz bu cihazda güvende.</p>
<button onclick="location.reload()">Tekrar dene</button></div></body></html>`;

self.addEventListener('fetch', e => {
  const r = e.request;
  /* Yalnızca ana sayfanın kendisi; uygulama çerçeveleri, dosyalar ve sohbet hiç etkilenmez */
  if (r.mode !== 'navigate' || r.destination !== 'document') return;
  e.respondWith(fetch(r).catch(() => new Response(BAGLANTI_YOK, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
