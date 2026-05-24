"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertCircle, CheckCircle2, MapPin, Search, X, Loader2, Tag, Video } from "lucide-react";
import { LabTestSearch } from "@/components/lab/LabTestSearch";
import { useBookingStore } from "@/store/bookingStore";
import type { AppliedCoupon } from "@/types/lab-coupon";
import {
  createBooking,
  lookupCustomer,
  resolveShortMapsLink,
  type CustomerLookupResult,
} from "../actions";
import { SERVICE_CATEGORIES } from "../../../_lib/bookingStatus";

type Mode = "existing" | "new";

type MatchedCustomer = {
  id: string;
  customer_code: string;
  full_name: string;
  phone: string;
};

type ParsedLocation = { lat: number; lng: number };

export type ActiveDoctorOption = {
  id: string;
  doctor_code: string;
  full_name: string;
  duty_room_join_url: string | null;
};

// =====================================================================
// Location parsing
// =====================================================================

/**
 * Pull lat/lng out of a Google Maps URL or a raw "lat,lng" paste.
 * Supports:
 *   - "28.5355, 77.2412" (or with spaces / no space)
 *   - https://www.google.com/maps?q=28.5,77.2
 *   - https://www.google.com/maps/@28.5,77.2,15z
 *   - https://maps.google.com/?ll=28.5,77.2
 *   - https://www.google.com/maps/place/.../data=...!3d28.5!4d77.2
 *
 * Does NOT resolve short URLs (goo.gl/maps, maps.app.goo.gl) — those
 * require following a redirect from a server. Ops needs to open the
 * short link in a browser and copy the expanded URL or the coords.
 */
function parseLocationInput(input: string): ParsedLocation | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const tryPair = (latStr: string, lngStr: string): ParsedLocation | null => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 &&
      lat <= 90 &&
      lng >= -180 &&
      lng <= 180
    ) {
      return { lat, lng };
    }
    return null;
  };

  // 1. Bare "lat,lng"
  const direct = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (direct) {
    const p = tryPair(direct[1], direct[2]);
    if (p) return p;
  }

  // 2. ?q=lat,lng
  const q = trimmed.match(/[?&]q=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (q) {
    const p = tryPair(q[1], q[2]);
    if (p) return p;
  }

  // 3. @lat,lng,zoom
  const at = trimmed.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) {
    const p = tryPair(at[1], at[2]);
    if (p) return p;
  }

  // 4. ?ll=lat,lng
  const ll = trimmed.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (ll) {
    const p = tryPair(ll[1], ll[2]);
    if (p) return p;
  }

  // 5. !3dLAT!4dLNG — Google's encoded place-link format
  const place = trimmed.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (place) {
    const p = tryPair(place[1], place[2]);
    if (p) return p;
  }

  return null;
}

/**
 * True iff the input parses as a URL whose host is one of Google's
 * Maps short-link / canonical hosts. The form uses this to decide
 * whether to call resolveShortMapsLink() server-side on blur.
 */
function isShortMapsUrl(input: string): boolean {
  try {
    const u = new URL(input.trim());
    return (
      u.host === "maps.app.goo.gl" ||
      u.host === "goo.gl" ||
      u.host === "g.co" ||
      // Long URLs sometimes arrive without coordinates in the first
      // visible form (e.g. /maps/place/Foo before the redirect chain
      // expands data=...). Letting the server follow them is harmless.
      u.host === "www.google.com" ||
      u.host === "maps.google.com"
    );
  } catch {
    return false;
  }
}

function osmEmbedUrl(lat: number, lng: number, padding = 0.005): string {
  const left = lng - padding;
  const right = lng + padding;
  const bottom = lat - padding;
  const top = lat + padding;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${lat}%2C${lng}`;
}

function osmLinkUrl(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}

// =====================================================================
// Component
// =====================================================================

export function NewBookingForm({
  activeDoctors,
}: {
  activeDoctors: ActiveDoctorOption[];
}) {
  // ---- Customer mode + lookup state ----
  const [mode, setMode] = useState<Mode>("existing");
  const [lookupQuery, setLookupQuery] = useState("");
  const [matched, setMatched] = useState<MatchedCustomer | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, startLookup] = useTransition();

  // ---- Service ----
  const [service, setService] = useState<string>("");

  // ---- Teleconsult-only state (C2) ----
  // Doctor selector for teleconsult bookings. The action requires
  // doctor_id when service_category === 'teleconsult' and refuses to
  // create the consultation_session if the selected doctor has no
  // duty_room_join_url yet.
  const [doctorId, setDoctorId] = useState<string>("");

  // ---- Location ----
  const [locationInput, setLocationInput] = useState("");
  const [parsedLocation, setParsedLocation] = useState<ParsedLocation | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isResolvingShortLink, startShortLinkResolve] = useTransition();

  // ---- Diagnostics basket (shared zustand store) ----
  const selectedTests = useBookingStore((s) => s.selectedTests);
  const appliedCoupon = useBookingStore((s) => s.appliedCoupon);
  const clearSelectedTests = useBookingStore((s) => s.clearSelectedTests);
  const clearAppliedCoupon = useBookingStore((s) => s.clearAppliedCoupon);

  // Reset basket on mount so ops doesn't inherit state from a public-site
  // session in a previous tab. Only on mount — patient might switch service
  // category back and forth, and we don't want to lose what they added.
  const didResetBasket = useRef(false);
  useEffect(() => {
    if (didResetBasket.current) return;
    didResetBasket.current = true;
    clearSelectedTests();
    clearAppliedCoupon();
  }, [clearSelectedTests, clearAppliedCoupon]);

  // ---- Submit ----
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  // ---- Derived: form validity ----
  const customerReady =
    mode === "existing" ? matched !== null : true; // for "new", server validates fields
  const locationReady = parsedLocation !== null;
  const diagnosticsBasketReady =
    service !== "diagnostics" || selectedTests.length > 0;
  // Teleconsult: doctor selection required. The DB and server action also
  // enforce this — the consultation_session FK requires a doctor — but
  // we gate at the form level too so ops sees an explicit "pick a
  // doctor" before submit.
  const teleconsultReady = service !== "teleconsult" || doctorId !== "";
  const selectedDoctor = useMemo(
    () => activeDoctors.find((d) => d.id === doctorId) ?? null,
    [activeDoctors, doctorId],
  );
  const serviceReady = service !== "";
  const canSubmit =
    customerReady &&
    serviceReady &&
    locationReady &&
    diagnosticsBasketReady &&
    teleconsultReady &&
    !isSubmitting &&
    !isResolvingShortLink;

  // ---- Handlers ----

  const handleLookup = () => {
    setLookupError(null);
    startLookup(async () => {
      const result: CustomerLookupResult = await lookupCustomer(lookupQuery);
      if (result.ok) {
        setMatched(result.customer);
      } else {
        setMatched(null);
        setLookupError(result.error);
      }
    });
  };

  const handleClearMatch = () => {
    setMatched(null);
    setLookupError(null);
    setLookupQuery("");
  };

  const handleLocationChange = (v: string) => {
    setLocationInput(v);
    setLocationError(null);
    if (!v.trim()) {
      setParsedLocation(null);
      return;
    }
    const p = parseLocationInput(v);
    if (p) {
      setParsedLocation(p);
    } else {
      setParsedLocation(null);
      // Don't show an error while ops is still typing — only on blur.
    }
  };

  const handleLocationBlur = () => {
    const v = locationInput.trim();
    if (!v) return;
    if (parsedLocation) return; // already resolved synchronously

    // Short Maps URLs (Share button output) — follow the redirect server-side.
    if (isShortMapsUrl(v)) {
      setLocationError(null);
      startShortLinkResolve(async () => {
        const result = await resolveShortMapsLink(v);
        if (result.ok) {
          setParsedLocation({ lat: result.lat, lng: result.lng });
        } else {
          setLocationError(result.error);
        }
      });
      return;
    }

    setLocationError(
      "Couldn't parse coordinates from that. Paste a Google Maps link (long URL or Share-button short link) or “lat, lng” (e.g. 28.5355, 77.2412).",
    );
  };

  const handleSubmit = (formData: FormData) => {
    setSubmitError(null);
    // Inject the React-state values the server action needs.
    if (parsedLocation) {
      formData.set(
        "gps_location",
        JSON.stringify({
          lat: parsedLocation.lat,
          lng: parsedLocation.lng,
          accuracy: 0,
        }),
      );
    }
    if (mode === "existing" && matched) {
      formData.set("customer_id", matched.id);
    }
    if (service === "diagnostics") {
      formData.set("selected_tests", JSON.stringify(selectedTests));
      if (appliedCoupon) {
        formData.set(
          "applied_coupon",
          JSON.stringify({
            code: appliedCoupon.code,
            discount_percent: appliedCoupon.discount_percent,
            discount_inr: appliedCoupon.discount_inr,
          }),
        );
      }
    }
    // C2: teleconsult-only — inject the picked doctor id. The action
    // validates doctor_id presence + active state + duty_room_join_url.
    if (service === "teleconsult" && doctorId) {
      formData.set("doctor_id", doctorId);
    }

    startSubmit(async () => {
      try {
        await createBooking(formData);
      } catch (e) {
        if (e && typeof e === "object" && "digest" in e) throw e;
        setSubmitError(e instanceof Error ? e.message : "Could not create booking");
      }
    });
  };

  return (
    <form action={handleSubmit} className="space-y-6">
      {submitError && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-4 py-3">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{submitError}</div>
        </div>
      )}

      <input type="hidden" name="customer_mode" value={mode} />

      {/* ============================== Patient ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Patient
        </legend>

        <div className="flex gap-2 mb-5">
          <ModeButton
            label="Existing patient"
            active={mode === "existing"}
            onClick={() => setMode("existing")}
          />
          <ModeButton
            label="Create new patient"
            active={mode === "new"}
            onClick={() => {
              setMode("new");
              handleClearMatch();
            }}
          />
        </div>

        {mode === "existing" ? (
          <ExistingPatientLookup
            query={lookupQuery}
            setQuery={setLookupQuery}
            matched={matched}
            error={lookupError}
            isLookingUp={isLookingUp}
            onLookup={handleLookup}
            onClear={handleClearMatch}
            onSwitchToNew={() => setMode("new")}
          />
        ) : (
          <NewPatientFields />
        )}
      </fieldset>

      {/* ============================== Service ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Service
        </legend>
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Service *
          </span>
          <select
            name="service_category"
            required
            value={service}
            onChange={(e) => setService(e.target.value)}
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          >
            <option value="" disabled>
              Select…
            </option>
            {SERVICE_CATEGORIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* ============================== Teleconsult-only fields (C2) ============================== */}
      {service === "teleconsult" && (
        <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Teleconsultation
          </legend>
          <p className="text-xs text-slate-500 inline-flex items-start gap-1.5">
            <Video className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              The patient will receive a WhatsApp link to join the doctor&apos;s
              Zoom Duty Room. Make sure the patient&apos;s phone on file is
              correct — that&apos;s where the link goes.
            </span>
          </p>
          <label className="block">
            <span className="block text-xs font-medium text-slate-700 mb-1">
              Doctor *
            </span>
            <select
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              required
              className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
            >
              <option value="" disabled>
                Select a doctor…
              </option>
              {activeDoctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name} ({d.doctor_code})
                  {!d.duty_room_join_url ? "  — no Duty Room URL set" : ""}
                </option>
              ))}
            </select>
            {activeDoctors.length === 0 && (
              <span className="block text-[11px] text-amber-700 mt-1">
                No active doctors on file. Create one via /ops/doctors first.
              </span>
            )}
            {selectedDoctor && !selectedDoctor.duty_room_join_url && (
              <span className="block text-[11px] text-amber-700 mt-1">
                {selectedDoctor.full_name} doesn&apos;t have a Duty Room URL
                set yet. Either pick another doctor or set their URL on
                /ops/doctors/{selectedDoctor.id} first.
              </span>
            )}
          </label>
          <p className="text-[11px] text-slate-500">
            Tip: set the consultation time in the Booking details section
            below — it becomes the patient&apos;s scheduled slot and the join
            link&apos;s 24-hour expiry is measured from it.
          </p>
        </fieldset>
      )}

      {/* ============================== Diagnostics basket ============================== */}
      {service === "diagnostics" && (
        <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
          <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Lab tests
          </legend>
          <p className="text-xs text-slate-500">
            Search and add tests the patient asked for. Coupons apply the same
            way they do on /lab-tests. No payment is collected here — the
            booking goes to PENDING_COLLECTION.
          </p>
          <LabTestSearch
            variant="compact"
            placeholder="Search lab tests by name or code…"
          />
          <OpsBasket />
        </fieldset>
      )}

      {/* ============================== Location ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Location
        </legend>
        <LocationField
          value={locationInput}
          onChange={handleLocationChange}
          onBlur={handleLocationBlur}
          parsed={parsedLocation}
          error={locationError}
          isResolving={isResolvingShortLink}
        />
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Flat / floor / landmark (optional)
          </span>
          <textarea
            name="manual_address"
            rows={2}
            placeholder="E.g. Flat 302, A-Block, near the swimming pool"
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
          <span className="block text-[11px] text-slate-500 mt-1">
            Supplementary to the pin above — anything the paramedic needs to
            actually reach the door.
          </span>
        </label>
      </fieldset>

      {/* ============================== Booking details ============================== */}
      <fieldset className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4">
        <legend className="px-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
          Booking details
        </legend>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field
            label="Scheduled for"
            name="scheduled_for"
            type="datetime-local"
          />
          {service !== "diagnostics" && (
            <Field
              label="Amount (₹)"
              name="amount"
              type="number"
              placeholder="Optional"
            />
          )}
        </div>
        <Field
          label="Partner (optional)"
          name="partner_lookup"
          placeholder="SAN-P-00001 or full UUID"
          mono
        />
        <Field
          label="Ops notes (internal)"
          name="ops_notes"
          multiline
          placeholder="Call details, special instructions, etc."
        />
        <p className="text-xs text-slate-500 pt-1">
          Status starts at{" "}
          <span className="font-mono">
            {service === "diagnostics" ? "PENDING_COLLECTION" : "PENDING"}
          </span>
          .
          {service === "teleconsult" && (
            <>
              {" "}A consultation session + tokened WhatsApp join link are
              created automatically.
            </>
          )}
        </p>
      </fieldset>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit}
          className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
        >
          {isSubmitting ? "Creating…" : "Create booking"}
        </button>
        <a
          href="/ops/bookings"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          Cancel
        </a>
      </div>
    </form>
  );
}

// =====================================================================
// Existing-patient lookup (search bar + confirm panel)
// =====================================================================

function ExistingPatientLookup({
  query,
  setQuery,
  matched,
  error,
  isLookingUp,
  onLookup,
  onClear,
  onSwitchToNew,
}: {
  query: string;
  setQuery: (v: string) => void;
  matched: MatchedCustomer | null;
  error: string | null;
  isLookingUp: boolean;
  onLookup: () => void;
  onClear: () => void;
  onSwitchToNew: () => void;
}) {
  if (matched) {
    return (
      <div className="space-y-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 truncate">
                  {matched.full_name}
                </div>
                <div className="text-xs text-slate-600 font-mono mt-0.5">
                  {matched.customer_code} · {matched.phone}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-slate-500 hover:text-slate-900 shrink-0"
            >
              Use different
            </button>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">
          Confirm this is the right person before submitting — the booking will
          be filed under this SAN-C code.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-slate-700">
        Mobile or SAN-C code *
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onLookup();
              }
            }}
            placeholder="9876543210 or SAN-C-00012"
            className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          />
        </div>
        <button
          type="button"
          onClick={onLookup}
          disabled={isLookingUp || !query.trim()}
          className="bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
        >
          {isLookingUp ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Looking up…
            </>
          ) : (
            "Look up"
          )}
        </button>
      </div>
      {error && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <div>{error}</div>
            <button
              type="button"
              onClick={onSwitchToNew}
              className="mt-1 text-xs font-medium underline hover:text-amber-900"
            >
              Switch to “Create new patient”
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// New-patient fields (same shape as M1's createCustomer form)
// =====================================================================

function NewPatientFields() {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full name *" name="customer_full_name" required />
        <Field
          label="Phone *"
          name="customer_phone"
          type="tel"
          required
          placeholder="10-digit Indian mobile"
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Email" name="customer_email" type="email" />
        <Field label="Date of birth" name="customer_date_of_birth" type="date" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-xs font-medium text-slate-700 mb-1">
            Gender
          </span>
          <select
            name="customer_gender"
            defaultValue=""
            className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
          >
            <option value="">—</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="other">Other</option>
            <option value="prefer_not_to_say">Prefer not to say</option>
          </select>
        </label>
        <Field label="Pincode" name="customer_pincode" />
      </div>
      <Field
        label="Customer address (saved on the patient record)"
        name="customer_address_line"
        multiline
      />
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Area" name="customer_area" />
        <Field label="City" name="customer_city" />
      </div>
      <Field
        label="Customer notes (saved on the patient record)"
        name="customer_notes"
        multiline
      />
    </div>
  );
}

// =====================================================================
// Location field with OSM preview
// =====================================================================

function LocationField({
  value,
  onChange,
  onBlur,
  parsed,
  error,
  isResolving,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  parsed: ParsedLocation | null;
  error: string | null;
  isResolving: boolean;
}) {
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="block text-xs font-medium text-slate-700 mb-1">
          Google Maps link or lat, long *
        </span>
        <div className="relative">
          <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
            disabled={isResolving}
            placeholder="https://maps.app.goo.gl/...  or  https://maps.google.com/?q=lat,lng  or  28.5355, 77.2412"
            className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-10 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-500"
          />
          {isResolving && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
          )}
        </div>
        <span className="block text-[11px] text-slate-500 mt-1">
          Required. <span className="font-mono">maps.app.goo.gl</span> /{" "}
          <span className="font-mono">goo.gl/maps</span> short links are
          followed server-side to extract the pin — paste and tab away.
        </span>
      </label>

      {error && (
        <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {parsed && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-xs text-emerald-700">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span className="font-mono">
                {parsed.lat.toFixed(6)}, {parsed.lng.toFixed(6)}
              </span>
            </div>
            <a
              href={osmLinkUrl(parsed.lat, parsed.lng)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-slate-500 hover:text-slate-900 underline"
            >
              Open on OpenStreetMap
            </a>
          </div>
          <div className="rounded-lg overflow-hidden border border-slate-200 bg-white">
            <iframe
              title="Location preview"
              src={osmEmbedUrl(parsed.lat, parsed.lng)}
              width="100%"
              height="240"
              style={{ border: 0, display: "block" }}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Ops basket — slim display reading the same Zustand store as the
// public /lab-tests basket. Calls the same coupon API.
// =====================================================================

function OpsBasket() {
  const selectedTests = useBookingStore((s) => s.selectedTests);
  const removeSelectedTest = useBookingStore((s) => s.removeSelectedTest);
  const appliedCoupon = useBookingStore((s) => s.appliedCoupon);
  const setAppliedCoupon = useBookingStore((s) => s.setAppliedCoupon);
  const clearAppliedCoupon = useBookingStore((s) => s.clearAppliedCoupon);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  const subtotal = useMemo(
    () => selectedTests.reduce((s, t) => s + (t.price || 0), 0),
    [selectedTests],
  );
  const final = appliedCoupon ? appliedCoupon.final_inr : subtotal;
  const discount = appliedCoupon?.discount_inr ?? 0;

  async function handleApplyCoupon(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setBusy(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/lab/validate-coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, subtotalInr: subtotal }),
      });
      const data = await res.json();
      if (data.ok) {
        const applied: AppliedCoupon = {
          code: data.code,
          discount_percent: data.discountPercent,
          discount_inr: data.discountInr,
          final_inr: data.finalInr,
          description: data.description,
        };
        setAppliedCoupon(applied);
        setFeedback({
          ok: true,
          msg: `${data.discountPercent}% off · save ₹${data.discountInr.toLocaleString("en-IN")}`,
        });
      } else {
        setFeedback({ ok: false, msg: data.error || "Coupon invalid" });
      }
    } catch {
      setFeedback({ ok: false, msg: "Couldn't validate the coupon. Try again." });
    } finally {
      setBusy(false);
    }
  }

  if (selectedTests.length === 0) {
    return (
      <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg p-4 text-center">
        Add at least one test using the search above.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
        {selectedTests.map((t) => (
          <li key={t.code} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div className="min-w-0">
              <div className="font-medium text-slate-900 leading-tight">{t.name}</div>
              <div className="text-xs text-slate-500 mt-0.5 font-mono">
                {t.code}
                {t.tat ? <> · {t.tat}</> : null}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-semibold text-slate-900">
                ₹{t.price.toLocaleString("en-IN")}
              </span>
              <button
                type="button"
                onClick={() => removeSelectedTest(t.code)}
                className="p-1 text-slate-400 hover:text-rose-600 transition-colors"
                aria-label={`Remove ${t.name}`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Coupon */}
      {!appliedCoupon ? (
        <form onSubmit={handleApplyCoupon} className="flex gap-2">
          <div className="relative flex-1">
            <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Coupon code"
              className="w-full bg-white border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent"
              maxLength={32}
            />
          </div>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="bg-slate-700 hover:bg-slate-900 disabled:bg-slate-300 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Apply"}
          </button>
        </form>
      ) : (
        <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm">
          <div>
            <span className="font-semibold text-emerald-800">{appliedCoupon.code}</span>{" "}
            <span className="text-emerald-700">applied · {appliedCoupon.discount_percent}% off</span>
          </div>
          <button
            type="button"
            onClick={() => {
              clearAppliedCoupon();
              setCode("");
              setFeedback(null);
            }}
            className="text-xs text-slate-500 hover:text-rose-600"
          >
            Remove
          </button>
        </div>
      )}
      {feedback && (
        <div
          className={
            "flex items-start gap-2 text-xs " +
            (feedback.ok ? "text-emerald-700" : "text-rose-600")
          }
        >
          {feedback.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          )}
          <span>{feedback.msg}</span>
        </div>
      )}

      {/* Totals */}
      <div className="border-t border-slate-200 pt-3 space-y-1 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Subtotal</span>
          <span>₹{subtotal.toLocaleString("en-IN")}</span>
        </div>
        {appliedCoupon && (
          <div className="flex justify-between text-emerald-700">
            <span>Discount</span>
            <span>− ₹{discount.toLocaleString("en-IN")}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
          <span>Total (after report)</span>
          <span>₹{final.toLocaleString("en-IN")}</span>
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
          ₹0 charged at booking · paid after the report is ready
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Small UI primitives
// =====================================================================

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "text-sm font-medium px-4 py-2 rounded-lg transition-colors " +
        (active
          ? "bg-slate-900 text-white"
          : "bg-slate-100 text-slate-700 hover:bg-slate-200")
      }
    >
      {label}
    </button>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  multiline,
  placeholder,
  mono,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  multiline?: boolean;
  placeholder?: string;
  mono?: boolean;
}) {
  const id = `f-${name}`;
  const inputCls =
    "w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent" +
    (mono ? " font-mono" : "");
  return (
    <label htmlFor={id} className="block">
      <span className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </span>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          required={required}
          placeholder={placeholder}
          className={inputCls}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          required={required}
          placeholder={placeholder}
          className={inputCls}
        />
      )}
    </label>
  );
}
