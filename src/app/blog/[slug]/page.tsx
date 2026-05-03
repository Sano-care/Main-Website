"use client";

import { motion } from "framer-motion";
import { 
  ArrowLeft, 
  Calendar, 
  Clock, 
  User, 
  Share2, 
  Mail,
  ChevronRight,
  Circle,
  Quote,
  Stethoscope,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { notFound } from "next/navigation";
import { Navbar, Footer } from "@/components";
import { getBlogPostBySlug, BLOG_POSTS, BlogPost } from "@/data/blog-posts";
import { useCmsSection } from "@/hooks/useCmsSection";
import { useCmsBlogPost } from "@/hooks/useCmsBlogPost";
import { BLOG_PAGE_CONTENT } from "@/constants/cms-content";
import ReactMarkdown from "react-markdown";

// Related posts (exclude current)
function getRelatedPosts(currentSlug: string): BlogPost[] {
  return BLOG_POSTS.filter((post) => post.slug !== currentSlug).slice(0, 3);
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPostPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { data: blogTemplateCopy } = useCmsSection(
    "blog",
    "template",
    BLOG_PAGE_CONTENT.template,
  );

  const fallbackPost = getBlogPostBySlug(slug) ?? null;
  const { data: post } = useCmsBlogPost(slug, fallbackPost);

  if (!post) {
    notFound();
  }

  const relatedPosts = getRelatedPosts(slug);

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <Navbar />
      
      <main className="mx-auto max-w-[1200px] px-6 py-12">
        {/* Breadcrumb Navigation */}
        <motion.nav 
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-500 mb-8"
        >
          <Link href="/#insights" className="hover:text-primary transition-colors">
            {blogTemplateCopy.breadcrumbHomeLabel}
          </Link>
          <ChevronRight className="w-3 h-3" />
          <Link href="/#insights" className="hover:text-primary transition-colors">
            {post.category}
          </Link>
          <Circle className="w-2 h-2 text-primary fill-primary" />
          <span className="text-primary">{blogTemplateCopy.featuredLabel}</span>
        </motion.nav>

        {/* Article Header */}
        <motion.header 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-16"
        >
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-serif font-medium leading-[1.1] mb-8 text-slate-900">
            {post.title.split(':')[0]}
            {post.title.includes(':') && (
              <>
                : <br />
                <span className="italic text-primary">{post.title.split(':')[1]}</span>
              </>
            )}
            {!post.title.includes(':') && (
              <span className="block italic text-primary mt-2">{post.description.split('.')[0]}</span>
            )}
          </h1>

          {/* Author & Meta Info */}
          <div className="flex flex-wrap items-center gap-6 mb-10">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-full bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <User className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">{post.author.name}</p>
                <p className="text-xs text-slate-500">{post.author.role}</p>
              </div>
            </div>
            
            <div className="h-8 w-px bg-slate-200 hidden sm:block" />
            
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              {blogTemplateCopy.publishedPrefix} {formatDate(post.publishedAt)}
            </div>
            
            <div className="text-sm text-slate-500 flex items-center gap-2">
              <Clock className="w-4 h-4" />
              {post.readTime}
            </div>

            <button 
              className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-primary hover:text-primary transition-all"
              onClick={() => {
                if (navigator.share) {
                  navigator.share({
                    title: post.title,
                    text: post.description,
                    url: window.location.href,
                  });
                }
              }}
            >
              <Share2 className="w-4 h-4" />
              {blogTemplateCopy.shareButtonLabel}
            </button>
          </div>

          {/* Featured Image */}
          <div className="relative w-full aspect-[21/9] rounded-3xl overflow-hidden shadow-2xl">
            <Image
              src={post.image}
              alt={post.title}
              fill
              className="object-cover"
              priority
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-900/40 to-transparent" />
          </div>
        </motion.header>

        {/* Main Content Grid */}
        <div className="grid lg:grid-cols-12 gap-16">
          {/* Article Content */}
          <motion.article 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="lg:col-span-8"
          >
            {/* Lead Paragraph */}
            <p className="text-xl font-medium text-slate-900 leading-relaxed mb-10 border-l-4 border-primary pl-6">
              {post.description}
            </p>

            {/* Article Content with Custom Styling */}
            <div className="article-content prose prose-lg max-w-none
              prose-p:mb-6 prose-p:text-lg prose-p:leading-relaxed prose-p:text-slate-700 prose-p:font-serif
              prose-headings:font-serif prose-headings:text-slate-900
              prose-h2:text-3xl prose-h2:font-bold prose-h2:mt-12 prose-h2:mb-6
              prose-h3:text-xl prose-h3:font-bold prose-h3:mt-8 prose-h3:mb-4
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-strong:text-slate-900 prose-strong:font-bold
              prose-ul:text-slate-700 prose-ol:text-slate-700
              prose-li:marker:text-primary prose-li:font-serif
              prose-blockquote:border-0 prose-blockquote:p-0 prose-blockquote:not-italic
              prose-hr:border-slate-200"
            >
              <ReactMarkdown
                components={{
                  blockquote: ({ children }) => (
                    <blockquote className="my-12 py-10 border-y border-slate-100 text-center">
                      <Quote className="w-10 h-10 text-primary/30 mx-auto mb-4" />
                      <p className="text-2xl md:text-3xl font-serif italic text-slate-800 leading-relaxed max-w-2xl mx-auto mb-0">
                        {children}
                      </p>
                      <cite className="block mt-6 text-sm font-bold uppercase tracking-widest text-slate-500 not-italic">
                        — {post.author.name}
                      </cite>
                    </blockquote>
                  ),
                  hr: () => (
                    <div className="my-12 p-8 bg-slate-50 rounded-2xl border border-slate-200">
                      <div className="flex items-center justify-between mb-6">
                        <div>
                          <h4 className="font-bold text-slate-900">{blogTemplateCopy.keyTakeawayTitle}</h4>
                          <p className="text-sm text-slate-500">{blogTemplateCopy.keyTakeawaySubtitle}</p>
                        </div>
                        <Stethoscope className="w-6 h-6 text-primary" />
                      </div>
                      <p className="text-slate-700 font-serif">
                        {blogTemplateCopy.keyTakeawayText}
                      </p>
                    </div>
                  ),
                }}
              >
                {post.content}
              </ReactMarkdown>
            </div>

            {/* CTA Box */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mt-16 p-8 bg-gradient-to-br from-primary/5 to-primary/10 rounded-2xl border border-primary/20"
            >
              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Stethoscope className="w-8 h-8 text-primary" />
                </div>
                <div className="text-center md:text-left">
                  <h3 className="text-xl font-bold text-slate-900 mb-2">
                    {blogTemplateCopy.cta.title}
                  </h3>
                  <p className="text-slate-600 mb-4">
                    {blogTemplateCopy.cta.description}
                  </p>
                  <Link
                    href={blogTemplateCopy.cta.ctaHref}
                    className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-white font-semibold rounded-xl hover:bg-primary-dark transition-colors shadow-lg shadow-primary/20"
                  >
                    {blogTemplateCopy.cta.ctaLabel}
                  </Link>
                </div>
              </div>
            </motion.div>
          </motion.article>

          {/* Sidebar */}
          <aside className="lg:col-span-4">
            <div className="sticky top-28 space-y-10">
              {/* About the Author */}
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="bg-slate-50 rounded-2xl p-6 border border-slate-100"
              >
                <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">
                  {blogTemplateCopy.authorSection.title}
                </h4>
                <div className="flex gap-4 items-start">
                  <div className="size-16 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center shrink-0">
                    <User className="w-7 h-7 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 leading-tight">{post.author.name}</p>
                    <p className="text-sm text-primary mb-3">{post.author.role}</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      {blogTemplateCopy.authorSection.description}
                    </p>
                  </div>
                </div>
                <button className="w-full mt-6 py-3 border border-slate-200 rounded-xl text-sm font-bold hover:bg-white hover:border-primary hover:text-primary transition-all">
                  {blogTemplateCopy.authorSection.viewProfileLabel}
                </button>
              </motion.div>

              {/* Related Articles */}
              {relatedPosts.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 }}
                >
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-6">
                    {blogTemplateCopy.relatedArticlesLabel}
                  </h4>
                  <div className="space-y-6">
                    {relatedPosts.map((relatedPost, index) => (
                      <div key={relatedPost.slug}>
                        <Link href={`/blog/${relatedPost.slug}`} className="group block">
                          <span className="text-xs font-bold text-primary uppercase">
                            {relatedPost.category}
                          </span>
                          <h5 className="text-md font-bold text-slate-900 group-hover:text-primary transition-colors leading-tight mt-1">
                            {relatedPost.title}
                          </h5>
                          <p className="text-xs text-slate-500 mt-2">
                            {formatDate(relatedPost.publishedAt)} • {relatedPost.readTime}
                          </p>
                        </Link>
                        {index < relatedPosts.length - 1 && (
                          <div className="h-px bg-slate-100 mt-6" />
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {/* Newsletter Signup */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.5 }}
                className="bg-primary p-8 rounded-2xl text-white shadow-xl shadow-primary/20"
              >
                <Mail className="w-8 h-8 mb-4" />
                <h4 className="text-xl font-bold mb-2">{blogTemplateCopy.newsletter.title}</h4>
                <p className="text-sm text-white/80 leading-relaxed mb-6">
                  {blogTemplateCopy.newsletter.description}
                </p>
                <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
                  <input
                    type="email"
                    placeholder={blogTemplateCopy.newsletter.emailPlaceholder}
                    className="w-full rounded-xl border-none bg-white/10 placeholder:text-white/50 text-sm focus:ring-2 focus:ring-white px-4 py-3"
                  />
                  <button 
                    type="submit"
                    className="w-full bg-white text-primary py-3 rounded-xl text-sm font-bold hover:bg-slate-50 transition-colors"
                  >
                    {blogTemplateCopy.newsletter.ctaLabel}
                  </button>
                </form>
                <p className="mt-4 text-[10px] text-white/60 text-center">
                  {blogTemplateCopy.newsletter.privacyNote}
                </p>
              </motion.div>
            </div>
          </aside>
        </div>

        {/* Back to Articles */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-20 pt-12 border-t border-slate-200"
        >
          <Link
            href="/#insights"
            className="inline-flex items-center gap-2 text-slate-600 hover:text-primary transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            {blogTemplateCopy.backLabel}
          </Link>
        </motion.div>
      </main>

      <Footer />
    </div>
  );
}
