import PanelOrbLoader from "@/components/panel/PanelOrbLoader";

export default function GtmLoading() {
  return (
    <PanelOrbLoader
      title="GTM config yükleniyor"
      detail="Google Tag Manager API yanıt verene kadar bekleniyor. Kota (429) aşımında 1–2 dakika sonra yenileyin."
    />
  );
}
