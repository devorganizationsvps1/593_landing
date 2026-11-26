import PanelOrbLoader from "@/components/panel/PanelOrbLoader";

/** Instant feedback while the next panel page RSC stream resolves. */
export default function PanelLoading() {
  return (
    <PanelOrbLoader
      title="Sayfa yükleniyor"
      detail="Veriler hazırlanıyor, menüden ayrılmana gerek yok."
    />
  );
}
