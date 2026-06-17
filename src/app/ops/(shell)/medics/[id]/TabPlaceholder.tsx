// T65 Phase 2B C3-full — placeholder for tabs that land in C4 + C5.
// Renders the tab shell so navigation works end-to-end visually.

interface TabPlaceholderProps {
  title: string;
  comingIn: "C4" | "C5a" | "C5b";
}

export function TabPlaceholder({ title, comingIn }: TabPlaceholderProps) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
      <div className="text-[11px] font-mono uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </div>
      <div className="text-slate-700">Loading in {comingIn}</div>
      <p className="mt-2 text-xs text-slate-500 max-w-md mx-auto">
        Tab shell is in place; data wiring lands in the next commit on this PR.
      </p>
    </div>
  );
}
