"use client";

import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCmsSection } from "@/hooks/useCmsSection";
import { HOME_CONTENT } from "@/constants/cms-content";

export function Insights() {
  const { data: insightsContent } = useCmsSection(
    "home",
    "insights",
    HOME_CONTENT.insights,
  );
  const sectionTitle = insightsContent.sectionTitle ?? HOME_CONTENT.insights.sectionTitle;
  const articles = insightsContent.articles;

  return (
    <section className="py-24 relative" id="insights">
      <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
        {/* Header */}
        <div className="flex items-end justify-between pb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-serif text-4xl font-medium text-text-main">
              {sectionTitle}
            </h2>
          </motion.div>
          <div className="hidden sm:flex gap-3">
            <button className="flex size-12 items-center justify-center rounded-full border border-slate-200 bg-white text-text-main hover:border-primary hover:text-primary transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button className="flex size-12 items-center justify-center rounded-full border border-slate-200 bg-white text-text-main hover:border-primary hover:text-primary transition-colors">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Articles Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
          {articles.map((article, index) => (
            <motion.a
              key={article.title}
              href={`/blog/${article.slug}`}
              className="group cursor-pointer block"
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
            >
              {/* Image */}
              <div className="overflow-hidden rounded-2xl mb-4">
                <motion.div
                  className="aspect-[4/3] w-full bg-cover bg-center"
                  style={{ backgroundImage: `url("${article.image}")` }}
                  whileHover={{ scale: 1.05 }}
                  transition={{ duration: 0.5 }}
                />
              </div>

              {/* Content */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-wider text-text-secondary">
                  <span className="text-primary">{article.category}</span>
                  <span className="size-1 rounded-full bg-slate-300" />
                  <span>{article.readTime}</span>
                </div>
                <h3 className="font-serif text-2xl font-bold leading-tight text-text-main group-hover:text-primary transition-colors">
                  {article.title}
                </h3>
                <p className="text-text-secondary line-clamp-2">
                  {article.description}
                </p>
              </div>
            </motion.a>
          ))}
        </div>
      </div>
    </section>
  );
}
