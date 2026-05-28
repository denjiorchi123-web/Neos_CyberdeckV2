"use client";

import React from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
  name: z.string().min(1, { message: "Server name is required." }),
  imageUrl: z.string()
});

export function CreateServerModal() {
  const { isOpen, onClose, type } = useModal();
  const router = useRouter();

  const isModalOpen = isOpen && type === "createServer";

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      imageUrl: ""
    }
  });

  const [profiles, setProfiles] = React.useState<any[]>([]);
  const [selectedProfiles, setSelectedProfiles] = React.useState<string[]>([]);
  const [currentUser, setCurrentUser] = React.useState<any>(null);

  React.useEffect(() => {
    if (isModalOpen) {
      axios.get("/api/auth/me").then(res => setCurrentUser(res.data)).catch(() => {});
      axios.get("/api/profiles").then(res => setProfiles(res.data)).catch(() => {});
    } else {
      setSelectedProfiles([]);
    }
  }, [isModalOpen]);

  const availableContacts = profiles.filter(p => p.id !== currentUser?.id);

  const toggleProfile = (id: string) => {
    setSelectedProfiles(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const watchedName = form.watch("name");
  const initials = (watchedName || "S").slice(0, 2).toUpperCase();

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const payload = { ...values, imageUrl: "", memberIds: selectedProfiles };
      await axios.post("/api/servers", payload);
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
          <DialogTitle className="text-2xl text-center font-bold">
            New Group
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500">
            Create a new group chat and invite your contacts.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-8 px-6">
              {/* Local initials avatar preview — no external requests */}
              <div className="flex items-center justify-center">
                <div className="h-20 w-20 rounded-full ring-4 ring-indigo-500/30 bg-indigo-600 flex items-center justify-center">
                  <span className="text-white font-bold text-2xl select-none">{initials}</span>
                </div>
              </div>

              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      Group Name
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        placeholder="Enter group name"
                        className="bg-zinc-300/50 border-0 focus-visible:ring-0 text-black focus-visible:ring-offset-0"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Contacts Selection */}
              {availableContacts.length > 0 && (
                <div className="space-y-2 mt-4">
                  <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                    Add Members
                  </FormLabel>
                  <div className="max-h-[150px] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                    {availableContacts.map(contact => (
                      <div 
                        key={contact.id} 
                        onClick={() => toggleProfile(contact.id)}
                        className="flex items-center gap-x-3 p-2 rounded-md hover:bg-zinc-100 cursor-pointer border border-transparent transition"
                      >
                        <input 
                          type="checkbox" 
                          checked={selectedProfiles.includes(contact.id)}
                          readOnly
                          className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                        />
                        <div className="h-8 w-8 rounded-full bg-indigo-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {contact.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="text-sm font-semibold text-zinc-700">{contact.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="bg-gray-100 px-6 py-4">
              <Button disabled={isLoading} variant="primary">
                Create
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
