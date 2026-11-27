import type { Metadata } from "next";
import LegalPage, { type LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Gizlilik Politikası | 593 E-Marketing",
  description:
    "593 E-Marketing web sitesi ve müşteri paneli için kişisel verilerin işlenmesi, Google / YouTube ve Meta bağlantıları hakkında gizlilik politikası.",
  alternates: { canonical: "/gizlilik-politikasi" },
};

const sections: LegalSection[] = [
  {
    id: "kapsam",
    title: "Kapsam ve veri sorumlusu",
    body: (
      <>
        <p>
          Bu politika, <strong>593 E-Marketing</strong>{" "}(&ldquo;593&rdquo;, &ldquo;biz&rdquo;) tarafından işletilen
          593emarketing.com web sitesi ile müşterilerimize ve ekibimize sunduğumuz yönetim paneli (admin.593emarketing.com
          ve marka alt alan adları; &ldquo;Panel&rdquo;) için geçerlidir.
        </p>
        <p>
          6698 sayılı Kişisel Verilerin Korunması Kanunu (&ldquo;KVKK&rdquo;) kapsamında veri sorumlusu 593
          E-Marketing&apos;tir. Adres: Ömer Avni, İnebolu Sk. No:51, 34427 Beyoğlu/İstanbul · E-posta:{" "}
          <a href="mailto:info@593emarketing.com">info@593emarketing.com</a>
        </p>
      </>
    ),
  },
  {
    id: "toplanan-veriler",
    title: "Topladığımız veriler",
    body: (
      <ul>
        <li>
          <strong>İletişim ve başvuru bilgileri:</strong>{" "}İletişim formu, e-posta, WhatsApp veya kariyer başvurusu
          yoluyla ilettiğiniz ad, e-posta, telefon, şirket bilgisi ve mesaj içeriği.
        </li>
        <li>
          <strong>Panel hesabı bilgileri:</strong>{" "}Ad, e-posta, rol ve oturum bilgileri; panelde yapılan işlemlerin
          kayıtları (denetim günlüğü).
        </li>
        <li>
          <strong>Marka içerikleri:</strong>{" "}Paylaşım için panele yüklenen görsel, video, açıklama ve planlama
          bilgileri.
        </li>
        <li>
          <strong>Bağlı platform verileri:</strong>{" "}Markanın açıkça yetki verdiği reklam, analiz ve sosyal medya
          hesaplarına ait bilgiler (aşağıdaki bölümlerde ayrıntılı açıklanmıştır).
        </li>
        <li>
          <strong>Teknik veriler:</strong>{" "}Oturumu sürdürmek için gerekli çerezler, IP adresi ve tarayıcı bilgisi gibi
          sunucu kayıtları.
        </li>
      </ul>
    ),
  },
  {
    id: "google-youtube",
    title: "Google ve YouTube verileri",
    body: (
      <>
        <p>
          Panel, markaların YouTube kanallarına içerik yüklemek için <strong>YouTube API Hizmetlerini</strong>{" "}kullanır.
          Bir YouTube kanalını Panel&apos;e bağlayarak{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
            YouTube Hizmet Şartları
          </a>
          &apos;nı kabul etmiş olursunuz. Google&apos;ın verileri nasıl işlediği{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            Google Gizlilik Politikası
          </a>
          &apos;nda açıklanmıştır.
        </p>
        <p>Kanal bağlandığında Google hesabınızın izniyle şu verilere erişiriz:</p>
        <ul>
          <li>Kanal kimliği, kanal adı, kullanıcı adı ve profil görseli (hangi kanalın bağlı olduğunu göstermek için);</li>
          <li>
            Kanala video yükleme yetkisi (<em>youtube.upload</em>) — yalnızca Panel&apos;de planlanan ve marka adına
            paylaşılması onaylanan videoları yüklemek için;
          </li>
          <li>Yüklenen videonun kimliği ve bağlantısı (paylaşım durumunu göstermek için);</li>
          <li>
            Video silme yetkisi (<em>youtube.force-ssl</em>) — yalnızca Panel&apos;den yüklenmiş bir video için yetkili
            kullanıcı Panel&apos;de açıkça &ldquo;Sil&rdquo; komutunu verdiğinde o videoyu kanaldan kaldırmak için.
          </li>
        </ul>
        <p>
          Kanalınızdaki diğer videoları, yorumları, abonelerinizi veya özel verilerinizi okumayız; Panel dışında
          yüklenmiş videolarınızı silmeyiz veya değiştirmeyiz.
        </p>
        <p>
          Google&apos;dan aldığımız erişim ve yenileme anahtarları (token) veritabanımızda şifrelenmiş olarak saklanır,
          yalnızca yukarıdaki amaçla kullanılır ve üçüncü kişilerle paylaşılmaz, satılmaz; reklam veya yapay zekâ
          modeli eğitimi amacıyla kullanılmaz. 593&apos;ün Google API&apos;lerinden alınan bilgileri kullanması ve
          başka uygulamalara aktarması,{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Hizmetleri Kullanıcı Verileri Politikası
          </a>
          &apos;na, Sınırlı Kullanım (Limited Use) koşulları dahil olmak üzere uygundur.
        </p>
        <p>
          <strong>Erişimi geri alma:</strong>{" "}Kanal bağlantısını Panel&apos;deki marka sayfasından &ldquo;Bağlantıyı
          kaldır&rdquo; ile sonlandırabilirsiniz; bu işlem Google&apos;daki izni de geri alır ve saklanan anahtarlar
          silinir. İzni dilediğiniz zaman doğrudan Google hesabınızın{" "}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            güvenlik ayarlarından
          </a>{" "}
          da kaldırabilirsiniz.
        </p>
        <p>
          Ajans olarak markalarımızın Google Ads, Google Analytics, Search Console ve Tag Manager hesaplarına
          raporlama ve yönetim amacıyla, markanın bize verdiği yetki kapsamında erişiriz.
        </p>
      </>
    ),
  },
  {
    id: "meta",
    title: "Meta (Facebook ve Instagram) verileri",
    body: (
      <p>
        Markaların Facebook sayfası ve Instagram profesyonel hesabına, markanın Meta İşletme Yöneticisi üzerinden
        ajansımıza verdiği yetkiyle erişiriz. Bu erişim; onaylanan gönderileri paylaşmak, sayfa ve reklam
        performansını raporlamak için kullanılır. Yetki, markanın İşletme Yöneticisi ayarlarından her zaman geri
        alınabilir.
      </p>
    ),
  },
  {
    id: "kullanim-amaclari",
    title: "Verileri hangi amaçlarla kullanırız",
    body: (
      <ul>
        <li>Talep ve başvurularınıza yanıt vermek, teklif ve sözleşme süreçlerini yürütmek;</li>
        <li>Panel hesabınızı oluşturmak, oturumunuzu güvenli şekilde sürdürmek;</li>
        <li>Markanın onayladığı içerikleri planlanan zamanda ilgili platformlarda paylaşmak;</li>
        <li>Reklam ve analiz performansını raporlamak, ekiple paylaşmak;</li>
        <li>Hizmet güvenliğini sağlamak, hataları tespit etmek ve yasal yükümlülükleri yerine getirmek.</li>
      </ul>
    ),
  },
  {
    id: "paylasim",
    title: "Verilerin paylaşılması",
    body: (
      <>
        <p>Kişisel verilerinizi satmayız. Veriler yalnızca hizmetin gerektirdiği ölçüde şu taraflarla paylaşılır:</p>
        <ul>
          <li>
            İçeriğin paylaşıldığı platformlar (YouTube, Instagram, Facebook) — yalnızca paylaşımı yapmak için
            gönderilen içerik;
          </li>
          <li>
            Altyapı hizmet sağlayıcılarımız (sunucu barındırma, Amazon Web Services üzerinde dosya depolama, e-posta) —
            sözleşmeyle bağlı ve yalnızca hizmet sunmak için;
          </li>
          <li>Yasal olarak yetkili kurum ve kuruluşlar — mevzuatın gerektirdiği hâllerde.</li>
        </ul>
        <p>
          Bu hizmet sağlayıcıların bir kısmının sunucuları yurt dışında bulunduğundan, veriler KVKK&apos;nın yurt
          dışına aktarıma ilişkin hükümlerine uygun şekilde aktarılabilir.
        </p>
      </>
    ),
  },
  {
    id: "saklama-guvenlik",
    title: "Saklama süresi ve güvenlik",
    body: (
      <>
        <p>
          Verileri, işleme amacının gerektirdiği süre ve yasal saklama süreleri boyunca tutarız. Bağlantısı kaldırılan
          platform hesaplarının erişim anahtarları derhâl silinir. Panel hesabı kapatılan kullanıcıların verileri,
          yasal yükümlülükler saklı kalmak üzere silinir veya anonim hâle getirilir.
        </p>
        <p>
          Veriler şifreli bağlantı (HTTPS) üzerinden iletilir; platform erişim anahtarları şifrelenmiş olarak saklanır;
          Panel&apos;e erişim rol bazlı yetkilendirmeyle sınırlandırılır.
        </p>
      </>
    ),
  },
  {
    id: "cerezler",
    title: "Çerezler",
    body: (
      <p>
        Panel, oturumunuzu açık tutmak ve güvenli giriş için zorunlu çerezler kullanır. Web sitesinde ziyaret
        istatistiklerini anlamak için analiz araçları kullanılabilir; tarayıcı ayarlarınızdan çerezleri dilediğiniz
        zaman silebilir veya engelleyebilirsiniz.
      </p>
    ),
  },
  {
    id: "haklariniz",
    title: "Haklarınız",
    body: (
      <>
        <p>KVKK&apos;nın 11. maddesi uyarınca; kişisel verilerinizin</p>
        <ul>
          <li>işlenip işlenmediğini öğrenme ve işlenmişse bilgi talep etme,</li>
          <li>işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,</li>
          <li>aktarıldığı üçüncü kişileri bilme,</li>
          <li>eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini isteme,</li>
          <li>otomatik sistemlerle analiz edilmesi sonucu aleyhinize bir sonuca itiraz etme,</li>
          <li>kanuna aykırı işlenmesi sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep etme</li>
        </ul>
        <p>
          haklarına sahipsiniz. Taleplerinizi <a href="mailto:info@593emarketing.com">info@593emarketing.com</a>{" "}
          adresine iletebilirsiniz; en geç 30 gün içinde yanıtlarız.
        </p>
      </>
    ),
  },
  {
    id: "degisiklikler",
    title: "Değişiklikler ve iletişim",
    body: (
      <p>
        Bu politikayı gerektiğinde güncelleyebiliriz; güncel sürüm her zaman bu sayfada yayımlanır ve üstteki
        &ldquo;Son güncelleme&rdquo; tarihi değişir. Sorularınız için{" "}
        <a href="mailto:info@593emarketing.com">info@593emarketing.com</a>{" "}adresinden bize ulaşabilirsiniz.
      </p>
    ),
  },
];

export default function GizlilikPolitikasiPage() {
  return (
    <LegalPage
      title="Gizlilik Politikası"
      updated="27 Kasım 2026"
      intro={
        <p>
          Kişisel verilerinizi ve markalarımızın bize emanet ettiği hesap erişimlerini yalnızca hizmeti sunmak için,
          gerektiği kadar ve güvenli şekilde kullanırız. Bu sayfa hangi verileri neden işlediğimizi ve haklarınızı
          açıklar.
        </p>
      }
      sections={sections}
      related={{ label: "Kullanım Şartları", href: "/kullanim-sartlari" }}
    />
  );
}
