"use client";

import axios from "axios";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

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
  oldPin: z.string().length(4, {
    message: "PIN must be exactly 4 digits.",
  }).regex(/^\d+$/, "PIN must contain only numbers"),
  newPin: z.string().length(4, {
    message: "PIN must be exactly 4 digits.",
  }).regex(/^\d+$/, "PIN must contain only numbers"),
});

export function ChangePinModal() {
  const { isOpen, onClose, type } = useModal();
  const router = useRouter();
  const { refreshPreferences } = usePreferences();

  const isModalOpen = isOpen && type === "changePin";

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      oldPin: "",
      newPin: "",
    }
  });

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      await axios.post("/api/pin/change", values);
      refreshPreferences();
      form.reset();
      router.refresh();
      onClose();
    } catch (error: any) {
      if (error?.response?.status === 403) {
        form.setError("oldPin", { message: "Incorrect current PIN." });
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
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold">
            Change Chat PIN
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500 dark:text-zinc-400">
            Enter your current PIN to set a new one.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <div className="space-y-4 px-6">
              <FormField
                control={form.control}
                name="oldPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      Current 4-Digit PIN
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        className="bg-zinc-300/50 dark:bg-zinc-900 border-0 focus-visible:ring-0 text-black dark:text-white focus-visible:ring-offset-0 tracking-widest text-lg"
                        placeholder="****"
                        maxLength={4}
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="newPin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="uppercase text-xs font-bold text-zinc-500 dark:text-secondary/70">
                      New 4-Digit PIN
                    </FormLabel>
                    <FormControl>
                      <Input
                        disabled={isLoading}
                        className="bg-zinc-300/50 dark:bg-zinc-900 border-0 focus-visible:ring-0 text-black dark:text-white focus-visible:ring-offset-0 tracking-widest text-lg"
                        placeholder="****"
                        maxLength={4}
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="bg-gray-100 dark:bg-[#2b2d31] px-6 py-4">
              <Button variant="primary" disabled={isLoading} className="w-full">
                Change PIN
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
