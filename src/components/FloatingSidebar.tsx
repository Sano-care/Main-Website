"use client";

import { motion } from "framer-motion";
import { useCmsSection } from "@/hooks/useCmsSection";
import { SHARED_CONTENT } from "@/constants/cms-content";
import { isReactComponent } from "@/services/cms/snapshot";

export function FloatingSidebar() {
  const defaultSidebarIcon = SHARED_CONTENT.floatingSidebar.buttons[0].icon;
  const { data: floatingSidebarCopy } = useCmsSection(
    "shared",
    "floating_sidebar",
    SHARED_CONTENT.floatingSidebar,
  );
  // lucide-react icons are forwardRef components — `typeof` is "object", not
  // "function". Use `isReactComponent` (handles forwardRef/memo/lazy) so a
  // genuine component is kept, but a CMS-serialised `{}` falls through to the
  // position-aware constant.
  const sidebarButtons = floatingSidebarCopy.buttons.map((item, index) => ({
    ...item,
    icon: isReactComponent(item.icon)
      ? item.icon
      : (SHARED_CONTENT.floatingSidebar.buttons[index]?.icon ?? defaultSidebarIcon),
  }));
  const portalButton = {
    ...floatingSidebarCopy.portal,
    icon: isReactComponent(floatingSidebarCopy.portal.icon)
      ? floatingSidebarCopy.portal.icon
      : SHARED_CONTENT.floatingSidebar.portal.icon,
  };

  return (
    <aside className="fixed right-0 top-1/2 z-50 -translate-y-1/2 transform hidden lg:flex flex-col gap-3 p-3 bg-surface-light/80 backdrop-blur-md rounded-l-2xl shadow-xl border-y border-l border-white/50">
      {sidebarButtons.map((item, index) => {
        const Icon = item.icon;
        return (
          <motion.a
            key={item.label}
            href={item.href}
            className="group relative flex flex-col items-center justify-center p-2 rounded-xl hover:bg-primary/10 transition-colors"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + index * 0.1 }}
          >
            <Icon className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />
            <span className="absolute right-full mr-4 px-2 py-1 bg-text-main text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
              {item.label}
            </span>
          </motion.a>
        );
      })}
      
      <div className="h-px w-8 bg-slate-200 mx-auto" />
      
      <motion.a
        href={portalButton.href}
        className="group relative flex flex-col items-center justify-center p-2 rounded-xl hover:bg-primary/10 transition-colors"
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.8 }}
      >
        {(() => {
          const PortalIcon = portalButton.icon;
          return <PortalIcon className="w-6 h-6 text-primary group-hover:scale-110 transition-transform" />;
        })()}
        <span className="absolute right-full mr-4 px-2 py-1 bg-text-main text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
          {portalButton.label}
        </span>
      </motion.a>
    </aside>
  );
}
