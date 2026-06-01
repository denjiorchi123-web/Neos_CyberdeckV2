"use client";

import React, { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileIcon, X, Upload, Loader2, ShieldCheck } from "lucide-react";
import { generateMediaKey, encryptMedia } from "@/lib/device-storage";
import { MESSAGE_FILE_MAX_SIZE, formatMaxSize } from "@/lib/upload-limits";

interface EncryptedFileUploadProps {
  onUploadComplete: (result: {
    url: string;
    thumbnailUrl?: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    type: string;
    mediaKey: string;
  }) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
}

const DEFAULT_ACCEPT = {
  "image/*":          [".png", ".jpg", ".jpeg", ".gif", ".webp"],
  "video/*":          [".mp4", ".webm", ".ogg"],
  "audio/*":          [".mp3", ".wav", ".m4a", ".ogg"],
  "application/pdf":  [".pdf"],
  "application/zip":  [".zip"],
  "text/plain":       [".txt"],
};

export function EncryptedFileUpload({
  onUploadComplete,
  accept = DEFAULT_ACCEPT,
  maxSize = MESSAGE_FILE_MAX_SIZE,
}: EncryptedFileUploadProps) {
  const [progressText, setProgressText] = useState<string | null>(null);
  const [progressPct,  setProgressPct]  = useState<number | null>(null);
  const [error,        setError]        = useState<string | null>(null);

  const onDrop = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    const file = files[0];
    setError(null);
    setProgress("Encrypting…");

    try {
      const buf      = await file.arrayBuffer();
      const mediaKey = await generateMediaKey();
      const { ivHex, ciphertextHex } = await encryptMedia(buf, mediaKey);

      // Upload the encrypted ciphertext as a binary blob
      const encBlob = new Blob(
        [ivHex + ":" + ciphertextHex],
        { type: "application/octet-stream" }
      );
      const formData = new FormData();
      formData.append("file",     encBlob, file.name + ".enc");
      formData.append("mediaKey", mediaKey);

      setProgressText("Uploading…");
      setProgressPct(0);

      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/upload", true);
      xhr.withCredentials = true;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setProgressPct(percentComplete);
          setProgressText(`Uploading… ${percentComplete}%`);
        }
      };

      const uploadPromise = new Promise((resolve, reject) => {
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            reject(new Error(`Upload failed: ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.send(formData);
      });

      const data = (await uploadPromise) as any;

      onUploadComplete({
        url:          data.url,
        thumbnailUrl: data.thumbnailUrl ?? undefined,
        fileName:     file.name,
        fileSize:     file.size,
        mimeType:     file.type || "application/octet-stream",
        type:         data.type ?? "DOCUMENT",
        mediaKey,
      });
      setProgressText(null);
      setProgressPct(null);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
      setProgressText(null);
      setProgressPct(null);
    }
  }, [onUploadComplete]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxFiles: 1,
    maxSize,
  });

  return (
    <div
      {...getRootProps()}
      className={`border-2 border-dashed rounded-2xl p-8 cursor-pointer transition-all text-center ${
        isDragActive
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-zinc-600/50 hover:border-zinc-500/70 bg-white/3"
      }`}
    >
      <input {...getInputProps()} />
      {progressText ? (
        <div className="flex flex-col items-center gap-3 w-full">
          <Loader2 className="h-10 w-10 text-indigo-400 animate-spin" />
          <p className="text-zinc-300 text-sm font-medium">{progressText}</p>
          
          {progressPct !== null && (
            <div className="w-full max-w-[200px] h-2 bg-zinc-800 rounded-full overflow-hidden mt-1">
              <div 
                className="h-full bg-indigo-500 transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          )}

          <div className="flex items-center gap-x-1.5 text-emerald-400 text-xs font-mono mt-2">
            <ShieldCheck className="h-3.5 w-3.5" /> AES-256 Encrypted
          </div>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3">
          <X className="h-10 w-10 text-rose-400" />
          <p className="text-rose-400 text-sm">{error}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <Upload className="h-10 w-10 text-zinc-400" />
            <ShieldCheck className="absolute -bottom-1 -right-1 h-5 w-5 text-emerald-400 bg-[#1a1c23] rounded-full" />
          </div>
          <p className="text-zinc-300 text-sm font-medium">
            {isDragActive ? "Drop to encrypt & send" : "Tap or drag file to upload"}
          </p>
          <p className="text-zinc-500 text-xs">
            All files are AES-256 encrypted before upload · Max {formatMaxSize(maxSize)}
          </p>
        </div>
      )}
    </div>
  );
}
