"use client";

// Tree-shaken Chart.js line chart for the Pulse vitals trends tab.
//
// We register ONLY the controllers/elements/scales/plugins this one chart
// needs (T62 §step 1) so the bundle never pulls the bar/pie/radar machinery:
//   LineController, LineElement, PointElement, LinearScale, TimeScale,
//   CategoryScale, Tooltip, Filler.
//
// The x-axis is driven by CategoryScale with pre-formatted IST labels (built
// by the caller via formatIST) rather than TimeScale's date parsing — that
// keeps every visible date/time on the single IST formatter and avoids
// pulling a chartjs date-adapter dependency. TimeScale is still registered
// per the build spec; it just isn't the active axis type.
//
// Blood pressure renders two lines (systolic + diastolic); every other kind
// renders a single line. Colours come from the design tokens so the chart
// stays in lockstep with the rest of the surface.
//
// Reduced motion: when the user prefers reduced motion we disable the chart's
// entrance animation (animation:false) so nothing sweeps in.

import { useMemo } from "react";
import {
  Chart as ChartJS,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Filler,
  type ChartData,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { useReducedMotion } from "framer-motion";

import { colors } from "@/lib/design/tokens";

ChartJS.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  TimeScale,
  CategoryScale,
  Tooltip,
  Filler,
);

export interface TrendPoint {
  /** Pre-formatted IST label for the x-axis (formatIST output). */
  label: string;
  primary: number;
  /** Diastolic for BP; null/undefined for single-value kinds. */
  secondary?: number | null;
}

export function VitalsTrendChart({
  points,
  isBp,
  unitLabel,
}: {
  points: TrendPoint[];
  isBp: boolean;
  unitLabel: string;
}) {
  const prefersReducedMotion = useReducedMotion();

  const data = useMemo<ChartData<"line">>(() => {
    const labels = points.map((p) => p.label);
    const systolic = {
      label: isBp ? "Systolic" : unitLabel,
      data: points.map((p) => p.primary),
      borderColor: isBp ? colors.status.danger : colors.primary.DEFAULT,
      backgroundColor: isBp
        ? "rgba(225, 29, 72, 0.10)"
        : "rgba(43, 129, 255, 0.10)",
      fill: true,
      tension: 0.35,
      pointRadius: 3,
      pointHoverRadius: 5,
      borderWidth: 2.4,
      pointBackgroundColor: isBp ? colors.status.danger : colors.primary.DEFAULT,
    };
    const datasets = [systolic];
    if (isBp) {
      datasets.push({
        label: "Diastolic",
        data: points.map((p) => (p.secondary ?? null) as number),
        borderColor: colors.primary.DEFAULT,
        backgroundColor: "rgba(43, 129, 255, 0.08)",
        fill: true,
        tension: 0.35,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2.4,
        pointBackgroundColor: colors.primary.DEFAULT,
      });
    }
    return { labels, datasets };
  }, [points, isBp, unitLabel]);

  const options = useMemo<ChartOptions<"line">>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReducedMotion ? false : { duration: 400 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: colors.text.main,
          padding: 10,
          cornerRadius: 8,
          titleFont: { size: 11 },
          bodyFont: { size: 12, weight: 600 },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 10 },
            color: colors.text.secondary,
            maxRotation: 0,
            autoSkipPadding: 12,
          },
        },
        y: {
          grid: { color: colors.line },
          ticks: { font: { size: 10 }, color: colors.text.secondary },
          beginAtZero: false,
        },
      },
    }),
    [prefersReducedMotion],
  );

  return (
    <div className="relative h-[180px] w-full">
      <Line data={data} options={options} aria-label="Vitals trend chart" />
    </div>
  );
}
