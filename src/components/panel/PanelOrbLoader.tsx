"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { LOGO_ORB_URL } from "@/components/logoOrbAsset";

/** Dalgalanan 3B logo — yalnızca istemcide (three.js). */
const LogoOrb = dynamic(() => import("@/components/LogoOrb"), {
  ssr: false,
  loading: () => null,
});

/**
 * Sayfa yükleyicisi: içerik alanının ortasında, arka plansız; nefes alan
 * dalgalı orb logo ve altında "yükleniyor" ibaresi.
 */
export default function PanelOrbLoader({
  title = "Yükleniyor",
  detail,
}: {
  title?: string;
  detail?: string;
}) {
  // Orb'un ilk karesi gelene kadar aynı yerde statik logo durur; sonra orb
  // yumuşakça üstüne geçer — arada boşluk olmaz.
  const [orbReady, setOrbReady] = useState(false);

  return (
    <div
      className="flex min-h-[calc(100dvh-var(--panel-header-h)-6rem)] flex-col items-center justify-center text-center"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="orb-breathe relative size-32 sm:size-36" aria-hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGO_ORB_URL}
          alt=""
          fetchPriority="high"
          className={`absolute inset-0 size-full scale-[0.88] object-contain transition-opacity duration-300 ${
            orbReady ? "opacity-0" : "opacity-100"
          }`}
        />
        <div
          className={`absolute inset-0 transition-opacity duration-300 ${
            orbReady ? "opacity-100" : "opacity-0"
          }`}
        >
          <LogoOrb onReady={() => setOrbReady(true)} />
        </div>
      </div>
      <p className="mt-5 text-base font-semibold tracking-tight text-zinc-900">
        {title}
        <span className="ml-0.5 inline-flex gap-0.5 text-[#e63b22]" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="loader-dot"
              style={{ animationDelay: `${i * 0.15}s` }}
            >
              .
            </span>
          ))}
        </span>
      </p>
      {detail ? (
        <p className="mt-1 max-w-xs text-xs leading-5 text-zinc-500">{detail}</p>
      ) : null}
    </div>
  );
}
