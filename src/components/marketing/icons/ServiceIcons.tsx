// T85 service icon registry. The catalog.ts holds the `iconKey`
// reference; this module resolves each key to a lucide-react component.
// Separated so a future swap to a custom icon set (e.g. the mockup's
// hand-tuned line icons) is a single-file change.
//
// Stroke + size are tuned to match the mockup's `.sec-icon svg` rules:
//   width / height = 28×28 inside a 56×56 wrapper, stroke-width 1.8.
// ServiceSection applies the dimensions via Tailwind classes; this
// module only owns the component identity.

import { Home, Video, FlaskConical, Syringe } from "lucide-react";
import type { ServiceIconKey, ServiceIconMap } from "@/lib/services/catalog";

export const serviceIconMap: ServiceIconMap = {
  home: Home,
  video: Video,
  flask: FlaskConical,
  syringe: Syringe,
};

/** Convenience accessor — typed to never return undefined for known keys. */
export function getServiceIcon(key: ServiceIconKey) {
  return serviceIconMap[key];
}
