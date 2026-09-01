import { describe, expect, it } from "vitest";
import { toAliExpressAddress } from "./address";
import type { Address } from "../types";

const VALID: Address = {
  fullName: "Jamie Rivera",
  line1: "1 Ocean Ave",
  line2: "Apt 4",
  city: "Santa Cruz",
  region: "CA",
  postalCode: "95060",
  country: "us",
  phone: "+14085551234",
};

describe("toAliExpressAddress", () => {
  it("maps our Address shape to the order-placement DTO", () => {
    const mapped = toAliExpressAddress(VALID);
    expect(mapped).toEqual({
      contactPerson: "Jamie Rivera",
      fullName: "Jamie Rivera",
      address: "1 Ocean Ave",
      address2: "Apt 4",
      city: "Santa Cruz",
      province: "CA",
      zip: "95060",
      country: "US",
      mobileNo: "+14085551234",
    });
  });

  it("throws when a required field is missing", () => {
    const { phone, ...withoutPhone } = VALID;
    expect(() => toAliExpressAddress(withoutPhone as Address)).toThrow(/phone/);
  });
});
