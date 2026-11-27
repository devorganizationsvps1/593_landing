import Link from "next/link";
import type { ReactNode } from "react";
import CursorDot from "./CursorDot";
import SiteHeader from "./SiteHeader";
import SiteFooter from "./SiteFooter";

export type LegalSection = { id: string; title: string; body: ReactNode };

/** Gizlilik politikası / kullanım şartları gibi uzun metin sayfaları. */
export default function LegalPage({
  title,
  intro,
  updated,
  sections,
  related,
}: {
  title: string;
  intro: ReactNode;
  /** Örn. "27 Kasım 2026" */
  updated: string;
  sections: LegalSection[];
  related: { label: string; href: string };
}) {
  return (
    <main className="relative min-h-screen bg-[#141111] text-[#f4f1ea]">
      <CursorDot />
      <div aria-hidden className="pointer-events-none fixed inset-0">
        <div className="absolute inset-0 bg-[#141111]" />
        <div className="absolute left-[-20%] top-[30%] h-[90vh] w-[80vw] rounded-full bg-[radial-gradient(circle_at_center,rgba(233,24,37,0.12)_0%,rgba(233,24,37,0.04)_40%,transparent_72%)] blur-[80px]" />
      </div>

      <SiteHeader />

      <section className="relative z-10">
        <div className="page-x mx-auto max-w-7xl pt-10 pb-24 sm:pt-14 sm:pb-32 lg:pt-16">
          <div className="max-w-3xl">
            <p className="font-logo text-[clamp(1rem,2vw,1.25rem)] font-bold tracking-[-0.02em] text-[#f4f1ea]/80">
              593 E-MARKETİNG
            </p>
            <h1 className="mt-5 font-display text-[clamp(2.4rem,6.5vw,4.25rem)] font-bold leading-[0.95] tracking-[-0.055em]">
              {title}
            </h1>
            <p className="mt-6 text-[13px] text-white/40">Son güncelleme: {updated}</p>
            <div className="mt-8 text-[16px] leading-8 text-white/60 sm:text-[17px]">{intro}</div>
          </div>

          <div className="mt-14 grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-16">
            <nav aria-label="İçindekiler" className="hidden lg:block">
              <ol className="sticky top-28 space-y-2.5 text-[13px] text-white/45">
                {sections.map((s, i) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`} className="transition hover:text-[#f4f1ea]">
                      {i + 1}. {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="max-w-3xl space-y-12">
              {sections.map((s, i) => (
                <section key={s.id} id={s.id} className="scroll-mt-28 border-t border-white/10 pt-8">
                  <h2 className="font-display text-[clamp(1.3rem,2.6vw,1.65rem)] font-bold leading-[1.15] tracking-[-0.035em]">
                    {i + 1}. {s.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-7 text-white/60 sm:text-[16px] sm:leading-8 [&_a]:text-[#f4f1ea] [&_a]:underline [&_a]:decoration-white/30 [&_a]:underline-offset-4 [&_a:hover]:decoration-[#e91825] [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-[#f4f1ea]/85 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                    {s.body}
                  </div>
                </section>
              ))}

              <p className="border-t border-white/10 pt-8 text-[14px] text-white/45">
                İlgili:{" "}
                <Link href={related.href} className="text-[#f4f1ea] underline decoration-white/30 underline-offset-4 hover:decoration-[#e91825]">
                  {related.label}
                </Link>
              </p>
            </div>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
