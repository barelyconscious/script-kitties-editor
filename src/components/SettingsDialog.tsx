import { invoke } from "@tauri-apps/api/core";
import { Loader2, RefreshCw, Settings } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";

/** Mirror of the Rust `ManifestUpdate` returned by `update_asset_manifest`. */
type ManifestUpdate = {
  total: number;
  added: string[];
  updated: string[];
  removed: string[];
};

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
  const [updating, setUpdating] = useState(false);
  const [assetStatus, setAssetStatus] = useState<string | null>(null);

  const handleUpdateAssets = async () => {
    setUpdating(true);
    setAssetStatus(null);
    try {
      const result = await invoke<ManifestUpdate>("update_asset_manifest");
      setAssetStatus(
        `Done — ${result.added.length} added, ${result.updated.length} updated, ` +
          `${result.removed.length} removed (${result.total} total).`,
      );
    } catch (err) {
      setAssetStatus(`Failed: ${String(err)}`);
    } finally {
      setUpdating(false);
    }
  };

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
          <DialogDescription>Customize how the app looks and behaves.</DialogDescription>
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

          <div className="space-y-2">
            <SettingRow
              label="Update assets"
              description="Rescan the game folder and refresh assets.json with any new sprites, scripts, and data files."
              htmlFor="update-assets-btn"
            >
              <Button
                id="update-assets-btn"
                variant="outline"
                size="sm"
                onClick={handleUpdateAssets}
                disabled={updating}
              >
                {updating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {updating ? "Scanning…" : "Update"}
              </Button>
            </SettingRow>
            {assetStatus && <p className="text-muted-foreground text-xs">{assetStatus}</p>}
          </div>
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
        {description && <p className="text-muted-foreground text-xs">{description}</p>}
      </div>
      {children}
    </div>
  );
}

export default SettingsDialog;
