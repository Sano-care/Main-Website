"use client";

import { motion } from "framer-motion";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";

export function Journey() {
  const { data: journeyContent } = useCmsSection(
    "home",
    "journey",
    HOME_CONTENT.journey,
  );
  const header = journeyContent.header ?? HOME_CONTENT.journey.header;
  const journeySteps = journeyContent.steps;

  return (
    <section className="py-24 bg-text-main text-white relative overflow-hidden">
      {/* Dot pattern background */}
      <div 
        className="absolute inset-0 opacity-10" 
        style={{ 
          backgroundImage: "radial-gradient(#ffffff 1px, transparent 1px)", 
          backgroundSize: "32px 32px" 
        }} 
      />

      <div className="mx-auto max-w-[1200px] px-6 lg:px-12">
        {/* Header */}
        <motion.div
          className="text-center mb-16"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <span className="text-primary font-bold tracking-widest text-xs uppercase mb-2 block">
            {header.badge}
          </span>
          <h2 className="font-serif text-4xl lg:text-5xl font-medium text-white">
            {header.title}
          </h2>
          <p className="mt-4 text-white/70 max-w-2xl mx-auto">
            {header.description}
          </p>
        </motion.div>

        {/* Timeline */}
        <div className="relative">
          {/* Vertical Line */}
          <div className="absolute left-4 lg:left-1/2 top-0 bottom-0 w-0.5 bg-white/20 lg:-translate-x-1/2" />

          <div className="space-y-12 lg:space-y-24">
            {journeySteps.map((step, index) => {
              const isEven = index % 2 === 0;

              return (
                <motion.div
                  key={step.number}
                  className="relative flex flex-col lg:flex-row lg:items-center gap-8 lg:gap-16"
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-100px" }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                >
                  {/* Text Content */}
                  <div
                    className={`lg:w-1/2 order-2 ${
                      isEven ? "lg:order-1 lg:text-right" : "lg:order-2 lg:text-left"
                    } pl-12 lg:pl-0`}
                  >
                    <h3 className="font-serif text-2xl font-bold text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 text-white/70">
                      {step.description}
                    </p>
                  </div>

                  {/* Number Circle */}
                  <div className="absolute left-0 lg:left-1/2 lg:-translate-x-1/2 top-0 lg:top-1/2 lg:-translate-y-1/2 z-10">
                    <motion.div
                      className={`size-9 rounded-full ${
                        index === 0
                          ? "bg-primary text-white"
                          : "bg-white/10 text-white border-2 border-white/30"
                      } shadow-lg flex items-center justify-center text-sm font-bold`}
                      whileInView={{
                        scale: [1, 1.2, 1],
                      }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.5, delay: index * 0.2 }}
                    >
                      {step.number}
                    </motion.div>
                  </div>

                  {/* Image */}
                  <div
                    className={`lg:w-1/2 ${
                      isEven ? "order-3 lg:order-2" : "order-3 lg:order-1"
                    } pl-12 lg:pl-0`}
                  >
                    <motion.div
                      className="relative h-48 w-full rounded-2xl bg-cover bg-center shadow-md overflow-hidden group"
                      style={{ backgroundImage: `url("${step.image}")` }}
                      whileHover={{ scale: 1.02 }}
                      transition={{ duration: 0.3 }}
                    >
                      <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors" />
                    </motion.div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
