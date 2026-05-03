"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Clock,
  MapPin,
  Phone,
  User,
  Stethoscope,
  CheckCircle,
  XCircle,
  Send,
  ExternalLink,
  Filter,
  Search,
  ArrowUpDown,
  CheckCircle2,
} from "lucide-react";
import { BookingRow, Paramedic, SERVICE_LABELS, BookingStatus } from "@/lib/supabase";

interface LivePulseMonitorProps {
  bookings: BookingRow[];
  paramedics: Paramedic[];
  onDispatch: (booking: BookingRow) => void;
  onComplete: (bookingId: string) => void;
  isDark?: boolean;
}

type StatusFilter = "ALL" | BookingStatus;

const statusConfig: Record<BookingStatus, {
  label: string;
  color: string;
  bg: string;
  border: string;
  icon: typeof Clock;
}> = {
  PENDING: {
    label: "Pending",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    icon: Clock,
  },
  DISPATCHED: {
    label: "Dispatched",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
    icon: Send,
  },
  IN_PROGRESS: {
    label: "In Progress",
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
    icon: Clock,
  },
  COMPLETED: {
    label: "Completed",
    color: "text-green-400",
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    icon: CheckCircle,
  },
  CANCELLED: {
    label: "Cancelled",
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    icon: XCircle,
  },
};

type SortOption = "newest" | "oldest" | "name" | "status";

export function LivePulseMonitor({
  bookings,
  paramedics,
  onDispatch,
  onComplete,
  isDark = true,
}: LivePulseMonitorProps) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");

  const filteredAndSortedBookings = useMemo(() => {
    let result = bookings;

    // Filter by status
    if (statusFilter !== "ALL") {
      result = result.filter((b) => b.status === statusFilter);
    }

    // Filter by search query (name or phone)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(
        (b) =>
          b.patient_name.toLowerCase().includes(query) ||
          b.phone.toLowerCase().includes(query)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case "oldest":
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        case "name":
          return a.patient_name.localeCompare(b.patient_name);
        case "status":
          const statusOrder = ["PENDING", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
          return statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status);
        default:
          return 0;
      }
    });

    return result;
  }, [bookings, statusFilter, searchQuery, sortBy]);

  const getParamedicName = (id: string | null) => {
    if (!id) return "—";
    const paramedic = paramedics.find((p) => p.id === id);
    return paramedic?.name || "Unknown";
  };

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const getGoogleMapsUrl = (booking: BookingRow) => {
    const gps = booking.gps_location as { lat: number; lng: number } | null;
    if (gps?.lat && gps?.lng) {
      return `https://www.google.com/maps?q=${gps.lat},${gps.lng}`;
    }
    // Fallback to address search
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      booking.manual_address
    )}`;
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Row */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
          <input
            type="text"
            placeholder="Search by name or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-10 pr-4 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${isDark
              ? "bg-slate-800/50 border-slate-700 text-white placeholder-slate-500"
              : "bg-white border-slate-200 text-slate-900 placeholder-slate-400"
            }`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${isDark ? "text-slate-500 hover:text-slate-300" : "text-slate-400 hover:text-slate-600"}`}
            >
              Clear
            </button>
          )}
        </div>

        {/* Sort Dropdown */}
        <div className="relative">
          <div className="flex items-center gap-2">
            <ArrowUpDown className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${isDark
                ? "bg-slate-800/50 border-slate-700 text-white"
                : "bg-white border-slate-200 text-slate-900"
              }`}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="name">Name (A-Z)</option>
              <option value="status">By Status</option>
            </select>
          </div>
        </div>
      </div>

      {/* Status Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className={`w-4 h-4 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
        {(["ALL", "PENDING", "DISPATCHED", "COMPLETED", "CANCELLED"] as StatusFilter[]).map(
          (status) => {
            const count =
              status === "ALL"
                ? bookings.length
                : bookings.filter((b) => b.status === status).length;
            const config = status !== "ALL" ? statusConfig[status] : null;

            return (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  statusFilter === status
                    ? config
                      ? `${config.bg} ${config.color} ${config.border} border`
                      : isDark ? "bg-slate-700 text-white" : "bg-slate-200 text-slate-900"
                    : isDark ? "bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-slate-300" : "bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                }`}
              >
                {status === "ALL" ? "All" : config?.label} ({count})
              </button>
            );
          }
        )}
        {searchQuery && (
          <span className={`text-sm ${isDark ? "text-slate-500" : "text-slate-400"}`}>
            · {filteredAndSortedBookings.length} result{filteredAndSortedBookings.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Bookings Table */}
      <div className={`rounded-xl overflow-hidden border ${isDark ? "bg-slate-800/30 border-slate-700" : "bg-white border-slate-200 shadow-sm"}`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className={`border-b ${isDark ? "border-slate-700" : "border-slate-200"}`}>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Alert
                </th>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Patient Info
                </th>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Service
                </th>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Location
                </th>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Status
                </th>
                <th className={`px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Assigned
                </th>
                <th className={`px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider ${isDark ? "text-slate-400" : "text-slate-500"}`}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody className={`divide-y ${isDark ? "divide-slate-700/50" : "divide-slate-100"}`}>
              {filteredAndSortedBookings.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center">
                    <div className={isDark ? "text-slate-500" : "text-slate-400"}>
                      <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                      <p>{searchQuery ? "No matching bookings found" : "No bookings found"}</p>
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="text-primary hover:underline text-sm mt-1"
                        >
                          Clear search
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredAndSortedBookings.map((booking, idx) => {
                  const config = statusConfig[booking.status];
                  const StatusIcon = config.icon;
                  const isPending = booking.status === "PENDING";
                  const isDispatched = booking.status === "DISPATCHED";

                  return (
                    <motion.tr
                      key={booking.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.02 }}
                      className={`transition-colors ${
                        isDark ? "hover:bg-slate-700/20" : "hover:bg-slate-50"
                      } ${isPending ? "bg-amber-500/5" : ""}`}
                    >
                      {/* Alert Column */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <span className="size-2 rounded-full bg-red-500 animate-pulse" />
                          )}
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                            {formatTime(booking.created_at)}
                          </span>
                        </div>
                      </td>

                      {/* Patient Info */}
                      <td className="px-4 py-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <User className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                            <span className={`text-sm font-medium ${isDark ? "text-white" : "text-slate-900"}`}>
                              {booking.patient_name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Phone className={`w-3.5 h-3.5 ${isDark ? "text-slate-500" : "text-slate-400"}`} />
                            <a
                              href={`tel:${booking.phone}`}
                              className={`text-xs hover:text-primary transition-colors ${isDark ? "text-slate-400" : "text-slate-500"}`}
                            >
                              {booking.phone}
                            </a>
                          </div>
                        </div>
                      </td>

                      {/* Service */}
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2">
                          <Stethoscope className="w-3.5 h-3.5 text-primary" />
                          <span className={`text-sm ${isDark ? "text-slate-300" : "text-slate-700"}`}>
                            {SERVICE_LABELS[booking.service_category] || booking.service_category}
                          </span>
                        </div>
                        {booking.amount && (
                          <span className={`text-xs ${isDark ? "text-slate-500" : "text-slate-400"}`}>
                            ₹{booking.amount.toLocaleString()}
                          </span>
                        )}
                      </td>

                      {/* Location */}
                      <td className="px-4 py-4">
                        <div className="max-w-48">
                          <p className={`text-sm line-clamp-2 ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                            {booking.manual_address}
                          </p>
                          <a
                            href={getGoogleMapsUrl(booking)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 mt-1 text-xs text-primary hover:text-primary-dark hover:underline transition-colors"
                          >
                            <span>📍</span>
                            <span>Open in Maps</span>
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        <div
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ${config.bg} ${config.border} border`}
                        >
                          <StatusIcon className={`w-3.5 h-3.5 ${config.color}`} />
                          <span className={`text-xs font-medium ${config.color}`}>
                            {config.label}
                          </span>
                        </div>
                      </td>

                      {/* Assigned */}
                      <td className="px-4 py-4">
                        <span className={`text-sm ${isDark ? "text-slate-400" : "text-slate-600"}`}>
                          {getParamedicName(booking.assigned_paramedic_id ?? null)}
                        </span>
                        {booking.dispatched_at && (
                          <p className="text-xs text-slate-500">
                            {formatTime(booking.dispatched_at)}
                          </p>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-4 text-right">
                        {isPending ? (
                          <button
                            onClick={() => onDispatch(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary hover:bg-primary-dark text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                            Dispatch
                          </button>
                        ) : isDispatched ? (
                          <button
                            onClick={() => onComplete(booking.id)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            End Visit
                          </button>
                        ) : (
                          <span className={`text-xs ${isDark ? "text-slate-600" : "text-slate-400"}`}>—</span>
                        )}
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(statusConfig).map(([status, config]) => {
          const count = bookings.filter((b) => b.status === status).length;
          const Icon = typeof config.icon === "function" ? config.icon : Clock;
          return (
            <div
              key={status}
              className={`${config.bg} ${config.border} border rounded-xl p-4`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-2xl font-bold ${config.color}`}>{count}</p>
                  <p className="text-sm text-slate-400">{config.label}</p>
                </div>
                <Icon className={`w-8 h-8 ${config.color} opacity-50`} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
