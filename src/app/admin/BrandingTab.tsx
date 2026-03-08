"use client";

import { useState, useRef, useEffect } from "react";
import { Save, Upload, Trash2, Palette } from "lucide-react";
import { useBranding } from "@/lib/use-branding";

export default function BrandingTab() {
  const { branding, refresh: refreshBranding } = useBranding();
  const [brandingForm, setBrandingForm] = useState({ appName: "", subtitle: "", logoData: "" });
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingMsg, setBrandingMsg] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!brandingLoaded && branding.appName) {
      setBrandingForm({ appName: branding.appName, subtitle: branding.subtitle, logoData: branding.logoData });
      setBrandingLoaded(true);
    }
  }, [branding, brandingLoaded]);

  async function saveBranding() {
    setSavingBranding(true);
    setBrandingMsg(null);
    try {
      const res = await fetch("/api/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(brandingForm),
      });
      const json = await res.json();
      if (json.success) {
        setBrandingMsg("Branding updated successfully. Changes are visible immediately.");
        refreshBranding();
      } else {
        setBrandingMsg(`Error: ${json.error}`);
      }
    } catch (err) {
      setBrandingMsg(`Error: ${String(err)}`);
    } finally {
      setSavingBranding(false);
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setBrandingMsg("Please upload an image file (PNG, JPEG, or SVG).");
      return;
    }
    if (file.size > 512 * 1024) {
      setBrandingMsg("Logo file is too large. Maximum size is 512 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setBrandingForm((prev) => ({ ...prev, logoData: reader.result as string }));
      setBrandingMsg(null);
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border p-6">
        <h3 className="text-lg font-semibold mb-2">White-Label Branding</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Customise the application name, subtitle, and logo. Changes apply to the sidebar, login page,
          and command centre immediately.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left column -- text fields */}
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-1">Application Name</label>
              <input
                type="text"
                value={brandingForm.appName}
                onChange={(e) => setBrandingForm((prev) => ({ ...prev, appName: e.target.value }))}
                placeholder="KOMmand Centre"
                maxLength={100}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Subtitle</label>
              <input
                type="text"
                value={brandingForm.subtitle}
                onChange={(e) => setBrandingForm((prev) => ({ ...prev, subtitle: e.target.value }))}
                placeholder="Ops Management & Comms Hub"
                maxLength={200}
                className="w-full text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground"
              />
            </div>
          </div>

          {/* Right column -- logo upload */}
          <div>
            <label className="text-sm font-medium block mb-2">Logo</label>
            <div className="flex items-start gap-4">
              <div className="w-20 h-20 rounded-xl border border-border bg-muted/50 flex items-center justify-center overflow-hidden flex-shrink-0">
                {brandingForm.logoData ? (
                  <img src={brandingForm.logoData} alt="Logo preview" className="w-full h-full object-contain p-1" />
                ) : (
                  <span className="text-xs text-muted-foreground">No logo</span>
                )}
              </div>

              <div className="space-y-2">
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <button
                  onClick={() => logoInputRef.current?.click()}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-accent transition-colors"
                >
                  <Upload size={14} />
                  Upload Logo
                </button>
                {brandingForm.logoData && (
                  <button
                    onClick={() => setBrandingForm((prev) => ({ ...prev, logoData: "" }))}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 border border-red-500/20 rounded-lg hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 size={14} />
                    Remove
                  </button>
                )}
                <p className="text-xs text-muted-foreground">PNG, JPEG, SVG, or WebP. Max 512 KB.</p>
              </div>
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Preview</p>
          <div className="flex items-center gap-3 p-3 bg-card rounded-lg border border-border w-fit">
            {brandingForm.logoData ? (
              <img src={brandingForm.logoData} alt="Preview" className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <div className="p-1.5 bg-primary/10 rounded-lg">
                <Palette size={20} className="text-primary" />
              </div>
            )}
            <div>
              <p className="text-sm font-bold text-foreground">{brandingForm.appName || "KOMmand Centre"}</p>
              <p className="text-xs text-muted-foreground">{brandingForm.subtitle || "Ops Management & Comms Hub"}</p>
            </div>
          </div>
        </div>

        {/* Save button and messages */}
        <div className="mt-6 flex items-center gap-4">
          <button
            onClick={saveBranding}
            disabled={savingBranding}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            <Save size={16} />
            {savingBranding ? "Saving..." : "Save Branding"}
          </button>
          {brandingMsg && (
            <p className={`text-sm ${brandingMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>
              {brandingMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
