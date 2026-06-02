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

export function EditNetworkConfigModal({ isOpen, onClose, onSaved }: EditNetworkConfigModalProps) {
  const [ip, setIp] = useState("");
  const [beaconPort, setBeaconPort] = useState("5005");
  const [controlPort, setControlPort] = useState("5006");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetch("/api/network/config")
        .then(res => res.json())
        .then(data => {
          if (data.manual_ip) setIp(data.manual_ip);
          if (data.beacon_port) setBeaconPort(data.beacon_port.toString());
          if (data.control_port) setControlPort(data.control_port.toString());
        })
        .catch(console.error);
    }
  }, [isOpen]);

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const config = {
        manual_ip: ip || null,
        beacon_port: parseInt(beaconPort) || 5005,
        control_port: parseInt(controlPort) || 5006
      };
      await fetch("/api/network/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      onSaved();
      onClose();
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#1e1f22] text-white border-zinc-800 p-0 overflow-hidden">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold text-emerald-400">Customize Mesh Network</DialogTitle>
          <DialogDescription className="text-center text-zinc-400">
            Override the auto-assigned Mesh IP and communication ports for this CyberDeck node.
          </DialogDescription>
        </DialogHeader>
        <div className="p-6 space-y-6">
          <div className="space-y-2">
            <Label className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">Manual IP Address Override</Label>
            <Input 
              disabled={isLoading}
              className="bg-zinc-900/50 border-0 focus-visible:ring-0 text-white focus-visible:ring-offset-0" 
              placeholder="e.g. 192.168.10.99 (Leave blank for Auto)"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
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
        </div>
        <DialogFooter className="bg-zinc-900 px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={isLoading} className="text-zinc-400">
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading} className="bg-emerald-500 hover:bg-emerald-600 text-white">
            {isLoading ? "Saving..." : "Save & Restart Mesh"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
