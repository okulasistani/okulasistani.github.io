/* =====================================================================
   OKUL ASİSTANI — SOHBET SUNUCUSU (Vercel fonksiyonu)
   Adres: /api/sohbet       Veritabanı: Upstash Redis (Vercel Storage)

   Gerekli ortam değişkenleri (Vercel → Settings → Environment Variables):
     KV_REST_API_URL, KV_REST_API_TOKEN   → Upstash bağlanınca kendiliğinden eklenir
                                            (UPSTASH_REDIS_REST_URL / _TOKEN da olur)
     SOHBET_SIFRE                          → yönetim şifresi (siz belirlersiniz)
     SOHBET_TUZ (isteğe bağlı)             → isim/IP özetleri için gizli tuz

   Gizlilik: IP adresi ve cihaz kimliği saklanmaz; yalnızca geri çevrilemez
   özetleri (susturma ve tekrar engeli için) tutulur, dışarı verilmez.
   ===================================================================== */
const crypto = require('crypto');

const R_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SIFRE = process.env.SOHBET_SIFRE || '';
const TUZ = process.env.SOHBET_TUZ || crypto.createHash('sha256').update('oa-sohbet:' + R_TOKEN).digest('hex');

const K = {
  seq: 'sohbet:seq',            // son mesaj numarası
  deg: 'sohbet:degisim',        // silme/gizleme sayacı (istemciler listeyi tazeler)
  msj: 'sohbet:mesajlar',       // sıralı küme: puan = mesaj no, üye = JSON
  gizli: 'sohbet:gizli',        // bildirimle gizlenenler (hash: no → JSON)
  sus: 'sohbet:susturulan',     // küme: c:<cihazÖzeti> / i:<ipÖzeti>
  bildir: id => 'sohbet:bildir:' + id,
  hiz: (t, x) => 'sohbet:hiz:' + t + ':' + x,
  sonMetin: c => 'sohbet:sonmetin:' + c
};
const SAKLA = 1000;            // en fazla bu kadar mesaj tutulur
const SAYFA = 50;              // bir seferde gelen mesaj
const MAKS_UZUNLUK = 500;
const BILDIRIM_ESIGI = 3;      // bu kadar farklı kişi bildirirse mesaj gizlenir
const DUZENLEME_SURESI = 15 * 60 * 1000;   // kendi mesajını düzenleme süresi
const ALINTI_UZUNLUK = 120;

/* ---------- Redis (REST) ---------- */
async function redis(komutlar) {
  const r = await fetch(R_URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + R_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(komutlar)
  });
  if (!r.ok) throw new Error('Veritabanı yanıt vermedi (' + r.status + ')');
  const j = await r.json();
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}
const tek = async (...k) => (await redis([k]))[0];

/* ---------- yardımcılar ---------- */
const ozet = (s, n) => crypto.createHmac('sha256', TUZ).update(String(s)).digest().subarray(0, n || 8);
const hex = b => Buffer.from(b).toString('hex');

const ISIM_ON = ['Misafir', 'Kullanıcı', 'Ziyaretçi'];
const ISIM_KELIME = ['Kartal', 'Çınar', 'Martı', 'Ceylan', 'Pelikan', 'Sedir', 'Lale', 'Papatya', 'Kumru', 'Atmaca',
  'Şahin', 'Turna', 'Leylek', 'Serçe', 'Bülbül', 'Kırlangıç', 'Ardıç', 'Meşe', 'Kavak', 'Söğüt', 'Defne', 'Zeytin',
  'Ihlamur', 'Menekşe', 'Nergis', 'Sümbül', 'Gelincik', 'Yasemin', 'Fesleğen', 'Kekik', 'Yunus', 'Mercan', 'İnci',
  'Yakut', 'Zümrüt', 'Firuze', 'Toprak', 'Rüzgâr', 'Bulut', 'Yıldız', 'Şimşek', 'Dere', 'Irmak', 'Pınar', 'Vadi',
  'Tepe', 'Orman', 'Kumsal', 'Ada', 'Kaya', 'Çakıl', 'Poyraz', 'Lodos', 'Gökkuşağı', 'Kardelen', 'Begonya', 'Ladin',
  'Sardunya', 'Karanfil', 'Akasya'];
/* Gözle kolay ayırt edilen renk tonları (kırmızı, turuncu, kahve, zeytin, yeşil, camgöbeği, mavi, mor, pembe…) */
const TONLAR = [0, 22, 36, 52, 95, 140, 172, 195, 212, 232, 258, 282, 305, 332];
/* Cihaza bağlı kalıcı geçici isim ve renk tonu */
function kimlik(cihaz) {
  const b = ozet('isim:' + cihaz, 8);
  return {
    ad: ISIM_ON[b[0] % ISIM_ON.length] + ' ' + ISIM_KELIME[b[1] % ISIM_KELIME.length] + ' ' + (10 + (b[2] % 90)),
    ton: TONLAR[((b[3] << 8) | b[4]) % TONLAR.length]
  };
}
function ipAl(req) {
  const x = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  return x || 'yok';
}
const cihazGecerli = c => /^[a-f0-9]{32}$/.test(String(c || ''));

/* Türkçe karakterleri sadeleştir (küfür filtresi için) */
const sade = s => String(s).toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[0@]/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/\$/g, 's').replace(/(.)\1{2,}/g, '$1');
const KOK = ['orospu', 'siktir', 'sikerim', 'sikeyim', 'sikiyim', 'sikim', 'sikik', 'sikis', 'yarrak', 'dalyarak', 'amina',
  'amcik', 'pezevenk', 'kahpe', 'ibne', 'serefsiz', 'gavat', 'yavsak', 'surtuk', 'kaltak', 'godos', 'tasak', 'gotveren', 'pust'];
const TAM = ['amk', 'aq', 'mk', 'sik', 'pic', 'got', 'gotu', 'gotun', 'oc', 'amq'];

/* Paylaşılmasına izin verilen bağlantılar (alt alan adları dahil). Arayüzdeki LINK_IZINLI ile aynı tutulmalı. */
const IZINLI_ALANLAR = ['okul-asistani.com.tr', 'meb.gov.tr', 'meb.k12.tr', 'eba.gov.tr', 'mevzuat.gov.tr', 'resmigazete.gov.tr',
  'turkiye.gov.tr', 'youtube.com', 'youtu.be', 'drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'];
const BAGLANTI_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?/gi;
const ALAN_UZANTI = /\.(com|net|org|tr|xyz|info|io|me|ly|gl|co|site|online|link|biz|ru|top|shop|app|dev|be|cc|tv|us|uk|de|eu|gov|edu|club|live|click|vip|pro|ws|to)$/i;
function baglantiIzinli(ham) {
  const s = ham.replace(/^https?:\/\//i, ''), host = s.split(/[/:?#]/)[0].toLowerCase(), yol = s.slice(host.length);
  if (host === 't.me' || host === 'telegram.me') return /^\/okulprogram\b/i.test(yol);
  return IZINLI_ALANLAR.some(d => host === d || host.endsWith('.' + d));
}
/* Metindeki bağlantı adaylarından izinli olmayan var mı? (v7.2.9, idare.html gibi şeyler bağlantı sayılmaz) */
function izinsizBaglantiVar(m) {
  /* http(s):// ile başlayan her adres (IP adresleri dahil) izinli olmalı */
  if ((String(m).match(/https?:\/\/[^\s<>"']+/gi) || []).some(b => !baglantiIzinli(b))) return true;
  return (String(m).match(BAGLANTI_RE) || []).some(b => {
    const host = b.replace(/^https?:\/\//i, '').split(/[/:?#]/)[0];
    const bag = /^https?:\/\//i.test(b) || /^www\./i.test(host) || ALAN_UZANTI.test(host);
    return bag && !baglantiIzinli(b);
  });
}
/* Metni kontrol eder; sorun varsa kullanıcıya gösterilecek açıklamayı döndürür */
function metinSorunu(m) {
  if (!m) return 'Mesaj boş.';
  if (m.length > MAKS_UZUNLUK) return 'Mesaj en fazla ' + MAKS_UZUNLUK + ' karakter olabilir.';
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(m)) return 'Güvenliğiniz için e-posta adresi paylaşılamaz.';
  if (/(?:\d[\s\-.()/]*){10,}/.test(m)) return 'Telefon, T.C. kimlik no gibi uzun numaralar paylaşılamaz.';
  if (izinsizBaglantiVar(m))
    return 'Bu bağlantı paylaşılamaz. İzin verilenler: okul-asistani.com.tr, MEB ve okul siteleri, EBA, mevzuat, Resmî Gazete, e-Devlet, YouTube, Google Drive.';
  const kelimeler = sade(m).split(/[^a-z]+/).filter(Boolean);
  if (kelimeler.some(k => TAM.includes(k) || KOK.some(r => k.startsWith(r)))) return 'Mesajınız uygunsuz ifade içeriyor.';
  return '';
}
function temizle(m) {
  return String(m || '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{3,}/g, '  ').trim();
}
/* Dışarı verilen alanlar: cihaz ve IP özetleri asla verilmez */
const disaVer = j => {
  try {
    const x = JSON.parse(j), o = { id: x.id, t: x.t, m: x.sil ? '' : x.m, a: x.a, h: x.h, g: !!x.g };
    if (x.sil) o.sil = true;
    if (x.d && !x.sil) o.d = x.d;
    if (x.r && !x.sil) { o.r = x.r; o.ra = x.ra || ''; o.rm = x.rs ? '' : (x.rm || ''); if (x.rs) o.rs = true; }
    return o;
  } catch (e) { return null; }
};
const alintiMetni = m => { const t = String(m || '').replace(/\s+/g, ' ').trim(); return t.length > ALINTI_UZUNLUK ? t.slice(0, ALINTI_UZUNLUK) + '…' : t; };
/* Bir mesaj değişince/silinince ona verilmiş yanıtlardaki alıntıyı da güncelle (silinen metin alıntılarda kalmasın) */
async function alintilariGuncelle(id, yeniMetin, silindi) {
  const hepsi = await tek('ZRANGE', K.msj, 0, -1) || [];
  const k = [];
  hepsi.forEach(j => {
    let x; try { x = JSON.parse(j); } catch (e) { return; }
    if (x.r !== id) return;
    const y = Object.assign({}, x, silindi ? { rm: '', rs: true } : { rm: alintiMetni(yeniMetin), rs: false });
    k.push(['ZREMRANGEBYSCORE', K.msj, x.id, x.id], ['ZADD', K.msj, x.id, JSON.stringify(y)]);
  });
  if (k.length) await redis(k);
}
async function mesajDegistir(eskiHam, yeni) {
  await redis([['ZREMRANGEBYSCORE', K.msj, yeni.id, yeni.id], ['ZADD', K.msj, yeni.id, JSON.stringify(yeni)], ['INCR', K.deg]]);
}

function sifreDogru(s) {
  if (!SIFRE || !s) return false;
  const a = crypto.createHash('sha256').update(String(s)).digest(), b = crypto.createHash('sha256').update(SIFRE).digest();
  return crypto.timingSafeEqual(a, b);
}
async function govdeOku(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return await new Promise(ok => {
    let s = ''; req.on('data', d => { s += d; if (s.length > 20000) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { ok({}); } });
    req.on('error', () => ok({}));
  });
}
function yanit(res, kod, veri, onbellek) {
  res.statusCode = kod;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', onbellek || 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(veri));
}
/* Basit hız sınırı: süre içinde en fazla `adet` işlem */
async function sinirAsildi(tur, anahtar, adet, saniye) {
  const n = await tek('INCR', K.hiz(tur, anahtar));
  if (n === 1) await tek('EXPIRE', K.hiz(tur, anahtar), saniye);
  return n > adet;
}
async function mesajBul(id) {
  const r = await tek('ZRANGE', K.msj, id, id, 'BYSCORE');
  return r && r[0] ? r[0] : null;
}

/* =====================================================================
   İSTEK İŞLEYİCİ
   ===================================================================== */
module.exports = async function (req, res) {
  if (!R_URL || !R_TOKEN) return yanit(res, 503, { hata: 'Sohbet henüz kurulmadı.', kurulmadi: true });
  try {
    /* ---------------- OKUMA ---------------- */
    if (req.method === 'GET') {
      const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      /* Ortak önbellekli küçük yoklama: kaç kişi bakarsa baksın veritabanına ~15 sn'de bir gider */
      if (q.son) {
        const [son, deg] = await tek('MGET', K.seq, K.deg);
        return yanit(res, 200, { son: +son || 0, deg: +deg || 0 }, 'public, max-age=0, s-maxage=15, stale-while-revalidate=15');
      }
      let liste;
      if (q.sonra != null) {
        liste = await tek('ZRANGE', K.msj, '(' + (parseInt(q.sonra, 10) || 0), '+inf', 'BYSCORE', 'LIMIT', 0, 100);
      } else if (q.once != null) {
        liste = (await tek('ZRANGE', K.msj, '(' + (parseInt(q.once, 10) || 0), '-inf', 'BYSCORE', 'REV', 'LIMIT', 0, SAYFA)).reverse();
      } else {
        liste = (await tek('ZRANGE', K.msj, '+inf', '-inf', 'BYSCORE', 'REV', 'LIMIT', 0, SAYFA)).reverse();
      }
      const [son, deg] = await tek('MGET', K.seq, K.deg);
      return yanit(res, 200, { mesajlar: (liste || []).map(disaVer).filter(Boolean), son: +son || 0, deg: +deg || 0, sayfa: SAYFA });
    }
    if (req.method !== 'POST') return yanit(res, 405, { hata: 'Desteklenmeyen istek.' });

    /* ---------------- YAZMA ---------------- */
    const g = await govdeOku(req);
    const ip = hex(ozet('ip:' + ipAl(req)));
    const yoneticiBasligi = req.headers['x-yonetici'];
    let yonetici = false;
    if (yoneticiBasligi) {
      if (await sinirAsildi('yonetim', ip, 8, 900)) return yanit(res, 429, { hata: 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.' });
      if (!sifreDogru(yoneticiBasligi)) return yanit(res, 401, { hata: SIFRE ? 'Şifre yanlış.' : 'Yönetim şifresi tanımlanmamış (SOHBET_SIFRE).' });
      yonetici = true;
      await tek('DEL', K.hiz('yonetim', ip));
    }
    const islem = String(g.islem || '');

    if (islem === 'kimlik') {
      if (!cihazGecerli(g.cihaz)) return yanit(res, 400, { hata: 'Geçersiz cihaz.' });
      return yanit(res, 200, kimlik(g.cihaz));
    }

    if (islem === 'gonder') {
      const metin = temizle(g.metin);
      let ad, ton, c = 'yonetici';
      if (yonetici) { ad = 'Geliştirici'; ton = 220; }
      else {
        if (!cihazGecerli(g.cihaz)) return yanit(res, 400, { hata: 'Geçersiz cihaz.' });
        ({ ad, ton } = kimlik(g.cihaz)); c = hex(ozet('cihaz:' + g.cihaz));
        const sorun = metinSorunu(metin);
        if (sorun) return yanit(res, 400, { hata: sorun });
        const [s1, s2] = await redis([['SISMEMBER', K.sus, 'c:' + c], ['SISMEMBER', K.sus, 'i:' + ip]]);
        if (s1 || s2) return yanit(res, 403, { hata: 'Bu cihazdan mesaj gönderilemiyor.' });
        const [bekle] = await redis([['SET', K.hiz('ara', ip), 1, 'EX', 8, 'NX']]);
        if (bekle === null) return yanit(res, 429, { hata: 'Biraz yavaş: mesajlar arasında birkaç saniye bekleyin.' });
        if (await sinirAsildi('saat', ip, 30, 3600)) return yanit(res, 429, { hata: 'Bir saatte en fazla 30 mesaj gönderilebilir.' });
        const mOzet = hex(ozet('metin:' + sade(metin), 6));
        const [tekrar] = await redis([['SET', K.sonMetin(c), mOzet, 'EX', 120, 'GET']]);
        if (tekrar === mOzet) return yanit(res, 409, { hata: 'Aynı mesajı az önce gönderdiniz.' });
      }
      if (!metin) return yanit(res, 400, { hata: 'Mesaj boş.' });
      if (metin.length > (yonetici ? 2000 : MAKS_UZUNLUK)) return yanit(res, 400, { hata: 'Mesaj çok uzun.' });
      let yanitBilgi = {};
      const rid = parseInt(g.yanit, 10);
      if (rid > 0) {
        const asil = await mesajBul(rid);
        if (asil) { const x = JSON.parse(asil); if (!x.sil) yanitBilgi = { r: rid, ra: x.a, rm: alintiMetni(x.m) }; }
      }
      const id = await tek('INCR', K.seq);
      const kayit = Object.assign({ id, t: Date.now(), m: metin, a: ad, h: ton, g: yonetici, c, ip }, yanitBilgi);
      await redis([['ZADD', K.msj, id, JSON.stringify(kayit)], ['ZREMRANGEBYRANK', K.msj, 0, -(SAKLA + 1)]]);
      return yanit(res, 200, { mesaj: disaVer(JSON.stringify(kayit)) });
    }

    if (islem === 'duzenle' || islem === 'kendiSil') {
      const id = parseInt(g.id, 10);
      if (!id || !cihazGecerli(g.cihaz)) return yanit(res, 400, { hata: 'Geçersiz istek.' });
      if (await sinirAsildi('kendi', ip, 40, 3600)) return yanit(res, 429, { hata: 'Çok fazla işlem yaptınız, biraz sonra deneyin.' });
      const ham = await mesajBul(id);
      if (!ham) return yanit(res, 404, { hata: 'Mesaj bulunamadı.' });
      const x = JSON.parse(ham);
      if (x.g || x.c !== hex(ozet('cihaz:' + g.cihaz))) return yanit(res, 403, { hata: 'Yalnızca kendi mesajınızı değiştirebilirsiniz.' });
      if (x.sil) return yanit(res, 409, { hata: 'Bu mesaj zaten silinmiş.' });
      if (islem === 'kendiSil') {
        const y = Object.assign({}, x, { sil: true, m: '', st: Date.now() });
        delete y.r; delete y.ra; delete y.rm; delete y.rs;
        await mesajDegistir(ham, y);
        await alintilariGuncelle(id, '', true);
        return yanit(res, 200, { mesaj: disaVer(JSON.stringify(y)) });
      }
      if (Date.now() - x.t > DUZENLEME_SURESI) return yanit(res, 403, { hata: 'Mesajlar yalnızca gönderildikten sonraki 15 dakika içinde düzenlenebilir.' });
      const metin = temizle(g.metin);
      const sorun = metinSorunu(metin);
      if (sorun) return yanit(res, 400, { hata: sorun });
      if (metin === x.m) return yanit(res, 200, { mesaj: disaVer(ham) });
      const y = Object.assign({}, x, { m: metin, d: Date.now() });
      await mesajDegistir(ham, y);
      await alintilariGuncelle(id, metin, false);
      return yanit(res, 200, { mesaj: disaVer(JSON.stringify(y)) });
    }

    if (islem === 'bildir') {
      const id = parseInt(g.id, 10);
      if (!id) return yanit(res, 400, { hata: 'Geçersiz mesaj.' });
      if (await sinirAsildi('bildir', ip, 20, 3600)) return yanit(res, 429, { hata: 'Çok fazla bildirim yaptınız.' });
      const ham = await mesajBul(id);
      if (!ham) return yanit(res, 200, { tamam: true });
      if (JSON.parse(ham).g || JSON.parse(ham).sil) return yanit(res, 200, { tamam: true });
      const [, sayi] = await redis([['SADD', K.bildir(id), ip], ['SCARD', K.bildir(id)], ['EXPIRE', K.bildir(id), 2592000]]);
      if (sayi >= BILDIRIM_ESIGI) {
        await redis([['ZREMRANGEBYSCORE', K.msj, id, id], ['HSET', K.gizli, id, ham], ['INCR', K.deg]]);
        await alintilariGuncelle(id, '', true);
        return yanit(res, 200, { tamam: true, gizlendi: true });
      }
      return yanit(res, 200, { tamam: true });
    }

    /* ---------------- YÖNETİM ---------------- */
    if (!yonetici) return yanit(res, 401, { hata: 'Bu işlem için yönetici girişi gerekir.' });

    if (islem === 'giris') return yanit(res, 200, { tamam: true });

    if (islem === 'sil' || islem === 'sustur') {
      const id = parseInt(g.id, 10);
      const ham = await mesajBul(id) || await tek('HGET', K.gizli, id);
      if (!ham) return yanit(res, 404, { hata: 'Mesaj bulunamadı.' });
      const x = JSON.parse(ham);
      const k = [['ZREMRANGEBYSCORE', K.msj, id, id], ['HDEL', K.gizli, id], ['DEL', K.bildir(id)], ['INCR', K.deg]];
      if (islem === 'sustur' && !x.g) k.push(['SADD', K.sus, 'c:' + x.c, 'i:' + x.ip]);
      await redis(k);
      await alintilariGuncelle(id, '', true);
      return yanit(res, 200, { tamam: true });
    }
    if (islem === 'gizlenenler') {
      const h = await tek('HGETALL', K.gizli) || [];
      const l = [];
      for (let i = 0; i < h.length; i += 2) { const x = disaVer(h[i + 1]); if (x) l.push(x); }
      l.sort((a, b) => a.id - b.id);
      const susSayi = await tek('SCARD', K.sus);
      return yanit(res, 200, { mesajlar: l, susturulan: Math.ceil((+susSayi || 0) / 2) });
    }
    if (islem === 'geriAl') {
      const id = parseInt(g.id, 10);
      const ham = await tek('HGET', K.gizli, id);
      if (!ham) return yanit(res, 404, { hata: 'Mesaj bulunamadı.' });
      await redis([['ZADD', K.msj, id, ham], ['HDEL', K.gizli, id], ['DEL', K.bildir(id)], ['INCR', K.deg]]);
      await alintilariGuncelle(id, JSON.parse(ham).m, false);
      return yanit(res, 200, { tamam: true });
    }
    if (islem === 'susturmaKaldir') {
      await tek('DEL', K.sus);
      return yanit(res, 200, { tamam: true });
    }
    return yanit(res, 400, { hata: 'Bilinmeyen işlem.' });
  } catch (e) {
    return yanit(res, 500, { hata: 'Sohbet sunucusunda bir sorun oluştu. Biraz sonra tekrar deneyin.' });
  }
};
