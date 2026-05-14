# SanoCare Platform - Frontend

[![Next.js 16](https://img.shields.io/badge/Next.js-16.1.6-black?logo=next.js)](https://nextjs.org)
[![React 19](https://img.shields.io/badge/React-19.2.3-blue?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4-06B6D4?logo=tailwindcss)](https://tailwindcss.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com)

A comprehensive, enterprise-grade telemedicine platform delivering integrated care across four specialized portals with real-time collaboration, offline capabilities, and a sophisticated content management system.

## 🏥 Platform Overview

SanoCare is a multi-role telemedicine platform serving healthcare providers and patients with role-based access control, real-time communication, and health data management:

- **👨‍⚕️ Doctor Portal** - Case queue management, SOAP notes, vital signs review, and case closure with risk classification
- **🚑 Field Node Portal** - Dispatch management, GPS tracking, vital capture, live video coordination  
- **👤 Patient Portal** - Health tracking, booking consultations, receiving assignments, secure health vault
- **⚙️ Admin Portal** - Analytics, medic management, case assignments, operational insights
- **🌐 Public Website** - Marketing, service showcase, booking entry point, informational content

## ✨ Key Features

### 🔐 Security & Authentication
- **Supabase JWT Authentication** with magic links and password-based login
- **Role-Based Access Control (RBAC)** via PostgreSQL Row Level Security
- **End-to-End Protected Routes** with middleware authorization
- **Session Persistence** across browser refreshes

### 📱 Multi-Platform Support
- **Responsive Design** - Mobile-first, tablet, desktop optimization
- **Progressive Web App (PWA)** - Offline functionality with sync capability
- **Native-like UX** - Installable, home screen capable

### 💻 Real-Time Capabilities
- **Live Location Tracking** - GPS-based field node positioning
- **Video Consultation** - LiveKit-powered HD video calls
- **Real-time Subscriptions** - Instant notification of case updates
- **WebSocket Support** - GPS relay and live data streaming

### 🏗️ Content Management System
- **Sovereign CMS Layer** - Completely decoupled from transactional logic
- **Dynamic Content** - Manage hero banners, service descriptions, testimonials
- **Media Asset Management** - Centralized image storage and optimization
- **Incremental Static Regeneration (ISR)** - CDN-cached pages with instant updates
- **SEO-First Architecture** - Metadata management, OG tags, structured data

### 📊 Offline & Sync
- **Offline Vitals Capture** - IndexedDB local storage for vital signs
- **Automatic Sync** - Seamless data synchronization when online
- **Conflict Resolution** - Intelligent merge strategies for data consistency

## 🚀 Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Framework** | Next.js 16 (App Router) | Full-stack React framework with SSR/ISR |
| **Language** | TypeScript 5 | Type-safe development |
| **Styling** | Tailwind CSS 4 | Utility-first CSS framework |
| **Backend** | Supabase | PostgreSQL + Auth + Real-time |
| **State** | Zustand | Lightweight state management |
| **Video** | LiveKit | Real-time video communication |
| **Maps** | Leaflet | Location visualization |
| **PWA** | next-pwa | Offline capabilities |
| **Database** | IndexedDB | Client-side offline storage |

## 📦 Project Structure

```
src/
├── app/                          # Next.js App Router (Pages & Layouts)
│   ├── (patient)/                # Patient portal routes
│   ├── doctor/                   # Doctor portal routes
│   ├── field-node/               # Field node portal routes
│   ├── admin/                    # Admin portal routes
│   ├── api/                      # API routes (CMS webhooks, etc.)
│   ├── about/                    # Public website pages
│   ├── blog/                     # Blog pages
│   ├── carehub/                  # Educational content
│   └── layout.tsx                # Root layout
│
├── components/                   # Reusable React Components
│   ├── admin/                    # Admin-specific components
│   ├── doctor/                   # Doctor-specific components
│   ├── field_node/               # Field node-specific components
│   ├── patient/                  # Patient-specific components
│   ├── portal/                   # Cross-portal components
│   ├── shared/                   # Shared UI components
│   └── ui/                       # Atomic design system
│
├── services/                     # Business Logic & Data Fetching
│   ├── cms/                      # CMS-specific services (isolated)
│   │   ├── CmsContentServerService.ts
│   │   ├── defaults.ts
│   │   └── snapshot.ts
│   ├── booking/                  # Booking workflow services
│   ├── geolocation/              # GPS services
│   ├── patientVaultService.ts    # Secure health records
│   └── index.ts                  # Service exports
│
├── lib/                          # Utilities & Helpers
│   ├── supabase.ts               # Client instance
│   ├── supabase-server.ts        # Server instance
│   ├── supabaseServices.ts       # All Supabase queries
│   ├── backendApi.ts             # Backend proxy calls
│   ├── offlineVitalsDb.ts        # IndexedDB wrapper
│   └── utils.ts                  # Helper functions
│
├── hooks/                        # React Custom Hooks
│   ├── useBookingSubmit.ts
│   ├── useCmsMedia.ts
│   ├── useCmsSiteGlobals.ts
│   ├── usePortalTheme.ts
│   └── ...18 more hooks
│
├── constants/                    # Configuration & Constants
│   ├── cms-content.ts
│   ├── content.ts
│   └── pricing.ts
│
├── store/                        # Zustand State Management
├── providers/                    # Context Providers
├── design-system/                # Design Tokens & CSS
│   ├── tokens.generated.js
│   └── component-recipes.json
│
└── adapters/                     # Service Adapters
    ├── browser/                  # Client-side adapters
    └── supabase/                 # Supabase adapters
```

## 🔄 Database Architecture

### Core Tables

**CMS Schema (Isolated)**
- `cms_site_globals` - Global branding, contact info, social links
- `cms_page_registry` - Page metadata, SEO, publishing status
- `cms_sections` - Modular content blocks with JSON storage
- `cms_collections` - Reusable content lists (services, testimonials)
- `cms_services_catalog` - Service definitions with pricing
- `cms_media_assets` - Image/media tracking and optimization
- `cms_booking_service_options` - Booking category management

**Transactional Schema**
- `consultations` - Patient-doctor cases with status tracking
- `profiles` - User profiles across all roles
- `vitals` - Health measurements with timestamps
- `soap_notes` - Clinical notes with risk assessment
- `prescriptions` - Medication records
- `assignments` - Case assignments for medics

### Row-Level Security (RLS)
- **Public:** Read-only access to CMS and public data
- **Patients:** Read own data, create bookings
- **Doctors:** Read assigned cases and vitals
- **Medics:** Read assignments and location data
- **Admin:** Full access with audit trails

## 🛠️ Getting Started

### Prerequisites
- Node.js 18+ 
- npm or yarn
- Supabase project (or local setup)

### Installation

1. **Clone & Install**
```bash
git clone <repo-url>
cd sano-care
npm install
```

2. **Environment Variables**
```bash
cp .env.local.example .env.local
```

Fill in your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_ANON_KEY=your_anon_key
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_WS_URL=ws://localhost:8000/v1/ws
NEXT_PUBLIC_ENABLE_PWA_IN_DEV=false
```

3. **Run Development Server**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Build for Production
```bash
npm run build
npm start
```

## 📖 Usage Guide

### Authentication Flow

**Signup (via Backend)**
```typescript
import { backendAPI } from '@/lib/backendApi';

const result = await backendAPI.signup(
  'doctor@example.com',
  'SecurePassword123!',
  'Dr. John Smith',
  '+919876543210',
  'doctor'  // 'doctor' | 'medic' | 'patient' | 'admin'
);
```

**Login (via Supabase)**
```typescript
import { authServices } from '@/lib/supabaseServices';

const result = await authServices.login('user@example.com', 'password');
```

### Using Services

**Doctor Services**
```typescript
import { doctorServices } from '@/lib/supabaseServices';

// Get case queue
const cases = await doctorServices.getQueue();

// Save SOAP notes
await doctorServices.saveSOAPNotes(consultationId, {
  subjective: "Patient reports...",
  objective: "Vitals show...",
  assessment: "Diagnosis: ...",
  plan: "Treatment: ..."
});

// Close case with risk classification
await doctorServices.closeCaseWithRisk(consultationId, 'stable');
```

**Patient Services**
```typescript
import { patientServices } from '@/lib/supabaseServices';

// Get health records
const records = await patientServices.getHealthRecords();

// Submit booking
await patientServices.submitBooking(bookingData);
```

### Offline Vitals Capture

```typescript
import { offlineVitalsDb } from '@/lib/offlineVitalsDb';

// Save vital locally
await offlineVitalsDb.saveVital({
  systolic: 120,
  diastolic: 80,
  heartRate: 72,
  temperature: 98.6,
  spo2: 98,
  timestamp: new Date()
});

// Auto-sync when online
// (Automatic - handled by sync manager)
```

### CMS Content Integration

**Server Component Example**
```typescript
import { CmsContentServerService } from '@/services/cms';

export async function HeroSection() {
  const cms = new CmsContentServerService();
  const snapshot = await cms.getPageSnapshot('home');
  
  return (
    <div className="hero">
      <h1>{snapshot.sections.hero.heading}</h1>
      <p>{snapshot.sections.hero.subheading}</p>
    </div>
  );
}
```

**Managing CMS Content**
- Access [Supabase Dashboard](https://app.supabase.com)
- Edit `cms_site_globals`, `cms_sections`, `cms_collections` tables
- Changes auto-trigger webhook → instant ISR refresh
- Or use `/admin-content` custom UI (if enabled)

## 🔌 API Integration

### Backend Endpoints

The platform uses three integration patterns:

1. **Direct Supabase** (90% of operations)
   - Queries, real-time subscriptions, auth
   - No backend calls needed

2. **Backend Auth** (Required)
   - User signup/login
   - Session management

3. **Backend Compute** (Specialized)
   - Video token generation
   - GPS WebSocket relay
   - Billing calculations

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for complete API reference.

## 🧪 Testing

### CMS Smoke Tests
```bash
npm run test:cms
```

Validates CMS schema, data fetching, and ISR mechanism.

### Manual Testing Checklist
- [ ] Auth flow works (signup/login)
- [ ] Doctor can view queue
- [ ] Field node receives dispatch alerts
- [ ] Patient can book consultation
- [ ] Vitals sync when offline
- [ ] CMS content loads from database
- [ ] PWA installs on mobile

## 📚 Documentation

- [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) - Backend integration patterns
- [SUPABASE_SETUP_GUIDE.md](./SUPABASE_SETUP_GUIDE.md) - Database initialization
- [CMS_PLAN.md](./CMS_PLAN.md) - Content management strategy
- [CMS_AGENCY_HANDOVER.md](./CMS_AGENCY_HANDOVER.md) - CMS usage for agencies
- [API_REFERENCE.md](./API_REFERENCE.md) - Service function documentation

## 🚀 Deployment

### Vercel (Recommended)

```bash
vercel deploy
```

Set environment variables in Vercel dashboard before first deploy.

### Docker

```bash
docker build -t sanocare-frontend .
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_SUPABASE_URL=... \
  -e NEXT_PUBLIC_ANON_KEY=... \
  sanocare-frontend
```

### Netlify

Connect repository → configure env vars → auto-deploy on push.

## 🏗️ Architecture Decisions

### Why Supabase?
- Built-in PostgreSQL with RLS for multi-role access
- Real-time subscriptions without complex infrastructure
- Integrated authentication reduces attack surface
- Cost-effective at scale

### Why Next.js?
- Unified frontend + API layer
- ISR for static generation with dynamic updates
- Built-in TypeScript support
- Excellent for SEO (Server Components, metadata)

### Why Zustand + React Context?
- Minimal boilerplate for state management
- Perfect for multi-portal architecture
- No prop drilling across deep component trees
- Server Component friendly

### Why Isolated CMS?
- **Zero coupling** between content and transactional logic
- **Platform independence** - content survives ops/booking changes
- **Vendor flexibility** - easy migration to Prismic, Contentful, etc.
- **Performance** - ISR caching + CDN delivery

## 🔐 Security Considerations

✅ **Implemented**
- JWT-based authentication with Supabase
- RLS policies enforce data access control
- Environment variables for sensitive keys
- HTTPS-only cookie settings
- CORS properly configured
- Input validation on all forms

⚠️ **To Review**
- Regular security audits
- Dependency scanning (npm audit)
- Penetration testing before production
- HIPAA/compliance audit if required

## 📊 Performance

- **Bundle Size:** ~150KB gzipped
- **LCP:** <2.5s (ISR cached pages)
- **FID:** <100ms
- **CLS:** <0.1
- **Accessibility:** WCAG 2.1 AA compliant
- **PWA Score:** 90+

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Follow TypeScript strict mode
4. Keep components pure and testable
5. Write meaningful commit messages
6. Submit a pull request

## 📄 License

This project is proprietary and confidential. All rights reserved.

## 🆘 Support

For issues or questions:
- 📧 Email: dev-team@sanocare.in
- 🐛 Issues: [GitHub Issues](https://github.com/sanocare/frontend/issues)
- 📞 Emergency: +91-XXXX-XXXX

---

**Last Updated:** May 2026  
**Maintained by:** SanoCare Development Team
