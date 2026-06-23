"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditNetworkConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface NetworkInterface {
  name: string;
  ip?: string;
  prefix?: number;
  gateway?: string;
  up: boolean;
  loopback: boolean;
}

export function EditNetworkConfigModal({ isOpen, onClose, onSaved }: EditNetworkConfigModalProps) {
  const [ip, setIp] = useState("");
  const [prefix, setPrefix] = useState("24");
  const [gateway, setGateway] = useState("");
  const [iface, setIface] = useState("");
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [beaconPort, setBeaconPort] = useState("5005");
  const [controlPort, setControlPort] = useState("5006");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (isOpen) {
      setError("");
      setSuccess("");
      Promise.all([
        fetch("/api/network/config", { cache: "no-store" }).then(res => res.json()),
        fetch("/api/network?bust=1", { cache: "no-store" }).then(res => res.json()),
      ])
        .then(([config, network]) => {
          const ethernet = (network.interfaces || []).filter((item: NetworkInterface) =>
            !item.loopback && /^(?:eth\d+|usb\d+|en[A-Za-z0-9_.-]+)$/.test(item.name)
          );
          const selected = ethernet.find((item: NetworkInterface) => item.name === config.interface) ||
            ethernet.find((item: NetworkInterface) => item.up) || ethernet[0];

          setInterfaces(ethernet);
          setIface(selected?.name || "");
          // The OS is authoritative. A stale mesh_config value must never make
          // the UI claim an address that is not actually active.
          setIp(selected?.ip || config.manual_ip || "");
          setPrefix(String(selected?.prefix || config.prefix || 24));
          setGateway(selected?.gateway || config.gateway || "");
          if (config.beacon_port) setBeaconPort(config.beacon_port.toString());
          if (config.control_port) setControlPort(config.control_port.toString());
        })
        .catch(() => setError("Could not read the current Ethernet configuration."));
    }
  }, [isOpen]);

  const handleSave = async () => {
    setIsLoading(true);
    setError("");
    setSuccess("");
    try {
      if (!iface) throw new Error("No Ethernet interface is available.");

      const mode = ip.trim() ? "static" : "dhcp";
      const prefixNumber = parseInt(prefix, 10) || 24;
      const applyResponse = await fetch("/api/network/set-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          iface,
          mode,
          ip: mode === "static" ? ip.trim() : undefined,
          prefix: mode === "static" ? prefixNumber : undefined,
          gateway: gateway.trim() || undefined,
        }),
      });
      const applied = await applyResponse.json().catch(() => ({}));
      if (!applyResponse.ok) {
        throw new Error(applied.error || "The operating system rejected the Ethernet change.");
      }

      const config = {
        manual_ip: ip || null,
        interface: iface,
        network_mode: mode,
        prefix: prefixNumber,
        gateway: gateway.trim() || null,
        beacon_port: parseInt(beaconPort) || 5005,
        control_port: parseInt(controlPort) || 5006
      };
      const configResponse = await fetch("/api/network/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      if (!configResponse.ok) throw new Error("Ethernet changed, but the app could not save its display settings.");

      setSuccess(mode === "static"
        ? `OS Ethernet address changed to ${applied.active?.ip || ip}/${applied.active?.prefix || prefixNumber}.`
        : "DHCP enabled at the OS level.");
      onSaved();
      setTimeout(onClose, 900);
    } catch (saveError: any) {
      setError(saveError?.message || "Failed to apply the Ethernet configuration.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="touch-scroll max-h-[calc(100vh-1rem)] overflow-y-auto bg-[#1e1f22] text-white border-zinc-800 p-0">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold text-emerald-400">Customize Mesh Network</DialogTitle>
          <DialogDescription className="text-center text-zinc-400">
            Override the auto-assigned Mesh IP and communication ports for this CyberDeck node.
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <Label className="uppercase text-xs font-bold text-zinc-500">Ethernet Interface</Label>
            <select
              disabled={isLoading}
              value={iface}
              onChange={(event) => setIface(event.target.value)}
              className="w-full h-10 rounded-md bg-zinc-900/50 px-3 text-sm text-white outline-none"
            >
              {interfaces.length === 0 && <option value="">No Ethernet interface found</option>}
              {interfaces.map((item) => (
                <option key={item.name} value={item.name}>
                  {item.name}{item.ip ? ` — ${item.ip}/${item.prefix}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">Ethernet IPv4 Address</Label>
            <Input 
              disabled={isLoading}
              className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white focus-visible:ring-offset-0" 
              placeholder="e.g. 10.0.0.2 (leave blank for DHCP)"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold text-zinc-500">Prefix Length</Label>
              <Input
                type="number"
                min={1}
                max={32}
                disabled={isLoading || !ip.trim()}
                className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold text-zinc-500">Gateway (Optional)</Label>
              <Input
                disabled={isLoading || !ip.trim()}
                className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white"
                placeholder="e.g. 10.0.0.254"
                value={gateway}
                onChange={(event) => setGateway(event.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold text-zinc-500">Beacon Port</Label>
              <Input 
                type="number"
                disabled={isLoading}
                className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white" 
                value={beaconPort}
                onChange={(e) => setBeaconPort(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="uppercase text-xs font-bold text-zinc-500">Control Port</Label>
              <Input 
                type="number"
                disabled={isLoading}
                className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white" 
                value={controlPort}
                onChange={(e) => setControlPort(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          {success && <p className="text-sm text-emerald-400">{success}</p>}
        </div>
        <DialogFooter className="bg-zinc-900 px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={isLoading} className="text-zinc-400">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading} className="bg-emerald-500 hover:bg-emerald-600 text-white">
            {isLoading ? "Applying to OS..." : "Apply Ethernet Settings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
