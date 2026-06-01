"use client";

import axios from "axios";
import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Phone, Video } from "lucide-react";

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

const formSchema = z.object({
  pin: z
    .string()
    .length(4, { message: "PIN must be exactly 4 digits." })
    .regex(/^\d+$/, "PIN must contain only numbers"),
});

export function CallPinVerifyModal() {
  const { isOpen, onClose, type, data } = useModal();

  const isModalOpen = isOpen && type === "callPinVerify";

  // Determine call type hint from data (stored in chatName by convention)
  const isVideo = data.chatName === "video";

  // Keep the callback in a stable ref so it survives React re-renders and
  // the Zustand store update that clears `data` when onClose() is called.
  const callbackRef = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    if (isModalOpen && data.onSuccessCallback) {
      callbackRef.current = data.onSuccessCallback;
    }
    if (!isModalOpen) {
      // Reset after modal fully closes so stale callbacks don't leak
      callbackRef.current = undefined;
    }
  }, [isModalOpen, data.onSuccessCallback]);

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: { pin: "" },
  });

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const res = await axios.post("/api/pin/verify", { pin: values.pin });
      if (res.data.success) {
        // IMPORTANT: grab the callback BEFORE resetting/closing anything,
        // then close the modal, then fire — so navigation happens cleanly.
        const cb = callbackRef.current;
        form.reset();
        onClose();
        // Small delay so the modal's exit animation doesn't conflict with navigation
        setTimeout(() => {
          cb?.();
        }, 50);
      }
    } catch (error: any) {
      if (error?.response?.status === 403) {
        form.setError("pin", { message: "Incorrect PIN. Try again." });
      } else {
        console.error("[CallPinVerifyModal]", error);
        form.setError("pin", { message: "An error occurred. Please try again." });
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
          <div className="h-14 w-14 bg-indigo-500/20 rounded-full flex items-center justify-center mb-4">
            {isVideo ? (
              <Video className="h-7 w-7 text-indigo-500" />
            ) : (
              <Phone className="h-7 w-7 text-indigo-500" />
            )}
          </div>
          <DialogTitle className="text-2xl text-center font-bold">
            Locked Chat
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400 px-4">
            This chat is PIN-locked. Enter your PIN to proceed with the{" "}
            {isVideo ? "video" : "voice"} call.
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
                          const val = e.target.value.replace(/\D/g, "");
                          field.onChange(val);
                        }}
                      />
                    </FormControl>
                    <FormMessage className="text-center" />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="bg-gray-100 dark:bg-[#2b2d31] px-6 py-4 flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="ghost"
                onClick={handleClose}
                disabled={isLoading}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={isLoading || form.watch("pin").length !== 4}
                className="w-full sm:w-auto"
              >
                Verify & Connect
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
