"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Building2, 
  Users, 
  Phone, 
  Mail, 
  MapPin, 
  ArrowRight, 
  CheckCircle2,
  Loader2,
  User,
  MessageSquare,
  Zap,
} from "lucide-react";
import Image from "next/image";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { Button, Input } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { supabase } from "@/lib/supabase";
import { CAREHUB_PAGE_CONTENT } from "@/constants/cms-content";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 }
};

export default function CareHubPage() {
  const { data: carehubCopy } = useCmsSection(
    "carehub",
    "page_copy",
    CAREHUB_PAGE_CONTENT.pageCopy,
  );
  const { data: benefitsData } = useCmsSection(
    "carehub",
    "benefits",
    CAREHUB_PAGE_CONTENT.benefits,
  );
  const { data: howItWorks } = useCmsSection(
    "carehub",
    "how_it_works",
    CAREHUB_PAGE_CONTENT.howItWorks,
  );
  const { data: stats } = useCmsSection(
    "carehub",
    "stats",
    CAREHUB_PAGE_CONTENT.stats,
  );
  const { data: inquiryBenefits } = useCmsSection(
    "carehub",
    "inquiry_benefits",
    CAREHUB_PAGE_CONTENT.inquiryBenefits,
  );

  const benefits = benefitsData.map((benefit, index) => ({
    ...benefit,
    icon: benefit.icon ?? CAREHUB_PAGE_CONTENT.benefits[index]?.icon ?? Building2,
  }));

  const [formData, setFormData] = useState({
    contactName: "",
    phone: "",
    email: "",
    societyName: "",
    location: "",
    totalFlats: "",
    message: ""
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const { error } = await supabase.from("carehub_inquiries").insert({
        contact_name: formData.contactName,
        phone: formData.phone,
        email: formData.email,
        society_name: formData.societyName,
        location: formData.location,
        total_flats: parseInt(formData.totalFlats) || null,
        message: formData.message,
        status: "new"
      });

      if (error) throw error;

      setSubmitStatus({ 
        type: 'success', 
        message: 'Thank you! Our team will contact you within 24 hours to discuss CareHub for your society.' 
      });
      setFormData({
        contactName: "",
        phone: "",
        email: "",
        societyName: "",
        location: "",
        totalFlats: "",
        message: ""
      });
    } catch (error) {
      console.error('CareHub inquiry error:', error);
      setSubmitStatus({ 
        type: 'error', 
        message: 'Something went wrong. Please try again or call us directly.' 
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;
    if (!value.startsWith('+91')) {
      value = '+91 ' + value.replace(/^\+?91?\s?/, '');
    }
    const afterPrefix = value.slice(4).replace(/\D/g, '');
    const limitedDigits = afterPrefix.slice(0, 10);
    let formatted = '+91 ';
    if (limitedDigits.length > 0) {
      formatted += limitedDigits.slice(0, 5);
      if (limitedDigits.length > 5) {
        formatted += ' ' + limitedDigits.slice(5);
      }
    }
    setFormData(prev => ({ ...prev, phone: formatted }));
  };

  return (
    <main className="min-h-screen bg-background-light relative overflow-x-hidden">
      {/* Background Decorations */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -right-[10%] w-[60vw] h-[60vw] rounded-full bg-gradient-to-br from-indigo-50 to-transparent blur-3xl opacity-60" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[50vw] h-[50vw] rounded-full bg-gradient-to-tr from-purple-50 to-transparent blur-3xl opacity-60" />
      </div>

      <div className="relative z-10">
        <Navbar />
        
        {/* Hero Section */}
        <section className="relative pt-16 pb-16 lg:pt-28 lg:pb-28 overflow-hidden">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left Content */}
              <motion.div
                className="flex flex-col gap-6 lg:gap-8"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6 }}
              >
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-indigo-600 shadow-sm">
                  <Building2 className="size-3.5" />
                  {carehubCopy.hero.badge}
                </div>
                
                <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl font-medium leading-[1.1] tracking-tight text-text-main">
                  {carehubCopy.hero.titlePrefix} <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-purple-600 italic">{carehubCopy.hero.titleHighlight}</span>
                </h1>
                
                <p className="text-lg lg:text-xl leading-relaxed text-text-secondary max-w-xl font-light">
                  {carehubCopy.hero.description}
                </p>
                
                <div className="flex flex-wrap gap-4 pt-4">
                  <a href={carehubCopy.hero.primaryCtaHref}>
                    <Button className="rounded-full px-8 py-4 bg-indigo-600 hover:bg-indigo-700 shadow-xl shadow-indigo-500/20 hover:-translate-y-1 transition-transform">
                      {carehubCopy.hero.primaryCtaLabel}
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </a>
                  <a href={carehubCopy.hero.secondaryCtaHref}>
                    <Button variant="outline" className="rounded-full px-8 py-4 border-slate-200 hover:border-indigo-300">
                      <Phone className="w-4 h-4" />
                      {carehubCopy.hero.secondaryCtaLabel}
                    </Button>
                  </a>
                </div>
              </motion.div>
              
              {/* Right Image */}
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                <div className="aspect-[16/10] rounded-[2rem] overflow-hidden shadow-2xl relative z-10 border-8 border-white">
                  <Image
                    src={carehubCopy.hero.imageSrc}
                    alt={carehubCopy.hero.imageAlt}
                    fill
                    className="object-cover"
                    priority
                  />
                </div>
                
                {/* Floating Card */}
                <motion.div
                  className="absolute -bottom-6 -right-6 bg-white/80 backdrop-blur-xl p-5 rounded-2xl shadow-xl z-20 max-w-[200px] border border-white/50"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <Zap className="w-5 h-5 text-indigo-600" />
                    <span className="text-xs font-bold uppercase tracking-widest">{carehubCopy.hero.floatingCardLabel}</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">{carehubCopy.hero.floatingCardText}</p>
                </motion.div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Stats Bar */}
        <section className="py-12 bg-white border-y border-slate-100">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <motion.div
              className="grid grid-cols-2 lg:grid-cols-4 gap-8"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              {stats.map((stat, index) => (
                <motion.div
                  key={index}
                  className="text-center"
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                >
                  <div className="text-3xl lg:text-4xl font-bold text-indigo-600 mb-1">{stat.value}</div>
                  <div className="text-sm font-medium text-text-secondary">{stat.label}</div>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* Benefits Grid */}
        <section className="py-20 lg:py-28 bg-white">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <motion.div
              className="text-center mb-16 max-w-2xl mx-auto"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <span className="text-indigo-600 font-bold tracking-widest text-xs uppercase mb-3 block">
                {carehubCopy.benefitsSection.badge}
              </span>
              <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6">
                {carehubCopy.benefitsSection.title}
              </h2>
              <p className="text-text-secondary font-light">
                {carehubCopy.benefitsSection.description}
              </p>
            </motion.div>

            <motion.div
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
            >
              {benefits.map((benefit, index) => {
                const Icon = typeof benefit.icon === "function" ? benefit.icon : Building2;
                return (
                  <motion.div
                    key={index}
                    variants={itemVariants}
                    className="group relative p-8 lg:p-10 bg-white rounded-2xl shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] border border-slate-100 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2"
                  >
                    <div className="size-14 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-6 transition-all duration-300 group-hover:bg-indigo-600 group-hover:text-white group-hover:scale-110">
                      <Icon className="w-7 h-7" />
                    </div>
                    <h3 className="font-serif text-xl font-bold mb-3 text-text-main">
                      {benefit.title}
                    </h3>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {benefit.description}
                    </p>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-20 lg:py-28 relative overflow-hidden">
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
              {/* Left Content */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-indigo-600 font-bold tracking-widest text-xs uppercase mb-3 block">
                  {carehubCopy.processSection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-text-main mb-6 lg:mb-8">
                  {carehubCopy.processSection.title}
                </h2>
                <p className="text-lg text-text-secondary font-light leading-relaxed mb-10 lg:mb-12">
                  {carehubCopy.processSection.description}
                </p>
                
                <div className="space-y-8">
                  {howItWorks.map((item, index) => (
                    <motion.div
                      key={item.step}
                      className="flex gap-6 group"
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <span className="text-4xl lg:text-5xl font-serif text-indigo-600 opacity-30 group-hover:opacity-100 transition-opacity duration-300">
                        {item.step}
                      </span>
                      <div>
                        <h3 className="text-lg lg:text-xl font-bold text-text-main mb-2">
                          {item.title}
                        </h3>
                        <p className="text-text-secondary text-sm leading-relaxed max-w-sm">
                          {item.description}
                        </p>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
              
              {/* Right Image */}
              <motion.div
                className="relative"
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="aspect-square rounded-3xl overflow-hidden shadow-2xl relative">
                  <Image
                    src={carehubCopy.processSection.imageSrc}
                    alt={carehubCopy.processSection.imageAlt}
                    fill
                    className="object-cover"
                  />
                </div>
                <div className="absolute -top-12 -right-12 size-64 bg-indigo-400/20 rounded-full blur-3xl -z-10" />
              </motion.div>
            </div>
          </div>
        </section>

        {/* Inquiry Form Section - Dark */}
        <section className="py-20 lg:py-28 bg-text-main overflow-hidden relative" id="inquiry-form">
          <div className="absolute inset-0 opacity-10 pointer-events-none">
            <div 
              className="absolute top-0 left-0 w-full h-full"
              style={{
                backgroundImage: "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.1) 1px, transparent 0)",
                backgroundSize: "40px 40px",
              }}
            />
          </div>
          
          <div className="mx-auto max-w-[1400px] px-6 lg:px-12 relative z-10">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* Left - Info */}
              <motion.div
                initial={{ opacity: 0, x: -30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <span className="text-indigo-400 font-bold tracking-widest text-xs uppercase mb-3 block">
                  {carehubCopy.inquirySection.badge}
                </span>
                <h2 className="font-serif text-3xl lg:text-5xl font-medium text-white mb-6">
                  {carehubCopy.inquirySection.title}
                </h2>
                <p className="text-white/70 mb-8 leading-relaxed text-lg">
                  {carehubCopy.inquirySection.description}
                </p>

                <div className="space-y-4 mb-8">
                  {inquiryBenefits.map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                      <span className="text-white/80">{item}</span>
                    </div>
                  ))}
                </div>

                <div className="p-5 rounded-2xl bg-white/5 border border-white/10">
                  <p className="text-white/60 text-sm mb-2">
                    {carehubCopy.inquirySection.directTalkLabel}
                  </p>
                  <a 
                    href={carehubCopy.hero.secondaryCtaHref} 
                    className="inline-flex items-center gap-2 text-white font-bold hover:text-indigo-400 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    {carehubCopy.inquirySection.directTalkPhone}
                  </a>
                </div>
              </motion.div>

              {/* Right - Form */}
              <motion.div
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
              >
                <div className="bg-white rounded-3xl p-6 lg:p-8 shadow-2xl">
                  {submitStatus?.type === 'success' ? (
                    <div className="text-center py-8">
                      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                        <CheckCircle2 className="w-8 h-8 text-green-500" />
                      </div>
                      <h3 className="text-xl font-bold text-text-main mb-2">{carehubCopy.inquirySection.successTitle}</h3>
                      <p className="text-text-secondary mb-6">{submitStatus.message}</p>
                      <Button
                        variant="outline"
                        onClick={() => setSubmitStatus(null)}
                      >
                        {carehubCopy.inquirySection.successCtaLabel}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      <h3 className="text-xl font-bold text-text-main mb-4">{carehubCopy.inquirySection.formTitle}</h3>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                          label={carehubCopy.formFields.contactNameLabel}
                          icon={User}
                          placeholder={carehubCopy.formFields.contactNamePlaceholder}
                          value={formData.contactName}
                          onChange={(e) => setFormData(prev => ({ ...prev, contactName: e.target.value }))}
                          required
                        />
                        <Input
                          label={carehubCopy.formFields.phoneLabel}
                          icon={Phone}
                          type="tel"
                          placeholder={carehubCopy.formFields.phonePlaceholder}
                          value={formData.phone}
                          onChange={handlePhoneChange}
                          required
                        />
                      </div>

                      <Input
                        label={carehubCopy.formFields.emailLabel}
                        icon={Mail}
                        type="email"
                        placeholder={carehubCopy.formFields.emailPlaceholder}
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        required
                      />

                      <Input
                        label={carehubCopy.formFields.societyNameLabel}
                        icon={Building2}
                        placeholder={carehubCopy.formFields.societyNamePlaceholder}
                        value={formData.societyName}
                        onChange={(e) => setFormData(prev => ({ ...prev, societyName: e.target.value }))}
                        required
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <Input
                          label={carehubCopy.formFields.locationLabel}
                          icon={MapPin}
                          placeholder={carehubCopy.formFields.locationPlaceholder}
                          value={formData.location}
                          onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                          required
                        />
                        <Input
                          label={carehubCopy.formFields.totalFlatsLabel}
                          icon={Users}
                          type="number"
                          placeholder={carehubCopy.formFields.totalFlatsPlaceholder}
                          value={formData.totalFlats}
                          onChange={(e) => setFormData(prev => ({ ...prev, totalFlats: e.target.value }))}
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-semibold text-text-main mb-1.5">
                          {carehubCopy.formFields.messageLabel}
                        </label>
                        <div className="relative">
                          <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                          <textarea
                            placeholder={carehubCopy.formFields.messagePlaceholder}
                            value={formData.message}
                            onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                            rows={3}
                            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all text-sm resize-none"
                          />
                        </div>
                      </div>

                      {submitStatus?.type === 'error' && (
                        <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700">
                          {submitStatus.message}
                        </div>
                      )}

                      <Button
                        type="submit"
                        variant="primary"
                        size="lg"
                        className="w-full bg-indigo-600 hover:bg-indigo-700"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            {carehubCopy.formFields.submittingLabel}
                          </>
                        ) : (
                          <>
                            {carehubCopy.formFields.submitLabel}
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </Button>

                      <p className="text-xs text-center text-slate-500">
                        {carehubCopy.inquirySection.within24HoursNote}
                      </p>
                    </form>
                  )}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16 bg-gradient-to-r from-indigo-600 via-indigo-700 to-purple-600">
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-serif text-3xl md:text-4xl font-bold text-white mb-4">
                {carehubCopy.ctaSection.title}
              </h2>
              <p className="text-white/80 mb-8 max-w-xl mx-auto">
                {carehubCopy.ctaSection.description}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href={carehubCopy.ctaSection.primaryCtaHref}>
                  <Button variant="ghost" size="lg" className="w-full sm:w-auto bg-white text-indigo-600 hover:bg-slate-100 hover:text-indigo-600 rounded-full px-8">
                    {carehubCopy.ctaSection.primaryCtaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                </a>
                <a href={carehubCopy.ctaSection.secondaryCtaHref}>
                  <Button variant="outline" size="lg" className="w-full sm:w-auto border-white text-white hover:bg-white/10 rounded-full px-8">
                    <Phone className="w-4 h-4" />
                    {carehubCopy.ctaSection.secondaryCtaLabel}
                  </Button>
                </a>
              </div>
            </motion.div>
          </div>
        </section>

        <Footer />
      </div>
    </main>
  );
}
