import { Database, Hammer, Library, Settings } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { SettingsDialog } from "@/components/SettingsDialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type NavRailTool = "workbench" | "data-tables" | "registry";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const TOOLS: { id: NavRailTool; label: string; icon: IconComponent }[] = [
  { id: "workbench", label: "Workbench", icon: Hammer },
  { id: "data-tables", label: "Data Tables", icon: Database },
  { id: "registry", label: "Registry", icon: Library },
];

export function NavRail({
  active,
  onSelect,
}: {
  active?: NavRailTool;
  onSelect?: (tool: NavRailTool) => void;
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center justify-between border-r bg-sidebar py-3">
      <nav aria-label="Tools" className="flex flex-col items-center gap-1">
        {TOOLS.map(({ id, label, icon: Icon }) => (
          <RailButton
            key={id}
            label={label}
            isActive={active === id}
            onClick={() => onSelect?.(id)}
          >
            <Icon className="size-5" aria-hidden="true" />
          </RailButton>
        ))}
      </nav>

      <SettingsDialog
        tooltipLabel="Settings"
        trigger={
          <button
            type="button"
            aria-label="Settings"
            className="flex size-10 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <Settings className="size-5" aria-hidden="true" />
          </button>
        }
      />
    </aside>
  );
}

function RailButton({
  label,
  isActive,
  onClick,
  children,
}: {
  label: string;
  isActive?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative flex w-full items-center justify-center">
      {isActive && (
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-0 h-6 w-0.5 -translate-y-1/2 rounded-r-full bg-primary"
        />
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex size-10 items-center justify-center rounded-md text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
              isActive &&
                "bg-sidebar-accent text-sidebar-accent-foreground hover:bg-sidebar-accent",
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export default NavRail;
