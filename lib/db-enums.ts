export const MemberRole = {
  ADMIN: "ADMIN",
  MODERATOR: "MODERATOR",
  GUEST: "GUEST",
} as const;

export const ChannelType = {
  TEXT: "TEXT",
  AUDIO: "AUDIO",
  VIDEO: "VIDEO",
} as const;

export type MemberRole = (typeof MemberRole)[keyof typeof MemberRole];
export type ChannelType = (typeof ChannelType)[keyof typeof ChannelType];
