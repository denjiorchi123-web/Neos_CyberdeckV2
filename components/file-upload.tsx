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
  const fileType = value?.split(".").pop();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", acceptedFiles[0]);

      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (data.url) {
        onChange(data.url);
        onUploadComplete?.(data);
      }
    } catch (error) {
      console.error("Upload failed:", error);
    } finally {
      setIsUploading(false);
    }
  }, [onChange, onUploadComplete]);

  const imageTypes = { "image/*": [".png", ".jpg", ".jpeg", ".gif", ".webp"] };
  const videoTypes = { "video/*": [".mp4", ".webm", ".ogg", ".mkv", ".mov"] };
  const audioTypes = { "audio/*": [".mp3", ".wav", ".m4a", ".flac", ".ogg"] };

  // serverImage = avatar / server icon (small); messageFile = chat attachment (FAT32-bounded)
  const isAvatar = endpoint === "serverImage" || endpoint === "communityImage" || endpoint === "channelImage";
  const accept = isAvatar
    ? imageTypes
    : {
        ...imageTypes,
        ...videoTypes,
        ...audioTypes,
        "application/pdf": [".pdf"],
        "application/zip": [".zip"],
        "application/x-tar": [".tar"],
        "application/gzip": [".gz"],
        "text/plain": [".txt"],
        "application/octet-stream": [],
      };

  const maxSize = isAvatar ? SERVER_IMAGE_MAX_SIZE : MESSAGE_FILE_MAX_SIZE;

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    maxSize,
  });

  if (value && fileType !== "pdf") {
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

  if (value && fileType === "pdf") {
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
              : `Any file (max ${formatMaxSize(MESSAGE_FILE_MAX_SIZE)})`}
          </p>
        </div>
      )}
    </div>
  );
}
