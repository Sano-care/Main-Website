"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { 
  Phone, 
  Mail, 
  Send,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Building2,
  User,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { GlassCard, Button, Input } from "@/components/ui";
import { useCmsSection } from "@/hooks/useCmsSection";
import { supabase } from "@/lib/supabase";
import { CONTACT_PAGE_CONTENT } from "@/constants/cms-content";

export default function ContactPage() {
  const { data: contactPageCopy } = useCmsSection(
    "contact",
    "page_copy",
    CONTACT_PAGE_CONTENT.pageCopy,
  );
  const { data: contactInfoData } = useCmsSection(
    "contact",
    "contact_info",
    CONTACT_PAGE_CONTENT.contactInfo,
  );
  const contactInfo = contactInfoData.map((info, index) => ({
    ...info,
    icon: info.icon ?? CONTACT_PAGE_CONTENT.contactInfo[index]?.icon ?? MessageSquare,
  }));

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      const { error } = await supabase.from("contact_messages").insert({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        subject: formData.subject,
        message: formData.message,
        status: "new",
      });

      if (error) throw error;

      setSubmitStatus({ 
        type: 'success', 
        message: 'Thank you for reaching out! We\'ll get back to you within 24 hours.' 
      });
      setFormData({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (error) {
      console.error('Contact form error:', error);
      setSubmitStatus({ 
        type: 'error', 
        message: 'Something went wrong. Please try again or contact us directly.' 
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
    <main className="min-h-screen bg-background-light">
      <Navbar />
      
      {/* Hero Section */}
      <section className="relative pt-24 pb-16 lg:pt-32 lg:pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-slate-50 to-background-light" />
        
        <div className="relative z-10 max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center max-w-3xl mx-auto"
          >
            <h1 className="font-serif text-4xl md:text-5xl lg:text-6xl font-bold text-text-main mb-6">
              {contactPageCopy.hero.titlePrefix} <span className="text-primary italic">{contactPageCopy.hero.titleHighlight}</span>
            </h1>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              {contactPageCopy.hero.description}
            </p>
          </motion.div>
        </div>
      </section>

      {/* Contact Info Cards */}
      <section className="py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {contactInfo.map((info, index) => {
              const Icon = typeof info.icon === "function" ? info.icon : MessageSquare;
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <GlassCard className="h-full p-6 text-center hover:shadow-lg transition-all">
                    <div className="p-3 rounded-xl bg-primary/10 text-primary w-fit mx-auto mb-4">
                      <Icon className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-text-main mb-2">{info.title}</h3>
                    {info.details.map((detail, i) => (
                      <p key={i} className="text-sm text-text-secondary">{detail}</p>
                    ))}
                    {info.link && (
                      <a 
                        href={info.link}
                        target={info.link.startsWith('http') ? '_blank' : undefined}
                        rel={info.link.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="inline-block mt-3 text-sm font-semibold text-primary hover:underline"
                      >
                        {info.linkText} →
                      </a>
                    )}
                  </GlassCard>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Contact Form & Map */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid lg:grid-cols-2 gap-12">
            {/* Contact Form */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
            >
              <h2 className="font-serif text-2xl lg:text-3xl font-bold text-text-main mb-6">
                {contactPageCopy.formSection.title}
              </h2>
              
              <GlassCard variant="solid" className="p-6 lg:p-8">
                {submitStatus?.type === 'success' ? (
                  <div className="text-center py-8">
                    <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                      <CheckCircle2 className="w-8 h-8 text-green-500" />
                    </div>
                    <h3 className="text-xl font-bold text-text-main mb-2">{contactPageCopy.formSection.successTitle}</h3>
                    <p className="text-text-secondary mb-6">{submitStatus.message}</p>
                    <Button
                      variant="outline"
                      onClick={() => setSubmitStatus(null)}
                    >
                      {contactPageCopy.formSection.successCtaLabel}
                    </Button>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <Input
                        label={contactPageCopy.formSection.fields.nameLabel}
                        icon={User}
                        placeholder={contactPageCopy.formSection.fields.namePlaceholder}
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        required
                      />
                      <Input
                        label={contactPageCopy.formSection.fields.phoneLabel}
                        icon={Phone}
                        type="tel"
                        placeholder={contactPageCopy.formSection.fields.phonePlaceholder}
                        value={formData.phone}
                        onChange={handlePhoneChange}
                      />
                    </div>

                    <Input
                      label={contactPageCopy.formSection.fields.emailLabel}
                      icon={Mail}
                      type="email"
                      placeholder={contactPageCopy.formSection.fields.emailPlaceholder}
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      required
                    />

                    <Input
                      label={contactPageCopy.formSection.fields.subjectLabel}
                      icon={Building2}
                      placeholder={contactPageCopy.formSection.fields.subjectPlaceholder}
                      value={formData.subject}
                      onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
                      required
                    />

                    <div>
                      <label className="block text-sm font-semibold text-text-main mb-1.5">
                        {contactPageCopy.formSection.fields.messageLabel}
                      </label>
                      <div className="relative">
                        <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-slate-400" />
                        <textarea
                          placeholder={contactPageCopy.formSection.fields.messagePlaceholder}
                          value={formData.message}
                          onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                          rows={5}
                          required
                          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all text-sm resize-none"
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
                      className="w-full"
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {contactPageCopy.formSection.submittingLabel}
                        </>
                      ) : (
                        <>
                          {contactPageCopy.formSection.submitLabel}
                          <Send className="w-4 h-4" />
                        </>
                      )}
                    </Button>
                  </form>
                )}
              </GlassCard>
            </motion.div>

            {/* Map */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="flex flex-col"
            >
              <h2 className="font-serif text-2xl lg:text-3xl font-bold text-text-main mb-6">
                {contactPageCopy.mapSection.title}
              </h2>
              
              <div className="flex-1 bg-slate-200 rounded-2xl overflow-hidden min-h-[400px]">
                <iframe
                  src={contactPageCopy.mapSection.mapEmbedUrl}
                  width="100%"
                  height="100%"
                  style={{ border: 0, minHeight: '400px' }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title={contactPageCopy.mapSection.iframeTitle}
                />
              </div>

              <div className="mt-6 p-4 bg-primary/5 rounded-xl border border-primary/10">
                <h3 className="font-bold text-text-main mb-2">{contactPageCopy.mapSection.serviceAreasTitle}</h3>
                <p className="text-sm text-text-secondary">
                  {contactPageCopy.mapSection.serviceAreasDescription}
                </p>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* FAQ CTA */}
      <section className="py-16 bg-slate-50">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <h2 className="font-serif text-2xl md:text-3xl font-bold text-text-main mb-4">
                {contactPageCopy.faqCta.title}
            </h2>
            <p className="text-text-secondary mb-6">
                {contactPageCopy.faqCta.description}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <a href={contactPageCopy.faqCta.primaryCtaHref}>
                <Button variant="primary" size="lg">
                    {contactPageCopy.faqCta.primaryCtaLabel}
                </Button>
              </a>
                <a href={contactPageCopy.faqCta.secondaryCtaHref}>
                <Button variant="outline" size="lg">
                  <Phone className="w-4 h-4" />
                    {contactPageCopy.faqCta.secondaryCtaLabel}
                </Button>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
