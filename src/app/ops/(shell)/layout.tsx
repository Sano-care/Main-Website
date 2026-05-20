import { OpsShell } from "../_components/OpsShell";
import { getCurrentOpsUser } from "../_lib/getCurrentOpsUser";

export const dynamic = "force-dynamic";

export default async function ShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const opsUser = await getCurrentOpsUser();
  return (
    <OpsShell
      fullName={opsUser.full_name}
      email={opsUser.email}
      role={opsUser.role}
    >
      {children}
    </OpsShell>
  );
}
