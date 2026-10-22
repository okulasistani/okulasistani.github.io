# Okul Asistanı — Güncelleme ve Uygulama Ekleme Rehberi

## Mevcut bir uygulamayı güncellemek
1. Yeni sürüm dosyasının adını **tam olarak** eskisiyle aynı yapın (`idare.html`, `ogretmen.html`).
2. `github.com/okulasistani/okulasistani.github.io/upload/main` → dosyayı seçin → **"Doğrudan taahhütte bulunun ana dal"** → kaydedin.
3. Netlify kendiliğinden güncellenir. Yeni modüller, sekmeler, kategoriler ve sürüm numarası sitede **otomatik** görünür.

> İdare Asistanı'na yeni modül eklerken onu **site haritasındaki** (`HARITA_KATEGORILERI`) kategorisine de ekleyin. Unutulursa modül yine görünür, "Diğer" başlığı altına düşer.

## Yeni bir uygulama eklemek
1. Uygulama dosyasını (ör. `sinav.html`) repoya yükleyin.
2. GitHub'da `uygulamalar.json` dosyasını açın → kalem (✏️) simgesi → listeye bir kayıt ekleyin → kaydedin:

```json
  {
    "id": "sinav",
    "ad": "Sınav Asistanı",
    "kisaAd": "Sınav",
    "dosya": "sinav.html",
    "ico": "📝",
    "renk": "#b0722a",
    "aciklama": "Ortak sınav takvimi, salon listeleri ve tutanaklar"
  }
```

- `id`: yalnızca harf, rakam, `-`, `_` (adreste görünür: `#/sinav`)
- `renk`: kartların ve başlığın rengi (#RRGGBB)
- Kayıtlar arasına virgül koymayı unutmayın; son kaydın sonunda virgül olmaz.

Üst menü, ana sayfa kartı, kategori sayfası ve arama kendiliğinden oluşur. **index.html değişmez.**

## Yeni uygulamanın modüllerinin sitede görünmesi (isteğe bağlı)
Uygulamanın HTML dosyasına şu iki parça eklenir. Eklenmezse uygulama sitede yine görünür; yalnızca modül kartları yerine "Uygulamayı aç" düğmesi çıkar.

**1) Modül listesi** (`<head>` içine):
```html
<script type="application/json" id="okul-asistani-katalog">
{"kategoriler":[
  {"ad":"Sınav İşleri","ico":"📝","moduller":[
    {"id":"sinavTakvimi","ad":"Sınav Takvimi","ico":"🗓️","acik":"Ortak sınav takvimini hazırlar."},
    {"id":"salonListesi","ad":"Salon Oturma Listesi","acik":"Salon bazlı öğrenci listesi.","alt":["Kapı listesi","İmza listesi"]}
  ]}
]}
</script>
```

**2) Modül açma fonksiyonu** (uygulamanın kendi kodunda):
```js
window.oaModulAc = function (id) { /* id'si verilen modülü aç */ };
```

## Bilinmesi gerekenler
- Kullanıcı verileri her kişinin kendi cihazında saklanır; siteye/GitHub'a gitmez.
- Site her açılışta uygulama dosyalarını hafif bir kontrolle (HEAD isteği) yoklar; dosya değişmediyse yeniden indirmez.
- `uygulamalar.json` silinir veya bozulursa site, içine kayıtlı İdare ve Öğretmen asistanlarıyla çalışmaya devam eder.
