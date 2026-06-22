"use client";

import React from "react";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import axios from "axios";
import { useRouter } from "next/navigation";
import qs from "query-string";

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
  FormItem
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { FileUpload, UploadResult } from "@/components/file-upload";
import { useModal } from "@/hooks/use-modal-store";
import { enqueue } from "@/lib/offline-queue";
import { v4 as uuidv4 } from "uuid";

const formSchema = z.object({
  fileUrl: z.string().min(1, { message: "Attachment is required." })
});

export function MessageFileModal() {
  const {
    isOpen,
    onClose,
    type,
    data
  } = useModal();
  const { apiUrl, query, replyToId } = data;
  const router = useRouter();
  const [uploadMeta, setUploadMeta] = React.useState<UploadResult | null>(null);

  const isModalOpen = isOpen && type === "messageFile";

  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      fileUrl: ""
    }
  });

  const handleClose = () => {
    form.reset();
    setUploadMeta(null);
    onClose();
  };

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({
        url: apiUrl || "",
        query
      });
      const attachment = uploadMeta?.url === values.fileUrl ? uploadMeta : { url: values.fileUrl };
      const payload = {
        content: attachment.fileName || values.fileUrl,
        fileUrl: attachment.url,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        mimeType: attachment.mimeType,
        thumbnailUrl: attachment.thumbnailUrl || undefined,
        mediaKey: attachment.mediaKey || undefined,
        type: attachment.type || "DOCUMENT",
        replyToId,
      };

      try {
        await axios.post(url, payload);
      } catch (error: any) {
        if (error?.response?.status === 403) throw error;
        await enqueue({
          id: uuidv4(),
          apiUrl: apiUrl || "",
          query: query || {},
          ...payload,
          queuedAt: Date.now(),
          retryCount: 0,
        });
        if ("serviceWorker" in navigator) {
          const reg = await navigator.serviceWorker.ready;
          if ("sync" in reg) await (reg as any).sync.register("cyberdeck-outbox");
        }
        console.warn("[MessageFileModal] send failed; queued for retry", error);
      }

      form.reset();
      router.refresh();
      handleClose();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Dialog open={isModalOpen} onOpenChange={handleClose}>
      <DialogContent className="bg-white text-black p-0 overflow-hidden">
        <DialogHeader className="pt-8 px-6">
          <DialogTitle className="text-2xl text-center font-bold">
            Add any file
          </DialogTitle>
          <DialogDescription className="text-center text-zinc-500">
            Send any file type as a message.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-8"
          >
            <div className="space-y-8 px-6">
              <div className="flex items-center justify-center text-center">
                <FormField
                  control={form.control}
                  name="fileUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <FileUpload
                          endpoint="messageFile"
                          value={field.value}
                          onChange={(url) => {
                            if (!url) setUploadMeta(null);
                            field.onChange(url);
                          }}
                          onUploadComplete={setUploadMeta}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </div>
            <DialogFooter className="bg-gray-100 px-6 py-4">
              <Button disabled={isLoading} variant="primary">
                Send
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
