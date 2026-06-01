"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Camera, X, RotateCcw, Send, SwitchCamera, Video } from "lucide-react";
import { generateMediaKey, encryptMedia } from "@/lib/device-storage";

interface CameraCaptureProps {
  apiUrl: string;
  query: Record<string, string>;
  onClose: () => void;
  onSend: (payload: {
    fileUrl: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    thumbnailUrl?: string;
    mediaKey?: string;
    type: string;
    content: string;
  }) => Promise<void>;
}

export function CameraCapture({ onClose, onSend }: CameraCaptureProps) {
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const streamRef   = useRef<MediaStream | null>(null);

  const [isFront,   setIsFront]   = useState(true);
  const [captured,  setCaptured]  = useState<string | null>(null); // data URL for photo
  const [recordedVideo, setRecordedVideo] = useState<string | null>(null); // blob URL for video
  const [isRecording, setIsRecording] = useState(false);
  const [sending,   setSending]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startCamera = useCallback(async (front: boolean) => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: front ? "user" : "environment", width: 1280, height: 720 }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setError(null);
    } catch (e: any) {
      setError("Camera unavailable: " + (e?.message || e));
    }
  }, []);

  useEffect(() => {
    startCamera(true);
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, [startCamera]);

  const capture = () => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (isFront) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0);
    setCaptured(canvas.toDataURL("image/jpeg", 0.88));
  };

  const startRecording = () => {
    if (!streamRef.current) return;
    chunksRef.current = [];
    
    let mimeType = "video/webm";
    if (MediaRecorder.isTypeSupported("video/webm;codecs=vp9")) {
      mimeType = "video/webm;codecs=vp9";
    } else if (MediaRecorder.isTypeSupported("video/webm;codecs=vp8")) {
      mimeType = "video/webm;codecs=vp8";
    } else if (MediaRecorder.isTypeSupported("video/mp4")) {
      mimeType = "video/mp4";
    }

    const mr = new MediaRecorder(streamRef.current, { mimeType });
    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedVideo(url);
    };
    mr.start();
    mediaRecorderRef.current = mr;
    setIsRecording(true);
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const retake = () => {
    setCaptured(null);
    if (recordedVideo) URL.revokeObjectURL(recordedVideo);
    setRecordedVideo(null);
    startCamera(isFront);
  };

  const flipCamera = () => {
    const next = !isFront;
    setIsFront(next);
    startCamera(next);
  };

  const send = async () => {
    if (!captured && !recordedVideo) return;
    setSending(true);
    try {
      let uploadBlob: Blob;
      let finalMimeType: string;
      let finalFileName: string;
      let finalType: string;
      let thumbUrl: string | undefined = undefined;

      if (captured) {
        const res = await fetch(captured);
        uploadBlob = await res.blob();
        finalMimeType = "image/jpeg";
        finalFileName = `photo_${Date.now()}.jpg`;
        finalType = "IMAGE";
        
        const canvas = canvasRef.current;
        thumbUrl = canvas?.toDataURL("image/jpeg", 0.4) ?? undefined;
      } else {
        const res = await fetch(recordedVideo!);
        uploadBlob = await res.blob();
        finalMimeType = uploadBlob.type || "video/webm";
        finalFileName = `video_${Date.now()}.webm`;
        finalType = "VIDEO";
        
        // Video thumbnail generation could go here if needed, keeping it undefined for now
      }

      const buf  = await uploadBlob.arrayBuffer();

      // Generate per-file AES-GCM key and encrypt
      const mediaKey  = await generateMediaKey();
      const { ivHex, ciphertextHex } = await encryptMedia(buf, mediaKey);

      // Build encrypted FormData blob to upload
      const encBlob = new Blob(
        [ivHex + ":" + ciphertextHex],
        { type: "application/octet-stream" }
      );
      const formData = new FormData();
      formData.append("file", encBlob, `camera_${Date.now()}.enc`);
      formData.append("mediaKey", mediaKey);

      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const data = await uploadRes.json();

      await onSend({
        fileUrl:      data.url,
        fileName:     finalFileName,
        fileSize:     uploadBlob.size,
        mimeType:     finalMimeType,
        thumbnailUrl: thumbUrl,
        mediaKey,
        type:         finalType,
        content:      finalType === "IMAGE" ? "📷 Photo" : "🎥 Video",
      });
      onClose();
    } catch (e: any) {
      setError("Send failed: " + (e?.message || e));
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex flex-col bg-black">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 absolute top-0 inset-x-0 z-10 bg-gradient-to-b from-black/60 to-transparent">
        <button onClick={onClose} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
          <X className="h-6 w-6 text-white" />
        </button>
        {!captured && !recordedVideo && !isRecording && (
          <button onClick={flipCamera} className="p-2 rounded-full bg-white/10 hover:bg-white/20">
            <SwitchCamera className="h-6 w-6 text-white" />
          </button>
        )}
      </div>

      {/* Live preview / captured image / captured video */}
      <div className="flex-1 flex items-center justify-center overflow-hidden">
        {!captured && !recordedVideo ? (
          <video
            ref={videoRef}
            autoPlay playsInline muted
            className={`w-full h-full object-cover ${isFront ? "scale-x-[-1]" : ""}`}
          />
        ) : recordedVideo ? (
          <video src={recordedVideo} controls autoPlay className="w-full h-full object-contain bg-black" />
        ) : (
          <img src={captured!} alt="Captured" className="w-full h-full object-contain" />
        )}
      </div>

      {/* Hidden canvas used for capture */}
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="absolute bottom-32 inset-x-4 text-center text-rose-400 text-sm bg-black/70 px-4 py-2 rounded-xl">
          {error}
        </div>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 pb-10 flex items-center justify-center gap-x-12 bg-gradient-to-t from-black/70 to-transparent pt-8">
        {!captured && !recordedVideo ? (
          <div className="flex gap-x-8">
            {!isRecording ? (
              <>
                <button
                  onClick={capture}
                  className="h-16 w-16 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 flex items-center justify-center transition-all active:scale-90 shadow-xl"
                  title="Take Photo"
                >
                  <Camera className="h-6 w-6 text-white" />
                </button>
                <button
                  onClick={startRecording}
                  className="h-16 w-16 rounded-full border-4 border-white bg-rose-500/80 hover:bg-rose-500 flex items-center justify-center transition-all active:scale-90 shadow-xl"
                  title="Record Video"
                >
                  <Video className="h-6 w-6 text-white fill-current" />
                </button>
              </>
            ) : (
              <button
                onClick={stopRecording}
                className="h-20 w-20 rounded-full border-4 border-rose-500 bg-rose-500 flex items-center justify-center transition-all active:scale-90 shadow-xl animate-pulse"
                title="Stop Recording"
              >
                <div className="h-6 w-6 rounded-sm bg-white" />
              </button>
            )}
          </div>
        ) : (
          <>
            <button
              onClick={retake}
              className="h-14 w-14 rounded-full bg-zinc-700 hover:bg-zinc-600 flex items-center justify-center transition-all active:scale-90"
            >
              <RotateCcw className="h-6 w-6 text-white" />
            </button>
            <button
              onClick={send}
              disabled={sending}
              className="h-16 w-16 rounded-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 flex items-center justify-center transition-all active:scale-90 shadow-lg shadow-emerald-900/50"
            >
              <Send className="h-7 w-7 text-white" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
