"use client";

import React from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { useRouter } from "next/navigation";
import { Hash } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModal } from "@/hooks/use-modal-store";

const formSchema = z.object({
  name: z.string().min(1, { message: "Community name is required." }),
  description: z.string().optional(),
});

export function CreateCommunityModal() {
  const { isOpen, onClose, type } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "createCommunity";

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      description: ""
    }
  });

  // We fetch the user's servers (Groups) so they can merge them into the community
  const [servers, setServers] = React.useState<any[]>([]);
  const [selectedServers, setSelectedServers] = React.useState<string[]>([]);

  React.useEffect(() => {
    if (isModalOpen) {
      axios.get("/api/servers").then(res => {
        // Filter out the default server, keep only user-created groups
        const groups = res.data.filter((s: any) => s.inviteCode !== "cyberdeck-default");
        setServers(groups);
      }).catch(() => {});
    } else {
      setSelectedServers([]);
    }
  }, [isModalOpen]);

  const toggleServer = (id: string) => {
    setSelectedServers(prev => 
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    );
  };

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const payload = { ...values, groupIds: selectedServers };
      await axios.post("/api/communities", payload);
      form.reset();
      router.refresh();
      onClose();
    } catch (error) {
      console.error(error);
    }
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white text-black p-0 overflow-hidden">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold flex flex-col items-center gap-y-2">
            <div className="h-12 w-12 bg-indigo-100 rounded-lg flex items-center justify-center">
              <Hash className="h-6 w-6 text-indigo-600" />
            </div>
            New Community
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500">
            Merge multiple groups under a single community umbrella. Select the groups to add.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-6 px-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      Community Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="e.g. Development Team"
                        className="bg-zinc-300/50 border-0 focus-visible:ring-0 text-black focus-visible:ring-offset-0"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      Description (Optional)
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="What is this community about?"
                        className="bg-zinc-300/50 border-0 focus-visible:ring-0 text-black focus-visible:ring-offset-0"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Group Selection */}
              {servers.length > 0 ? (
                <div className="space-y-2 mt-4">
                  <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                    Select Groups to Merge
                  </FormLabel>
                  <div className="max-h-[150px] overflow-y-auto space-y-2 pr-2 custom-scrollbar border rounded-md p-2 bg-zinc-50">
                    {servers.map(server => (
                      <div 
                        key={server.id}
                        onClick={() => toggleServer(server.id)}
                        className={`flex items-center gap-x-3 p-2 rounded-md cursor-pointer transition ${
                          selectedServers.includes(server.id) ? "bg-indigo-100" : "hover:bg-zinc-200"
                        }`}
                      >
                        <div className="flex-1 flex flex-col items-start overflow-hidden">
                          <p className="text-sm font-semibold truncate text-zinc-800">{server.name}</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={selectedServers.includes(server.id)}
                          readOnly
                          className="h-4 w-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-amber-600 font-medium">You don&apos;t have any groups to merge yet.</p>
              )}
            </div>
            <div className="bg-gray-100 px-6 py-4 flex items-center w-full justify-between">
              <span className="text-xs text-zinc-500">
                {selectedServers.length} group(s) selected
              </span>
              <Button variant="primary" disabled={isLoading} className="w-auto">
                Create Community
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
