// ─── Client Contact Preferences ───

export type PreferredChannel = "email" | "slack" | "phone" | "portal";

export interface ClientContactPreferenceEntry {
  id: string;
  clientName: string;
  displayName: string;
  preferredChannel: PreferredChannel;
  primaryEmail: string;
  secondaryEmail: string;
  slackChannel: string;
  phoneNumber: string;
  timezone: string;
  businessHoursStart: string;
  businessHoursEnd: string;
  businessDays: string;
  language: string;
  vaspDid: string;
  travelRuleContact: string;
  escalationEmail: string;
  escalationPhone: string;
  notes: string;
  tags: string[];
  active: boolean;
  lastContactedAt: string | null;
  createdById: string;
  createdBy?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}

export interface ClientContactSummary {
  total: number;
  active: number;
  byChannel: Record<PreferredChannel, number>;
  withTravelRuleContact: number;
  withEscalation: number;
}
