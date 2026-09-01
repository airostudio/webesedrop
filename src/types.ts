// Shared domain types. Money is always integer minor units (cents) — same
// convention used throughout the engine and every adapter that talks to it.

export interface Address {
  fullName: string;
  line1: string;
  line2?: string;
  city: string;
  region?: string;
  postalCode?: string;
  country: string; // ISO 3166-1 alpha-2
  phone?: string;
}
