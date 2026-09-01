import type { Address } from "../types";
import type { OrderAddress } from "./types";

/** Maps a storefront Address to the AliExpress order-placement address DTO. Throws on missing required fields rather than silently placing an undeliverable order. */
export function toAliExpressAddress(address: Address): OrderAddress {
  const missing = (["fullName", "line1", "city", "country", "phone"] as const).filter((field) => !address[field]);
  if (missing.length > 0) {
    throw new Error(`Cannot build AliExpress order address: missing ${missing.join(", ")}`);
  }

  return {
    contactPerson: address.fullName,
    fullName: address.fullName,
    address: address.line1,
    address2: address.line2,
    city: address.city,
    province: address.region ?? address.city,
    zip: address.postalCode ?? "",
    country: address.country.toUpperCase(),
    mobileNo: address.phone!,
  };
}
