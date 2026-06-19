// Slice 2b — WhatsApp template registry + rendering.
//
// Aarogya may only send free-form text inside the 24h customer-service window.
// Outside it, only pre-approved templates send. This registry holds the Day-1
// templates and renders their {{n}} body params in order, so call sites pass
// named vars and can't transpose positions.
//
// NOTE: Meta template APPROVAL is an operational workflow (out of Slice 2b
// scope). These definitions are code-ready so the moment approval lands, the
// sender works with no further code change.

import { createHash } from "node:crypto";

export interface TemplateDef {
  /** Approved template name registered in WhatsApp Manager. */
  name: string;
  /** BCP-47 language code the template was approved under. */
  language: string;
  /** Ordered names of the {{1}}..{{n}} BODY placeholders. */
  bodyVars: string[];
  /** True if the template carries quick-reply buttons (payload optional). */
  hasQuickReplies?: boolean;
  /** Human description for the registry / ops. */
  description: string;
}

export const TEMPLATES = {
  aarogya_reengagement_v1: {
    name: "aarogya_reengagement_v1",
    language: "en",
    bodyVars: ["first_name", "service_label"],
    hasQuickReplies: true,
    description:
      "Re-engage a user outside the 24h window: 'Hi {{1}}, this is Sanocare. We have an update on your {{2}} consult...' + quick replies.",
  },
  aarogya_booking_reminder_v1: {
    name: "aarogya_booking_reminder_v1",
    language: "en",
    bodyVars: ["date", "time"],
    hasQuickReplies: false,
    description:
      "Booking reminder: 'Reminder: your visit is scheduled for {{1}} at {{2}}. Reply YES to confirm.'",
  },
  // Slice 3 (T66) — medic-app event templates. Both APPROVED in Meta
  // Business Manager (verified 2026-06-18).
  aarogya_medic_departed: {
    name: "aarogya_medic_departed",
    language: "en",
    bodyVars: ["medic_first_name"],
    hasQuickReplies: false,
    description:
      "Medic en route: 'Your Sanocare medic {{1}} has left for your home and will arrive shortly.' Re-opens the 24h customer-service window.",
  },
  aarogya_medic_at_door: {
    name: "aarogya_medic_at_door",
    language: "en",
    bodyVars: ["medic_first_name", "medic_phone"],
    hasQuickReplies: false,
    description:
      "No-show recovery: 'Your Sanocare medic {{1}} is at your door. Please reply here or call {{2}}.' Sent when medic-app emits patient_no_show.",
  },
} as const satisfies Record<string, TemplateDef>;

export type TemplateName = keyof typeof TEMPLATES;

export interface RenderedTemplate {
  templateName: string;
  languageCode: string;
  /** Ordered {{1}}..{{n}} values for sendTemplateMessage. */
  bodyParams: string[];
  /** Optional quick-reply payload attached to button 0. */
  quickReplyPayload?: string;
  /** sha256 of the ordered vars — audited (never the raw PII vars). */
  varsHash: string;
}

export function isTemplateName(name: string): name is TemplateName {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, name);
}

/**
 * Resolve a template + named vars into the positional bodyParams the Cloud API
 * client needs. Throws if the template is unknown or a required var is missing
 * — a template send must never go out with an empty {{n}}.
 */
export function renderTemplate(
  templateName: TemplateName,
  vars: Record<string, string>,
  opts: { quickReplyPayload?: string } = {},
): RenderedTemplate {
  const def = TEMPLATES[templateName];
  if (!def) throw new Error(`Unknown template: ${templateName}`);

  const bodyParams = def.bodyVars.map((varName) => {
    const value = vars[varName];
    if (value === undefined || value === null || value === "") {
      throw new Error(
        `Template ${templateName} missing required var "${varName}"`,
      );
    }
    return String(value);
  });

  const varsHash = createHash("sha256")
    .update(bodyParams.join(""))
    .digest("hex");

  return {
    templateName: def.name,
    languageCode: def.language,
    bodyParams,
    quickReplyPayload: def.hasQuickReplies ? opts.quickReplyPayload : undefined,
    varsHash,
  };
}
