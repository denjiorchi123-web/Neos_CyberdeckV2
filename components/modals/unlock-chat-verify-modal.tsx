"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Unlock } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useModal } from "@/hooks/use-modal-store";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { usePreferences } from "@/components/providers/socket-provider";

const formSchema = z.object({
  pin: z.string().length(4, {
    message: "PIN must be exactly 4 digits.",
  }).regex(/^\d+$/, "PIN must contain only numbers"),
});

export function UnlockChatVerifyModal() {
  const { isOpen, onClose, type, data } = useModal();
  const router = useRouter();
  const { refreshPreferences } = usePreferences();

  const isModalOpen = isOpen && type === "unlockChatVerify";
  const { chatId } = data;

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      pin: "",
    }
  });

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      // 1. Verify PIN
      const verifyRes = await axios.post("/api/pin/verify", { pin: values.pin });
      
      if (verifyRes.data.success && chatId) {
        // 2. If successful, remove the lock from this chat globally
        await axios.delete(`/api/locked-chats?chatId=${chatId}`);
        refreshPreferences();
        form.reset();
        router.refresh();
        onClose();
      }
    } catch (error: any) {
      if (error?.response?.status === 403) {
        form.setError("pin", { message: "Incorrect PIN." });
      } else {
        console.error(error);
      }
    }
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white text-black p-0 overflow-hidden dark:bg-[#313338] dark:text-white">
        <DialogHeader className="pt-8 px-6 flex flex-col items-center">
          <div className="h-12 w-12 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4">
            <Unlock className="h-6 w-6 text-indigo-500" />
          </div>
          <DialogTitle className="text-2xl text-center font-bold">
            Remove Chat Lock
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400">
            Enter your PIN to verify your identity and unlock this chat globally.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4 px-6">
              <FormField
                control={form.control}
                name="pin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      4-Digit PIN
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        autoFocus
                        className="bg-zinc-300/50 dark:bg-zinc-900 border-0 focus-visible:ring-0 text-black dark:text-white focus-visible:ring-offset-0 tracking-[1em] text-center text-2xl font-mono py-6"
                        placeholder="****"
                        maxLength={4}
                        type="password"
                        {...field}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          field.onChange(val);
                        }}
                      />
                    </FormControl>
                    <FormMessage className="text-center" />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="bg-gray-100 dark:bg-[#2b2d31] px-6 py-4">
              <Button variant="primary" disabled={isLoading || form.watch("pin").length !== 4} className="w-full">
                Verify and Unlock
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
