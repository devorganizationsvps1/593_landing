"use client";

import dynamic from "next/dynamic";

/** Three.js yüklenene kadar aynı yerde duran statik logo — kutu boş kalmasın. */
function OrbFallback() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo-orb.png"
      alt=""
      className="size-full scale-[0.88] animate-pulse object-contain"
    />
  );
}

/** Dalgalanan 3B logo — yalnızca istemcide (three.js). */
const LogoOrb = dynamic(() => import("@/components/LogoOrb"), {
  ssr: false,
  loading: OrbFallback,
});

/**
 * Sayfa yükleyicisi: içerik alanının ortasında beyaz yuvarlak bir zemin, içinde yalnızca
 * dalgalanan orb logo ve "yükleniyor" ibaresi.
 */
export default function PanelOrbLoader({
  title = "Yükleniyor",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  return (
    <div
      className="flex min-h-[calc(100dvh-var(--panel-header-h)-6rem)] items-center justify-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="flex aspect-square w-[19rem] flex-col items-center justify-center rounded-full border border-zinc-200 bg-white px-10 text-center shadow-sm sm:w-[22rem]">
        <div className="size-36 sm:size-44" aria-hidden>
          <LogoOrb />
        </div>
        <p className="mt-4 text-sm font-semibold text-zinc-900">
          {title}
          <span className="animate-pulse">…</span>
        </p>
        {detail ? (
          <p className="mt-1.5 max-w-[15rem] text-xs leading-5 text-zinc-500">{detail}</p>
        ) : null}
      </div>
    </div>
  );
}
