import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { AliExpressApiError, AliExpressClient, buildAuthorizeUrl, exchangeAuthorizationCode } from "./client";
import productGetFixture from "./__fixtures__/product-get.json";
import orderCreateFixture from "./__fixtures__/order-create.json";
import orderGetShippedFixture from "./__fixtures__/order-get-shipped.json";
import orderGetUnshippedFixture from "./__fixtures__/order-get-unshipped.json";
import trackingQueryFixture from "./__fixtures__/tracking-query.json";
import expiredTokenFixture from "./__fixtures__/error-expired-token.json";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

const CREDENTIALS = { appKey: "app-key", appSecret: "app-secret", accessToken: "access-token", refreshToken: "refresh-token" };

describe("AliExpressClient signing", () => {
  it("signs sorted key+value params with HMAC-SHA256, uppercase hex", () => {
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl: vi.fn() });
    const params = { method: "aliexpress.ds.product.get", app_key: "app-key", product_id: "123" };
    const expected = createHmac("sha256", "app-secret")
      .update(
        Object.keys(params)
          .sort()
          .map((k) => `${k}${(params as Record<string, string>)[k]}`)
          .join(""),
        "utf8",
      )
      .digest("hex")
      .toUpperCase();
    expect(client.sign(params)).toBe(expected);
  });
});

describe("AliExpressClient.getProductDetail", () => {
  it("normalizes the nested gateway response into AliExpressProductDetail", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(productGetFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const detail = await client.getProductDetail("1005006123456");

    expect(detail.product_id).toBe("1005006123456");
    expect(detail.subject).toContain("Kimono");
    expect(detail.ae_item_sku_info_dtos).toHaveLength(2);
    expect(detail.ae_item_sku_info_dtos[0].sku_price).toBe("16.00");
    expect(detail.ae_item_sku_info_dtos[0].sku_available_stock).toBe(42);
    expect(detail.ae_item_sku_info_dtos[1].sku_available_stock).toBe(0);
  });

  it("refreshes the access token once and retries on an expired-token error", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(expiredTokenFixture))
      .mockResolvedValueOnce(jsonResponse({ access_token: "new-token", refresh_token: "new-refresh", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(productGetFixture));
    const onTokenRefreshed = vi.fn();
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl, onTokenRefreshed });

    const detail = await client.getProductDetail("1005006123456");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(onTokenRefreshed).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "new-token", refreshToken: "new-refresh" }));
    expect(detail.product_id).toBe("1005006123456");

    // The refresh call (2nd fetch) must use AliExpress's app_key param name, not OAuth2's client_id,
    // and the same TOP system params + signature every other AliExpress call sends. app_secret must
    // NOT be sent as a param at all — it's the HMAC key only; sending it (even unsigned) makes
    // AliExpress's own signature recomputation diverge from ours, confirmed live as the cause of a
    // persistent "IncompleteSignature" rejection across several earlier, incomplete fixes.
    const refreshUrl = new URL(fetchImpl.mock.calls[1][0] as string);
    expect(refreshUrl.searchParams.get("app_key")).toBe("app-key");
    expect(refreshUrl.searchParams.get("app_secret")).toBeNull();
    expect(refreshUrl.searchParams.get("timestamp")).toBeTruthy();
    expect(refreshUrl.searchParams.get("sign_method")).toBe("sha256");
    expect(refreshUrl.searchParams.get("sign")).toMatch(/^[0-9A-F]+$/);
  });

  it("throws AliExpressApiError for a non-token error without retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ error_response: { code: "15", sub_code: "isv.business-error", msg: "biz", sub_msg: "product not found" } }),
    );
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    await expect(client.getProductDetail("missing")).rejects.toBeInstanceOf(AliExpressApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("AliExpressClient.createOrder", () => {
  it("returns the supplier order id on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(orderCreateFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const result = await client.createOrder({
      outOrderId: "local-order-1",
      logisticsAddress: {
        contactPerson: "Jamie Rivera",
        fullName: "Jamie Rivera",
        address: "1 Ocean Ave",
        city: "Santa Cruz",
        province: "CA",
        zip: "95060",
        country: "US",
        mobileNo: "+14085551234",
      },
      items: [{ productId: "1005006123456", skuId: "12000030123456789", quantity: 1, logisticsServiceName: "CAINIAO_STANDARD" }],
    });

    expect(result.orderId).toBe("8123456789012345");
    expect(result.outOrderId).toBe("local-order-1");
  });
});

describe("AliExpressClient.getOrderDetail", () => {
  it("extracts tracking info once shipped", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(orderGetShippedFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const detail = await client.getOrderDetail("8123456789012345");

    expect(detail.logistics_info_list?.[0].logistics_no).toBe("LP00123456789CN");
    expect(detail.logistics_info_list?.[0].logistics_company).toBe("AliExpress Standard Shipping");
  });

  it("returns no logistics info before the seller ships", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(orderGetUnshippedFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const detail = await client.getOrderDetail("8123456789012345");

    expect(detail.order_status).toBe("WAIT_SELLER_SEND_GOODS");
    expect(detail.logistics_info_list).toHaveLength(0);
  });
});

describe("AliExpressClient.queryTrackingInfo", () => {
  it("normalizes tracking events", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(trackingQueryFixture));
    const client = new AliExpressClient({ ...CREDENTIALS, fetchImpl });

    const tracking = await client.queryTrackingInfo({ orderId: "8123456789012345" });

    expect(tracking.logisticsNo).toBe("LP00123456789CN");
    expect(tracking.events).toHaveLength(2);
    expect(tracking.events[1].location).toBe("Los Angeles, US");
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds an authorization_code OAuth URL with the app key and redirect URI", () => {
    const url = buildAuthorizeUrl({ appKey: "app-key", redirectUri: "https://example.com/callback" });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://api-sg.aliexpress.com/oauth/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("app-key");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://example.com/callback");
  });
});

describe("exchangeAuthorizationCode", () => {
  it("exchanges an OAuth code for the initial access/refresh token pair", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ access_token: "first-access-token", refresh_token: "first-refresh-token", expires_in: 3600 }),
    );

    const tokens = await exchangeAuthorizationCode({
      appKey: "app-key",
      appSecret: "app-secret",
      code: "the-oauth-code",
      redirectUri: "https://example.com/callback",
      fetchImpl,
    });

    expect(tokens.accessToken).toBe("first-access-token");
    expect(tokens.refreshToken).toBe("first-refresh-token");
    const requestedUrl = new URL(fetchImpl.mock.calls[0][0] as string);
    expect(requestedUrl.searchParams.get("grant_type")).toBe("authorization_code");
    expect(requestedUrl.searchParams.get("code")).toBe("the-oauth-code");
    // AliExpress's token endpoint wants app_key (its TOP-platform convention), not OAuth2's
    // client_id — sending the wrong name fails with a live "MissingParameter: app_key" error this
    // test would have caught. app_secret must NEVER be sent as a param, only used as the HMAC key —
    // sending it (even excluded from the signed string) makes AliExpress's own signature
    // recomputation over every param it actually received diverge from ours. This was the actual,
    // final cause of a persistent live "IncompleteSignature" rejection across several earlier fixes
    // that each looked plausible (wrong param names, missing system params, missing sign, signing
    // app_secret in, missing the REST API path prefix) but didn't address the real bug: app_secret
    // present as a param at all. Confirmed against 3 independent open-source ports of AliExpress's
    // own "iop" SDK (PHP, Dart, TypeScript), which never insert it into the request.
    expect(requestedUrl.searchParams.get("app_key")).toBe("app-key");
    expect(requestedUrl.searchParams.get("app_secret")).toBeNull();
    expect(requestedUrl.searchParams.get("client_id")).toBeNull();
    // AliExpress also requires the same TOP system params + signature every other call sends —
    // confirmed live: this endpoint validates mandatory params one at a time, flagging "timestamp"
    // and then "sign" as each prior fix landed.
    expect(requestedUrl.searchParams.get("timestamp")).toBeTruthy();
    expect(requestedUrl.searchParams.get("sign_method")).toBe("sha256");
    const sign = requestedUrl.searchParams.get("sign");
    expect(sign).toMatch(/^[0-9A-F]+$/);
    // AliExpress's REST-style endpoints (anything under /rest/..., unlike the classic /sync gateway
    // call() uses) require the API path prepended to the signed string too.
    const signedParams: Record<string, string> = {};
    requestedUrl.searchParams.forEach((value, key) => {
      if (key !== "sign") signedParams[key] = value;
    });
    const expectedSign = createHmac("sha256", "app-secret")
      .update(
        "/auth/token/create" +
          Object.keys(signedParams)
            .sort()
            .map((k) => `${k}${signedParams[k]}`)
            .join(""),
        "utf8",
      )
      .digest("hex")
      .toUpperCase();
    expect(sign).toBe(expectedSign);
  });

  it("throws AliExpressApiError when the exchange fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error_response: { code: "invalid_code", msg: "code expired or already used" } }));

    await expect(
      exchangeAuthorizationCode({ appKey: "app-key", appSecret: "app-secret", code: "stale-code", fetchImpl }),
    ).rejects.toBeInstanceOf(AliExpressApiError);
  });
});
