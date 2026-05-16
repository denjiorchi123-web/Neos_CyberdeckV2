// Browser capability detection for WebRTC calls.
// Used by the call buttons to disable themselves on unsupported browsers, and by
// MediaRoom to bail out cleanly with a user-friendly message instead of crashing.
export function isWebRTCSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof (window as any).RTCPeerConnection !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function"
  );
}
