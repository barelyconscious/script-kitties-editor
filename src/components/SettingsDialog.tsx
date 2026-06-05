import { Settings } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";

export function SettingsDialog({
  trigger,
  tooltipLabel,
  tooltipSide = "right",
}: {
  trigger?: ReactNode;
  tooltipLabel?: string;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}) {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const triggerNode = trigger ?? (
    <Button variant="outline" size="icon" aria-label="Settings">
      <Settings />
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {tooltipLabel ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>{triggerNode}</DialogTrigger>
          </TooltipTrigger>
          <TooltipContent side={tooltipSide}>{tooltipLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <DialogTrigger asChild>{triggerNode}</DialogTrigger>
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Customize how the app looks and behaves.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <SettingRow
            label="Dark mode"
            description="Use a darker color palette."
            htmlFor="theme-switch"
          >
            <Switch
              id="theme-switch"
              checked={theme === "dark"}
              onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
            />
          </SettingRow>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingRow({
  label,
  description,
  htmlFor,
  children,
}: {
  label: string;
  description?: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-0.5">
        <Label htmlFor={htmlFor} className="font-medium text-sm">
          {label}
        </Label>
        {description && (
          <p className="text-muted-foreground text-xs">{description}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export default SettingsDialog;
