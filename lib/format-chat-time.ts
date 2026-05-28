import { format } from "date-fns";

export function formatChatTime(date: Date | string | null | undefined): string {
  if (!date) return "";

  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const now = new Date();
  const isToday =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear();

  if (isToday) return format(d, "HH:mm");
  return format(d, "d MMM");
}
