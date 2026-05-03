"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Phone } from "lucide-react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { SHARED_CONTENT } from "@/constants/cms-content";

export function MobileStickyBar() {
  const [isVisible, setIsVisible] = useState(false);
  const { data: stickyBarCopy } = useCmsSection(
    "shared",
    "mobile_sticky_bar",
    SHARED_CONTENT.mobileStickyBar,
  );

  useEffect(() => {
    const handleScroll = () => {
      // Get the booking form element (hero section form)
      const heroSection = document.getElementById("hero-booking-form");
      
      if (heroSection) {
        const rect = heroSection.getBoundingClientRect();
        // Show the bar when the form is scrolled out of view (bottom of form is above viewport)
        setIsVisible(rect.bottom < 0);
      } else {
        // Fallback: show after scrolling 500px
        setIsVisible(window.scrollY > 500);
      }
    };

    window.addEventListener("scroll", handleScroll);
    handleScroll(); // Check initial state
    
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToForm = () => {
    const heroSection = document.getElementById("hero-booking-form");
    if (heroSection) {
      heroSection.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] px-4 py-3 md:hidden"
          initial={{ y: 100 }}
          animate={{ y: 0 }}
          exit={{ y: 100 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <div className="flex items-center justify-between gap-3">
            {/* Call Button */}
            <a
              href={stickyBarCopy.callHref}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-green-500 text-white rounded-xl font-semibold text-sm shadow-lg shadow-green-500/30"
            >
              <Phone className="w-4 h-4" />
              {stickyBarCopy.callLabel}
            </a>

            {/* Book Button */}
            <motion.button
              onClick={scrollToForm}
              className="flex-1 bg-primary text-white rounded-xl py-3 px-6 font-bold text-sm shadow-lg shadow-primary/30 flex items-center justify-center gap-2"
              whileTap={{ scale: 0.97 }}
            >
              <span>{stickyBarCopy.bookLabel}</span>
              <ArrowRight className="w-4 h-4" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
