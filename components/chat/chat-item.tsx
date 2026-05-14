"use client";

import React, { useEffect, useState } from "react";
import { Member, Profile } from "@prisma/client";
import { MemberRole } from "@/lib/db";
import { Edit, FileIcon, ShieldAlert, ShieldCheck, Trash, Check, CheckCheck } from "lucide-react";
import Image from "next/image";
import * as z from "zod";
import axios from "axios";
import qs from "query-string";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter, useParams } from "next/navigation";

import { UserAvatar } from "@/components/user-avatar";
import { ActionTooltip } from "@/components/action-tooltip";
import { cn } from "@/lib/utils";
import { Form, FormControl, FormField, FormItem } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useModal } from "@/hooks/use-modal-store";

interface ChatItemProps {
  id: string;
  content: string;
  member: Member & { profile: Profile };
  timestamp: string;
  fileUrl: string | null;
  deleted: boolean;
  currentMember: Member;
  isUpdated: boolean;
  socketUrl: string;
  socketQuery: Record<string, string>;
  status?: string; // SENT, DELIVERED, READ
}

const roleIconMap: Record<string, React.ReactNode> = {
  GUEST: null,
  MODERATOR: <ShieldCheck className="h-4 w-4 ml-2 text-indigo-500" />,
  ADMIN: <ShieldAlert className="h-4 w-4 ml-2 text-rose-500" />
};

const formSchema = z.object({
  content: z.string().min(1)
});

export function ChatItem({
  id,
  content,
  member,
  timestamp,
  fileUrl,
  deleted,
  currentMember,
  isUpdated,
  socketUrl,
  socketQuery,
  status = "SENT"
}: ChatItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const { onOpen } = useModal();

  const params = useParams();
  const router = useRouter();

  const isOwner = currentMember.id === member.id;
  const isAdmin = currentMember.role === MemberRole.ADMIN;
  const isModerator = currentMember.role === MemberRole.MODERATOR;
  const canDeleteMessage = !deleted && (isAdmin || isModerator || isOwner);
  const canEditMessage = !deleted && isOwner && !fileUrl;
  
  const fileType = fileUrl?.split(".").pop()?.toLowerCase();
  const isPDF = fileType === "pdf" && fileUrl;
  const isImage = ["png", "jpg", "jpeg", "gif", "webp"].includes(fileType || "") && fileUrl;
  const isVideo = ["mp4", "webm", "ogg"].includes(fileType || "") && fileUrl;
  const isAudio = ["mp3", "wav", "m4a"].includes(fileType || "") && fileUrl;
  const isDocument = !isImage && !isVideo && !isAudio && fileUrl;

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { content }
  });

  const isLoading = form.formState.isSubmitting;

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    try {
      const url = qs.stringifyUrl({ url: `${socketUrl}/${id}`, query: socketQuery });
      await axios.patch(url, values);
      form.reset();
      setIsEditing(false);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    form.reset({ content });
  }, [content, form]);

  const isCallMessage = content.includes("📞");

  // Render WhatsApp-style ticks
  const renderTicks = () => {
    if (!isOwner || deleted) return null;

    if (status === "READ") {
      return (
        <ActionTooltip label="Read">
          <CheckCheck className="h-3.5 w-3.5 text-sky-400 -ml-1" />
        </ActionTooltip>
      );
    }

    if (status === "DELIVERED") {
      return (
        <ActionTooltip label="Delivered">
          <CheckCheck className="h-3.5 w-3.5 text-zinc-400 -ml-1" />
        </ActionTooltip>
      );
    }

    return (
      <ActionTooltip label="Sent">
        <Check className="h-3.5 w-3.5 text-zinc-400 -ml-1" />
      </ActionTooltip>
    );
  };

  return (
    <div className={cn(
      "relative group flex items-start px-4 mb-4 w-full",
      isOwner ? "justify-end" : "justify-start"
    )}>
      <div className={cn(
        "flex max-w-[80%] gap-x-3",
        isOwner ? "flex-row-reverse" : "flex-row"
      )}>
        {!isOwner && (
          <div className="shrink-0 mt-1">
            <UserAvatar src={member.profile.imageUrl} className="h-10 w-10" />
          </div>
        )}

        <div className={cn(
          "flex flex-col gap-y-1",
          isOwner ? "items-end" : "items-start"
        )}>
          {!isOwner && (
            <div className="flex items-center gap-x-2 ml-1">
              <p className="font-bold text-xs text-zinc-400">
                {member.profile.name}
              </p>
              {roleIconMap[member.role]}
            </div>
          )}

          <div className={cn(
            "relative px-4 py-3 rounded-2xl text-[14px] shadow-lg",
            isOwner 
              ? "bg-[#5865f2] text-white rounded-tr-none" 
              : "bg-[#2b2d31] text-[#dbdee1] rounded-tl-none",
            isCallMessage && "bg-zinc-800 border border-indigo-500/50 italic text-indigo-400",
            deleted && "opacity-50 italic text-xs bg-transparent border border-white/10"
          )}>
            {isImage && (
              <div className="mb-2 rounded-lg overflow-hidden border border-black/20 max-w-[300px]">
                <Image src={fileUrl!} alt={content} width={400} height={400} className="object-cover" />
              </div>
            )}

            {isVideo && (
              <div className="mb-2 rounded-lg overflow-hidden border border-black/20 max-w-[300px] bg-black">
                <video src={fileUrl!} controls className="w-full h-full" />
              </div>
            )}

            {isAudio && (
              <div className="mb-2 p-2 rounded-lg bg-black/10 border border-white/5 min-w-[240px]">
                <audio src={fileUrl!} controls className="w-full h-8" />
              </div>
            )}

            {isDocument && (
              <div className="mb-2 relative flex items-center p-3 rounded-xl bg-[#1e1f22] border border-white/5">
                <FileIcon className="h-10 w-10 fill-indigo-200 stroke-indigo-400" />
                <a
                  href={fileUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-sm text-indigo-500 dark:text-indigo-400 hover:underline truncate max-w-[180px]"
                >
                  {content || "Download Document"}
                </a>
              </div>
            )}
            
            {!isEditing ? (
               <div className="flex flex-col gap-y-1">
                 <p className="break-words">
                   {content}
                 </p>
                 <div className={cn(
                   "flex items-center gap-x-2",
                   isOwner ? "justify-end" : "justify-start"
                 )}>
                    <span className={cn(
                      "text-[10px] font-bold opacity-50",
                      isOwner ? "text-indigo-100" : "text-zinc-500"
                    )}>
                      {timestamp}
                    </span>
                    {renderTicks()}
                 </div>
               </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="flex items-center gap-x-2 min-w-[200px]">
                  <Input 
                    disabled={isLoading}
                    className="h-9 bg-black/20 border-none text-sm text-white focus-visible:ring-0" 
                    {...form.register("content")} 
                  />
                  <Button size="sm" className="bg-white text-indigo-600 hover:bg-zinc-200">Save</Button>
                </form>
              </Form>
            )}

            {canDeleteMessage && !isEditing && (
              <div className={cn(
                "absolute hidden group-hover:flex items-center gap-x-2 -top-4 bg-[#1e1f22] border border-white/10 p-1.5 rounded-md shadow-2xl z-10",
                isOwner ? "right-0" : "left-0"
              )}>
                {canEditMessage && (
                  <ActionTooltip label="Edit Message">
                    <Edit onClick={() => setIsEditing(true)} className="cursor-pointer w-3 h-3 text-zinc-400 hover:text-white transition" />
                  </ActionTooltip>
                )}
                <Trash onClick={() => onOpen("deleteMessage", { apiUrl: `${socketUrl}/${id}`, query: socketQuery })} className="cursor-pointer w-3 h-3 text-zinc-400 hover:text-rose-500 transition" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
