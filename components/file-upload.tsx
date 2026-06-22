"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileIcon, X, Upload, Loader2 } from "lucide-react";
import Image from "next/image";
import {
  MESSAGE_FILE_MAX_SIZE,
  SERVER_IMAGE_MAX_SIZE,
  formatMaxSize,
} from "@/lib/upload-limits";

interface FileUploadProps {
  onChange: (url?: string) => void;
  onUploadComplete?: (result: UploadResult) => void;
  value: string;
  endpoint: "messageFile" | "serverImage" | "communityImage" | "channelImage";
}

export interface UploadResult {
  url: string;
  thumbnailUrl?: string | null;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  type?: string;
  mediaKey?: string | null;
}

export function FileUpload({
  onChange,
  onUploadComplete,
  value,
  endpoint
}: FileUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileType = value?.split(".").pop()?.split("?")[0]?.toLowerCase();
  const isImageValue = !!fileType && ["png", "jpg", "jpeg", "gif", "webp"].includes(fileType);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setUploadError(null);
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", acceptedFiles[0]);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.url) {
        throw new Error(data.error || `Upload failed (${response.status})`);
      }

      onChange(data.url);
      onUploadComplete?.(data);
    } catch (error: any) {
      console.error("Upload failed:", error);
      setUploadError(error?.message || "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }, [onChange, onUploadComplete]);

  const imageTypes = { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"] };

  // Avatars stay image-only. Chat attachments intentionally omit `accept`,
  // which tells the browser and react-dropzone to allow every file type.
  const isAvatar = endpoint === "serverImage" || endpoint === "communityImage" || endpoint === "channelImage";
  const accept = isAvatar ? imageTypes : undefined;

  const maxSize = isAvatar ? SERVER_IMAGE_MAX_SIZE : MESSAGE_FILE_MAX_SIZE;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected: (rejections) => {
      const tooLarge = rejections.some((rejection) =>
        rejection.errors.some((error) => error.code === "file-too-large")
      );
      setUploadError(
        tooLarge
          ? `File is larger than ${formatMaxSize(maxSize)}`
          : isAvatar
            ? "Choose a supported image file"
            : "This file could not be selected"
      );
    },
    accept,
    maxFiles: 1,
    maxSize,
  });

  if (value && isImageValue) {
    return (
      <div className="relative h-20 w-20">
        <Image fill src={value} alt="Upload" className="rounded-full" />
        <button
          onClick={() => onChange("")}
          className="bg-rose-500 text-white p-1 rounded-full absolute top-0 right-0 shadow-sm"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (value) {
    return (
      <div className="relative flex items-center p-2 mt-2 rounded-md bg-background/10">
        <FileIcon className="h-10 w-10 fill-indigo-200 stroke-indigo-400" />
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-2 text-sm text-indigo-500 dark:text-indigo-400 hover:underline"
        >
          {value}
        </a>
        <button
          onClick={() => onChange("")}
          className="bg-rose-500 text-white p-1 rounded-full absolute -top-2 -right-2 shadow-sm"
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-lg p-6 cursor-pointer transition-colors text-center ${
        isDragActive
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-zinc-500/30 hover:border-zinc-400/50"
      }`}
    >
      <input {...getInputProps()} />
      {isUploading ? (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="h-10 w-10 text-indigo-500 animate-spin" />
          <p className="text-sm text-zinc-400">Uploading...</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="h-10 w-10 text-zinc-400" />
          <p className="text-sm text-zinc-400">
            {isDragActive ? "Drop the file here" : "Drag & drop or click to upload"}
          </p>
          <p className="text-xs text-zinc-500">
            {isAvatar
              ? `Image (max ${formatMaxSize(SERVER_IMAGE_MAX_SIZE)})`
              : `Any file type (max ${formatMaxSize(MESSAGE_FILE_MAX_SIZE)})`}
          </p>
          {uploadError && (
            <p className="text-xs text-rose-500 max-w-xs break-words">{uploadError}</p>
          )}
        </div>
      )}
    </div>
  );
}
