"use client";

import React, { useEffect, useState } from "react";
import { Loader2, FileX } from "lucide-react";
import mammoth from "mammoth";
import * as XLSX from "xlsx";
import JSZip from "jszip";

interface FileViewerProps {
  url: string;
  name: string;
  mimeType: string;
}

export function FileViewer({ url, name, mimeType }: FileViewerProps) {
  const [content, setContent] = useState<React.ReactNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadFile() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Failed to fetch file");

        const ext = name.split(".").pop()?.toLowerCase();

        // TEXT / CSV
        if (mimeType.startsWith("text/") || ext === "txt" || ext === "csv" || ext === "json" || ext === "md") {
          const text = await res.text();
          if (isMounted) {
            setContent(
              <pre className="p-6 text-xs sm:text-sm text-zinc-300 whitespace-pre-wrap font-mono max-w-full">
                {text}
              </pre>
            );
          }
        }
        // PDF
        else if (ext === "pdf" || mimeType === "application/pdf") {
          if (isMounted) {
            setContent(
              <iframe
                src={url}
                className="w-full h-full min-h-[70vh] border-0 rounded-xl bg-white"
                title={name}
              />
            );
          }
        }
        // DOCX
        else if (ext === "docx" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
          const arrayBuffer = await res.arrayBuffer();
          const result = await mammoth.convertToHtml({ arrayBuffer });
          if (isMounted) {
            setContent(
              <div
                className="prose prose-invert max-w-none p-6 sm:p-10 bg-zinc-900 rounded-xl document-viewer"
                dangerouslySetInnerHTML={{ __html: result.value }}
              />
            );
          }
        }
        // EXCEL
        else if (ext === "xlsx" || ext === "xls" || mimeType.includes("spreadsheetml")) {
          const arrayBuffer = await res.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: "array" });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const html = XLSX.utils.sheet_to_html(worksheet);
          if (isMounted) {
            setContent(
              <div
                className="p-6 overflow-auto bg-zinc-900 excel-viewer w-full"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            );
          }
        }
        // ZIP
        else if (ext === "zip" || mimeType === "application/zip") {
          const arrayBuffer = await res.arrayBuffer();
          const zip = await JSZip.loadAsync(arrayBuffer);
          const files: string[] = [];
          zip.forEach((relativePath) => {
            files.push(relativePath);
          });
          if (isMounted) {
            setContent(
              <div className="p-6">
                <h3 className="text-lg font-bold text-white mb-4">Archive Contents</h3>
                <ul className="space-y-2 font-mono text-sm text-zinc-300">
                  {files.map((f, i) => (
                    <li key={i} className="flex items-center gap-x-2">
                      <span className="text-zinc-500">{f.endsWith("/") ? "📁" : "📄"}</span>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
        }
        // PPTX (Basic fallback using JSZip to at least show it's parsed, or extract slide text if possible)
        else if (ext === "pptx" || mimeType.includes("presentationml")) {
          const arrayBuffer = await res.arrayBuffer();
          try {
            const zip = await JSZip.loadAsync(arrayBuffer);
            const slides = Object.keys(zip.files).filter(f => f.startsWith("ppt/slides/slide") && f.endsWith(".xml"));
            if (isMounted) {
              setContent(
                <div className="p-6 flex flex-col items-center justify-center text-center h-full min-h-[300px]">
                  <div className="h-20 w-20 bg-orange-500/20 text-orange-500 flex items-center justify-center rounded-2xl mb-4">
                    <span className="text-2xl font-bold">PPTX</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">{name}</h3>
                  <p className="text-zinc-400 mb-6">
                    Full offline rendering of PowerPoint presentations is currently unsupported.<br/>
                    This presentation contains {slides.length} slides.
                  </p>
                </div>
              );
            }
          } catch {
             throw new Error("Could not parse PPTX archive");
          }
        }
        else {
           throw new Error("Unsupported file format for offline preview");
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err.message || "Could not load file for preview");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadFile();

    return () => { isMounted = false; };
  }, [url, name, mimeType]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-zinc-400 gap-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        <p className="text-sm font-medium">Parsing document securely...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-zinc-400 gap-y-4 px-6 text-center">
        <FileX className="h-12 w-12 text-rose-500 mb-2" />
        <p className="text-lg font-bold text-white">Preview Failed</p>
        <p className="text-sm text-zinc-400 max-w-md">{error}</p>
        <a href={url} download className="mt-4 px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition font-medium">
          Download File Instead
        </a>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[300px] max-h-[80vh] overflow-y-auto bg-zinc-950 rounded-xl custom-scrollbar shadow-inner relative">
      {content}
    </div>
  );
}
