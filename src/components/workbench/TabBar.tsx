import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { tabKey, type WorkbenchTab } from "./tabs";

export interface TabBarProps {
  tabs: WorkbenchTab[];
  activeKey: string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  className?: string;
}

/** The horizontal tab strip across the top of the workspace. */
export function TabBar({ tabs, activeKey, onSelect, onClose, className }: TabBarProps) {
  return (
    <div
      className={cn("flex items-stretch overflow-x-auto border-b bg-muted/30", className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const key = tabKey(tab);
        const active = key === activeKey;
        return (
          <div
            key={key}
            className={cn(
              "group/tab flex shrink-0 items-center gap-1.5 border-r pr-1.5 pl-3 text-sm transition-colors",
              active
                ? "border-b-2 border-b-primary bg-background font-medium"
                : "text-muted-foreground hover:bg-background/60",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(key)}
              className="max-w-48 truncate py-2"
              title={tab.name}
            >
              {tab.name}
            </button>
            <button
              type="button"
              title="Close tab"
              aria-label={`Close ${tab.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(key);
              }}
              className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/tab:opacity-100 aria-[selected]:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default TabBar;
