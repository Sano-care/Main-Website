import type { Metadata } from "next";
import { Playfair_Display, Manrope } from "next/font/google";
import { CmsPreloadProvider } from "@/components/providers/CmsPreloadProvider";
import { getCmsPreloadSnapshot } from "@/services/cms/CmsContentServerService";
import "./globals.css";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Sanocare - Healthcare at Your Doorstep | Doctor Home Visits in Delhi",
    template: "%s | Sanocare",
  },
  description: "Reimagining Primary Homecare for Urban India. Book doctor home visits, teleconsultations, nursing care & lab tests at your doorstep. Highly qualified doctors (MBBS/Specialists), 24/7 support. Call +91-9571608318.",
  keywords: [
    "doctor home visit",
    "homecare",
    "doctor at home Delhi",
    "nursing care at home",
    "teleconsultation India",
    "lab test at home",
    "Sanocare",
    "healthcare at doorstep",
    "medical home service",
    "paramedic service Delhi",
  ],
  authors: [{ name: "Sanocare Healthcare Pvt. Ltd." }],
  creator: "Sanocare",
  publisher: "Sanocare Healthcare Pvt. Ltd.",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  metadataBase: new URL("https://sanocare.in"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "Sanocare - Healthcare at Your Doorstep",
    description: "Book doctor home visits, teleconsultations, nursing care & lab tests. Highly qualified doctors (MBBS/Specialists), 24/7 support in Delhi NCR.",
    url: "https://sanocare.in",
    siteName: "Sanocare",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Sanocare - Healthcare at Your Doorstep",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sanocare - Healthcare at Your Doorstep",
    description: "Book doctor home visits, teleconsultations, nursing care & lab tests. Highly qualified doctors (MBBS/Specialists), 24/7 support.",
    images: ["/og-image.png"],
    creator: "@sanocare",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: "/logo.svg",
    apple: "/logo.svg",
  },
  manifest: "/manifest.json",
  verification: {
    // Add your verification codes here when available
    // google: "google-site-verification-code",
    other: {
      "facebook-domain-verification": "kfszus13qiekuol0cdt8784x8bdgb6",
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cmsSnapshot = await getCmsPreloadSnapshot();

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/logo.svg" type="image/svg+xml" />
        <meta name="theme-color" content="#2563eb" />
        <meta name="geo.region" content="IN-DL" />
        <meta name="geo.placename" content="New Delhi" />
      </head>
      <body
        suppressHydrationWarning
        className={`${playfair.variable} ${manrope.variable} font-sans antialiased`}
      >
        <CmsPreloadProvider snapshot={cmsSnapshot}>{children}</CmsPreloadProvider>
      </body>
    </html>
  );
}
