import type { Metadata } from "next";
import Link from "next/link";
import LegalPage, { type LegalSection } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Kullanım Şartları | 593 E-Marketing",
  description: "593 E-Marketing web sitesi ve müşteri paneli kullanım şartları.",
  alternates: { canonical: "/kullanim-sartlari" },
};

const sections: LegalSection[] = [
  {
    id: "taraflar",
    title: "Taraflar ve kapsam",
    body: (
      <p>
        Bu şartlar, <strong>593 E-Marketing</strong>{" "}(&ldquo;593&rdquo;) tarafından işletilen 593emarketing.com web
        sitesi ile müşterilerimize ve ekibimize sunulan yönetim panelinin (&ldquo;Panel&rdquo;) kullanımını düzenler.
        Siteyi veya Panel&apos;i kullanarak bu şartları kabul etmiş olursunuz. Müşterilerimizle aramızdaki hizmet
        sözleşmesinde farklı bir hüküm varsa o hüküm uygulanır.
      </p>
    ),
  },
  {
    id: "hizmet",
    title: "Hizmetin tanımı",
    body: (
      <p>
        Panel; markaların içerik takvimini planlamak, içerikleri onaylamak, onaylanan içerikleri bağlı sosyal medya
        hesaplarında (YouTube, Instagram, Facebook) paylaşmak ve reklam / analiz performansını raporlamak için
        kullanılan bir ajans yönetim aracıdır. Panel&apos;e erişim yalnızca 593 tarafından hesap açılan kişilere
        verilir.
      </p>
    ),
  },
  {
    id: "hesaplar",
    title: "Hesaplar ve güvenlik",
    body: (
      <ul>
        <li>Giriş bilgilerinizi gizli tutmak ve hesabınızla yapılan işlemlerden sorumlu olmak size aittir.</li>
        <li>Yetkisiz bir kullanım fark ederseniz bize derhâl bildirmelisiniz.</li>
        <li>
          593, güvenlik veya sözleşme ihlali şüphesinde bir hesabın erişimini geçici ya da kalıcı olarak
          kısıtlayabilir.
        </li>
      </ul>
    ),
  },
  {
    id: "platformlar",
    title: "Bağlı platform hesapları",
    body: (
      <>
        <p>
          Bir sosyal medya hesabını Panel&apos;e bağlayan kişi, o hesap adına içerik paylaşma yetkisine sahip olduğunu
          beyan eder. Paylaşımlar, ilgili platformun kendi kurallarına tabidir:
        </p>
        <ul>
          <li>
            YouTube&apos;a içerik yükleyen kullanıcılar{" "}
            <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
              YouTube Hizmet Şartları
            </a>
            &apos;nı kabul etmiş sayılır; Google&apos;ın veri işleme esasları{" "}
            <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
              Google Gizlilik Politikası
            </a>
            &apos;nda yer alır.
          </li>
          <li>
            Instagram ve Facebook paylaşımları{" "}
            <a href="https://www.facebook.com/terms" target="_blank" rel="noopener noreferrer">
              Meta Hizmet Şartları
            </a>
            &apos;na tabidir.
          </li>
        </ul>
        <p>
          Bağlantı dilediğiniz zaman Panel&apos;den kaldırılabilir. Bağlı hesaplara ait verilerin nasıl işlendiği{" "}
          <Link href="/gizlilik-politikasi">Gizlilik Politikası</Link>&apos;nda açıklanmıştır.
        </p>
      </>
    ),
  },
  {
    id: "icerik",
    title: "İçerik ve sorumluluk",
    body: (
      <ul>
        <li>
          Panel&apos;e yüklenen görsel, video ve metinlerin hak sahibi markadır; marka, bu içerikleri paylaşmak için
          gerekli tüm hak ve izinlere sahip olduğunu kabul eder.
        </li>
        <li>
          Otomatik paylaşım yalnızca &ldquo;Onaylandı&rdquo; durumundaki içerikler için çalışır; içeriğin onaylanması
          marka adına paylaşım talimatı sayılır.
        </li>
        <li>
          Hukuka, platform kurallarına veya üçüncü kişi haklarına aykırı içerik yüklenemez. 593 bu tür içerikleri
          paylaşmayı reddedebilir.
        </li>
      </ul>
    ),
  },
  {
    id: "sorumluluk-siniri",
    title: "Hizmetin sürekliliği ve sorumluluğun sınırı",
    body: (
      <p>
        Panel&apos;in kesintisiz çalışması için makul özeni gösteririz; ancak üçüncü taraf platformların (YouTube, Meta
        vb.) erişim kısıtlamaları, kota sınırları, kural değişiklikleri veya teknik arızaları nedeniyle bir paylaşımın
        gecikmesi ya da yapılamamasından doğan dolaylı zararlardan sorumlu değiliz. Başarısız paylaşımlar Panel&apos;de
        bildirilir ve yeniden denenebilir.
      </p>
    ),
  },
  {
    id: "fikri-mulkiyet",
    title: "Fikri mülkiyet",
    body: (
      <p>
        Web sitesi ve Panel&apos;in tasarımı, yazılımı ve 593&apos;e ait içerikler 593 E-Marketing&apos;e aittir; izinsiz
        kopyalanamaz veya çoğaltılamaz. Markalara ait içerik ve logoların hakları ilgili markada kalır.
      </p>
    ),
  },
  {
    id: "degisiklik-hukuk",
    title: "Değişiklikler, uygulanacak hukuk ve iletişim",
    body: (
      <p>
        Bu şartları gerektiğinde güncelleyebiliriz; güncel sürüm bu sayfada yayımlanır. Bu şartlar Türkiye Cumhuriyeti
        hukukuna tabidir; uyuşmazlıklarda İstanbul mahkemeleri ve icra daireleri yetkilidir. Sorularınız için{" "}
        <a href="mailto:info@593emarketing.com">info@593emarketing.com</a>{" "}· Ömer Avni, İnebolu Sk. No:51, 34427
        Beyoğlu/İstanbul.
      </p>
    ),
  },
];

export default function KullanimSartlariPage() {
  return (
    <LegalPage
      title="Kullanım Şartları"
      updated="27 Kasım 2026"
      intro={
        <p>
          593 E-Marketing web sitesini ve müşteri panelini kullanırken geçerli olan kurallar. Kısaca: hesabınızı
          güvende tutun, yalnızca hakkına sahip olduğunuz içerikleri paylaşın; biz de içeriklerinizi yalnızca
          onayladığınız şekilde yayımlayalım.
        </p>
      }
      sections={sections}
      related={{ label: "Gizlilik Politikası", href: "/gizlilik-politikasi" }}
    />
  );
}
