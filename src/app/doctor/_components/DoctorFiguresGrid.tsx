import { rupees } from "@/lib/doctorFinance";

/**
 * The three headline figures shown above the ledger. Mirrors the cards on
 * /ops/doctors/[id] verbatim — same shape, same colours — so a doctor's
 * numbers look identical to what ops sees for them.
 */
export function DoctorFiguresGrid({
  totalEarnedPaise,
  totalPaidOutPaise,
  balancePaise,
}: {
  totalEarnedPaise: number;
  totalPaidOutPaise: number;
  balancePaise: number;
}) {
  return (
    <div className="grid sm:grid-cols-3 gap-4 mb-6">
      <FigureCard
        label="Total earned"
        value={rupees(totalEarnedPaise)}
        tone="emerald"
        sub="Gross of all earning entries"
      />
      <FigureCard
        label="Total paid out"
        value={rupees(totalPaidOutPaise)}
        tone="rose"
        sub="Gross of all payout entries"
      />
      <FigureCard
        label="Current balance"
        value={rupees(balancePaise)}
        tone={balancePaise >= 0 ? "emerald" : "rose"}
        sub={balancePaise >= 0 ? "Owed to you" : "You owe Sanocare"}
        emphasis
      />
    </div>
  );
}

function FigureCard({
  label,
  value,
  sub,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  sub: string;
  tone: "emerald" | "rose";
  emphasis?: boolean;
}) {
  return (
    <div
      className={
        "rounded-2xl border p-5 " +
        (emphasis
          ? "bg-slate-900 border-slate-900 text-white"
          : "bg-white border-slate-200")
      }
    >
      <div
        className={
          "text-[11px] font-mono uppercase tracking-wider " +
          (emphasis ? "text-slate-400" : "text-slate-500")
        }
      >
        {label}
      </div>
      <div
        className={
          "text-2xl font-bold mt-1 " +
          (emphasis
            ? "text-white"
            : tone === "emerald"
              ? "text-emerald-700"
              : "text-rose-700")
        }
      >
        {value}
      </div>
      <div className={"text-xs mt-1 " + (emphasis ? "text-slate-400" : "text-slate-500")}>
        {sub}
      </div>
    </div>
  );
}
