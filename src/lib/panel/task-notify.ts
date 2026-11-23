/**
 * Görev ataması bildirimi — durum panosunda bir karta yeni atanan kişiye
 * WhatsApp (onaylı şablon) gider. Uyarılarla aynı ana anahtar geçerli
 * (/bildirimler → WhatsApp kanalı). Kendine atama bildirilmez.
 *
 * Şablon: `${WHATSAPP_TEMPLATE_PREFIX}gorev` (vars. `uyari_gorev`), UTILITY, tr.
 * Gövde parametreleri sırasıyla: görev, açıklama, marka, son tarih, öncelik, atayan.
 * URL butonu: https://admin.593emarketing.com/board?card={{1}} (kart id).
 * Bkz. docs/whatsapp-templates.md.
 */
import { prisma } from "@/lib/db";
import { whatsappEnabled } from "@/lib/panel/notification-settings";
import {
  normalizePhone,
  sendWhatsAppTemplate,
  templateName,
  whatsappConfigured,
} from "@/lib/panel/notify";

const PRIORITY_TR: Record<string, string> = {
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
};

export function taskTemplateName(): string {
  return templateName("gorev");
}

/** Göreve bağlantı eklendi şablonu: `${WHATSAPP_TEMPLATE_PREFIX}gorev_baglanti`. */
export function taskLinkTemplateName(): string {
  return templateName("gorev_baglanti");
}

const LINK_RE = /https?:\/\/[^\s<>"'()]+/gi;

/** Metindeki http(s) bağlantıları (sondaki noktalama hariç, tekrarsız). */
export function extractTaskLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const plain = text.replace(/\{\/?(red|orange|green|blue|purple)\}|\*\*/g, " ");
  const found = (plain.match(LINK_RE) ?? []).map((u) => u.replace(/[.,;:!?*]+$/, ""));
  return [...new Set(found)];
}

/**
 * Açıklamaya yeni bağlantı eklenince (tasarım / video hazır vb.) karta atanmış
 * diğer kişilere WhatsApp. Ekleyen kişi ve bu istekte yeni atananlar (onlara
 * zaten atama bildirimi gider) hariç. Hiçbir zaman fırlatmaz.
 *
 * Şablon gövdesi: görev, eklenen bağlantı(lar), marka, ekleyen.
 * URL butonu `uyari_gorev` ile aynı: /board?card={{1}}.
 */
export async function notifyTaskLinkAdded(opts: {
  cardId: string;
  links: string[];
  actorId: string | null;
  skipUserIds?: string[];
}): Promise<void> {
  try {
    if (opts.links.length === 0) return;
    if (!whatsappConfigured() || !(await whatsappEnabled())) return;

    const skip = new Set([...(opts.skipUserIds ?? []), opts.actorId ?? ""]);
    const [card, actor] = await Promise.all([
      prisma.boardCard.findUnique({
        where: { id: opts.cardId },
        select: {
          id: true,
          title: true,
          tenantId: true,
          tenant: { select: { name: true } },
          team: { select: { name: true } },
          assignees: {
            select: {
              user: { select: { id: true, name: true, email: true, phone: true, role: true } },
            },
          },
        },
      }),
      opts.actorId
        ? prisma.user.findUnique({
            where: { id: opts.actorId },
            select: { name: true, email: true },
          })
        : null,
    ]);
    if (!card) return;

    const users = card.assignees
      .map((a) => a.user)
      .filter((u) => !skip.has(u.id) && (u.role === "admin" || u.role === "team"));
    if (users.length === 0) return;

    const template = taskLinkTemplateName();
    const linkText =
      opts.links.length === 1
        ? opts.links[0]
        : `${opts.links[0]} (+${opts.links.length - 1} bağlantı daha)`;
    const params = [
      card.title,
      linkText,
      card.tenant?.name ?? card.team?.name ?? "Genel",
      actor ? actor.name || actor.email : "593 Panel",
    ];
    const note = `Göreve bağlantı eklendi: ${card.title}`.slice(0, 300);
    await sendToUsers({ users, template, params, buttonParam: card.id, tenantId: card.tenantId, note });
  } catch (err) {
    console.error("[notify] task-link", opts.cardId, err);
  }
}

/** Her kullanıcıya şablonu gönderir, sonucu NotificationLog'a yazar. */
async function sendToUsers(opts: {
  users: Array<{ name: string | null; email: string; phone: string | null }>;
  template: string;
  params: string[];
  buttonParam: string;
  tenantId: string | null;
  note: string;
}): Promise<void> {
  const { template, params, tenantId, note } = opts;
  for (const u of opts.users) {
    const phone = normalizePhone(u.phone);
    if (!phone) {
      await prisma.notificationLog.create({
        data: {
          tenantId,
          channel: "none",
          recipient: u.name || u.email,
          template,
          status: "skipped",
          error: `${note} — kullanıcının telefonu yok`,
        },
      });
      continue;
    }
    try {
      await sendWhatsAppTemplate({
        to: phone,
        template,
        bodyParams: params,
        buttonParam: opts.buttonParam,
      });
      await prisma.notificationLog.create({
        data: { tenantId, channel: "whatsapp", recipient: phone, template, status: "sent", error: note },
      });
    } catch (err) {
      await prisma.notificationLog.create({
        data: {
          tenantId,
          channel: "whatsapp",
          recipient: phone,
          template,
          status: "failed",
          error: `${note} — ${err instanceof Error ? err.message : String(err)}`.slice(0, 1000),
        },
      });
    }
  }
}

/** Açıklama tek satıra iner (şablon parametresi satır sonu kabul etmez). */
function plainDescription(text: string | null): string {
  const t = (text ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\{\/?(red|orange|green|blue|purple)\}/g, "")
    .replace(/[*_`#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return "Açıklama eklenmedi";
  return t.length > 280 ? `${t.slice(0, 279)}…` : t;
}

function dueTr(d: Date | null): string {
  if (!d) return "Belirtilmedi";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
}

/**
 * Yeni atananlara bildirim. Hiçbir zaman fırlatmaz; sonuç NotificationLog'a
 * yazılır. Yanıtı geciktirmemesi için `after()` içinde çağırın.
 */
export async function notifyTaskAssigned(opts: {
  cardId: string;
  userIds: string[];
  actorId: string | null;
}): Promise<void> {
  try {
    const ids = [...new Set(opts.userIds)].filter((id) => id && id !== opts.actorId);
    if (ids.length === 0) return;
    if (!whatsappConfigured() || !(await whatsappEnabled())) return;

    const [card, users, actor] = await Promise.all([
      prisma.boardCard.findUnique({
        where: { id: opts.cardId },
        select: {
          id: true,
          title: true,
          description: true,
          dueAt: true,
          priority: true,
          tenantId: true,
          tenant: { select: { name: true } },
          team: { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        where: { id: { in: ids }, role: { in: ["admin", "team"] } },
        select: { id: true, name: true, email: true, phone: true },
      }),
      opts.actorId
        ? prisma.user.findUnique({
            where: { id: opts.actorId },
            select: { name: true, email: true },
          })
        : null,
    ]);
    if (!card) return;

    const template = taskTemplateName();
    const brand = card.tenant?.name ?? card.team?.name ?? "Genel";
    const actorName = actor ? actor.name || actor.email : "593 Panel";
    const params = [
      card.title,
      plainDescription(card.description),
      brand,
      dueTr(card.dueAt),
      PRIORITY_TR[card.priority] ?? card.priority,
      actorName,
    ];
    const note = `Görev ataması: ${card.title}`.slice(0, 300);

    await sendToUsers({ users, template, params, buttonParam: card.id, tenantId: card.tenantId, note });
  } catch (err) {
    console.error("[notify] task", opts.cardId, err);
  }
}
