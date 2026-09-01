import { createHmac } from "node:crypto";
import type {
  AliExpressCredentials,
  AliExpressOrderDetail,
  AliExpressProductDetail,
  CreateOrderRequest,
  CreateOrderResult,
  FreightOption,
  FreightQueryRequest,
  TrackingInfo,
  TrackingQueryRequest,
} from "./types";

export class AliExpressApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = "AliExpressApiError";
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface AliExpressClientConfig extends AliExpressCredentials {
  /** REST gateway for signed method calls. Defaults to the Singapore (international) gateway. */
  gatewayUrl?: string;
  /** OAuth token endpoint used for refresh-token exchange. */
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
  /** Called after a successful token refresh so the caller can persist the new tokens. */
  onTokenRefreshed?: (tokens: TokenSet) => void | Promise<void>;
}

const DEFAULT_GATEWAY_URL = "https://api-sg.aliexpress.com/sync";
const DEFAULT_TOKEN_URL = "https://api-sg.aliexpress.com/rest/auth/token/create";
const DEFAULT_AUTHORIZE_URL = "https://api-sg.aliexpress.com/oauth/authorize";

/** Error sub_codes the platform returns for an expired/invalid access token — worth one refresh-and-retry. */
const EXPIRED_TOKEN_MARKERS = ["isv.invalid-access-token", "access_token", "expired", "isv.invalid_grant"];

async function parseTokenResponse(res: Response, errorCode: string, errorMessage: string): Promise<TokenSet> {
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_response?: { code?: string; msg?: string };
  };
  if (!json.access_token || !json.refresh_token) {
    throw new AliExpressApiError(json.error_response?.code ?? errorCode, json.error_response?.msg ?? errorMessage, json);
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 0) * 1000,
  };
}

/**
 * Builds the URL to send a merchant to for the one-time OAuth authorization
 * step (they log into the AliExpress account being integrated and approve
 * access). AliExpress redirects back to `redirectUri` with a `?code=...`
 * query param — pass that code to `exchangeAuthorizationCode` to get the
 * initial access/refresh token pair. See apps/worker/src/cli/aliexpress-auth.ts.
 */
export function buildAuthorizeUrl(params: { appKey: string; redirectUri: string; authorizeUrl?: string }): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: params.appKey,
    redirect_uri: params.redirectUri,
    sp: "ae",
  });
  return `${params.authorizeUrl ?? DEFAULT_AUTHORIZE_URL}?${query.toString()}`;
}

export interface ExchangeAuthorizationCodeParams {
  appKey: string;
  appSecret: string;
  code: string;
  redirectUri?: string;
  tokenUrl?: string;
  fetchImpl?: typeof fetch;
}

/** One-time exchange of the `code` from the OAuth redirect for the initial ALIEXPRESS_ACCESS_TOKEN/ALIEXPRESS_REFRESH_TOKEN pair. */
export async function exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<TokenSet> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const query = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: params.appKey,
    client_secret: params.appSecret,
    code: params.code,
    ...(params.redirectUri ? { redirect_uri: params.redirectUri } : {}),
  });
  const res = await fetchImpl(`${params.tokenUrl ?? DEFAULT_TOKEN_URL}?${query.toString()}`, { method: "POST" });
  return parseTokenResponse(res, "token_exchange_failed", "AliExpress did not return tokens for this authorization code");
}

/**
 * AliExpress Open Platform / Dropshipping API client.
 *
 * Implements TOP-style request signing (sign_method=sha256): all system +
 * business params are sorted by key, concatenated as `key1value1key2value2…`,
 * and HMAC-SHA256'd with the app secret, hex-encoded uppercase.
 * https://openservice.aliexpress.com/doc/doc.htm (Dropshipping API section).
 */
export class AliExpressClient {
  private appKey: string;
  private appSecret: string;
  private accessToken: string;
  private refreshToken: string;
  private readonly gatewayUrl: string;
  private readonly tokenUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly onTokenRefreshed?: AliExpressClientConfig["onTokenRefreshed"];

  constructor(config: AliExpressClientConfig) {
    this.appKey = config.appKey;
    this.appSecret = config.appSecret;
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.gatewayUrl = config.gatewayUrl ?? DEFAULT_GATEWAY_URL;
    this.tokenUrl = config.tokenUrl ?? DEFAULT_TOKEN_URL;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.onTokenRefreshed = config.onTokenRefreshed;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AliExpressClientConfig> = {}): AliExpressClient {
    const required = (name: string): string => {
      const value = env[name];
      if (!value) throw new Error(`Missing required environment variable: ${name}`);
      return value;
    };
    return new AliExpressClient({
      appKey: required("ALIEXPRESS_APP_KEY"),
      appSecret: required("ALIEXPRESS_APP_SECRET"),
      accessToken: required("ALIEXPRESS_ACCESS_TOKEN"),
      refreshToken: required("ALIEXPRESS_REFRESH_TOKEN"),
      ...overrides,
    });
  }

  /** Exposed for testing/inspection; not part of the stable API surface. */
  sign(params: Record<string, string>): string {
    const base = Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("");
    return createHmac("sha256", this.appSecret).update(base, "utf8").digest("hex").toUpperCase();
  }

  private async call<T>(apiMethod: string, businessParams: Record<string, string>, attempt = 0): Promise<T> {
    const systemParams: Record<string, string> = {
      app_key: this.appKey,
      method: apiMethod,
      sign_method: "sha256",
      timestamp: String(Date.now()),
      access_token: this.accessToken,
      v: "2.0",
      format: "json",
    };
    const allParams = { ...systemParams, ...businessParams };
    const sign = this.sign(allParams);
    const body = new URLSearchParams({ ...allParams, sign });

    const res = await this.fetchImpl(this.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;

    const errorResponse = json.error_response as
      | { code?: string; sub_code?: string; msg?: string; sub_msg?: string }
      | undefined;
    if (errorResponse) {
      const code = errorResponse.sub_code ?? errorResponse.code ?? "unknown_error";
      if (attempt === 0 && EXPIRED_TOKEN_MARKERS.some((marker) => code.includes(marker))) {
        await this.refreshAccessToken();
        return this.call<T>(apiMethod, businessParams, attempt + 1);
      }
      throw new AliExpressApiError(code, errorResponse.sub_msg ?? errorResponse.msg ?? "AliExpress API error", errorResponse);
    }

    const responseKey = `${apiMethod.replace(/\./g, "_")}_response`;
    return (json[responseKey] ?? json) as T;
  }

  /** OAuth refresh-token exchange. Updates in-memory tokens and calls onTokenRefreshed so callers can persist them. */
  async refreshAccessToken(): Promise<TokenSet> {
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.appKey,
      client_secret: this.appSecret,
      refresh_token: this.refreshToken,
    });
    const res = await this.fetchImpl(`${this.tokenUrl}?${params.toString()}`, { method: "POST" });
    const tokens = await parseTokenResponse(res, "token_refresh_failed", "AliExpress token refresh did not return new tokens");
    this.accessToken = tokens.accessToken;
    this.refreshToken = tokens.refreshToken;
    await this.onTokenRefreshed?.(tokens);
    return tokens;
  }

  /** aliexpress.ds.product.get — full product + SKU detail for ingestion and sync. */
  async getProductDetail(productId: string, options: { shipToCountry?: string; targetCurrency?: string } = {}): Promise<AliExpressProductDetail> {
    const raw = await this.call<Record<string, unknown>>("aliexpress.ds.product.get", {
      product_id: productId,
      ship_to_country: options.shipToCountry ?? "US",
      target_currency: options.targetCurrency ?? "USD",
      target_language: "en",
    });
    return normalizeProductDetail(raw);
  }

  /** aliexpress.ds.freight.query — shipping options/cost/ETA for a given SKU + destination. */
  async queryFreight(request: FreightQueryRequest): Promise<FreightOption[]> {
    const raw = await this.call<Record<string, unknown>>("aliexpress.ds.freight.query", {
      product_id: request.productId,
      sku_id: request.skuId,
      quantity: String(request.quantity),
      ship_to_country: request.countryCode,
    });
    return normalizeFreightOptions(raw);
  }

  /** aliexpress.ds.order.create — places a dropshipping order with the supplier. */
  async createOrder(request: CreateOrderRequest): Promise<CreateOrderResult> {
    const dto = {
      out_order_id: request.outOrderId,
      logistics_address: {
        contact_person: request.logisticsAddress.contactPerson,
        full_name: request.logisticsAddress.fullName,
        address: request.logisticsAddress.address,
        address2: request.logisticsAddress.address2 ?? "",
        city: request.logisticsAddress.city,
        province: request.logisticsAddress.province,
        zip: request.logisticsAddress.zip,
        country: request.logisticsAddress.country,
        phone_country: request.logisticsAddress.phoneCountry ?? "",
        mobile_no: request.logisticsAddress.mobileNo,
      },
      product_items: request.items.map((item) => ({
        product_id: item.productId,
        sku_id: item.skuId,
        product_count: item.quantity,
        logistics_service_name: item.logisticsServiceName,
      })),
    };
    const raw = await this.call<Record<string, unknown>>("aliexpress.ds.order.create", {
      param_place_order_request4_open_api_d_t_o: JSON.stringify(dto),
    });
    return normalizeCreateOrderResult(raw, request.outOrderId);
  }

  /** aliexpress.ds.trade.order.get — current status + logistics info for a placed order. */
  async getOrderDetail(orderId: string): Promise<AliExpressOrderDetail> {
    const raw = await this.call<Record<string, unknown>>("aliexpress.ds.trade.order.get", {
      single_order_query: JSON.stringify({ order_id: orderId }),
    });
    return normalizeOrderDetail(raw);
  }

  /** aliexpress.logistics.ds.tracking.info.query — carrier tracking events for a shipped order. */
  async queryTrackingInfo(request: TrackingQueryRequest): Promise<TrackingInfo> {
    const raw = await this.call<Record<string, unknown>>("aliexpress.logistics.ds.tracking.info.query", {
      order_id: request.orderId,
      ...(request.logisticsNo ? { logistics_no: request.logisticsNo } : {}),
    });
    return normalizeTrackingInfo(raw);
  }
}

// ── Response normalization ───────────────────────────────────────────────
// The gateway nests the actual payload under a `result` key (and that key's
// exact shape varies by method); these functions dig it out defensively so
// a missing/renamed field degrades gracefully instead of throwing deep in a
// sync job.

function unwrapResult(raw: Record<string, unknown>): Record<string, unknown> {
  const result = raw.result;
  return (result && typeof result === "object" ? (result as Record<string, unknown>) : raw) ?? {};
}

export function normalizeProductDetail(raw: Record<string, unknown>): AliExpressProductDetail {
  const result = unwrapResult(raw);
  const base = (result.ae_item_base_info_dto ?? result) as Record<string, unknown>;
  const skuList =
    ((result.ae_item_sku_info_dtos as Record<string, unknown>)?.ae_item_sku_info_d_t_o as unknown[]) ??
    (result.ae_item_sku_info_dtos as unknown[]) ??
    [];
  const packageInfo = (result.package_info_dto ?? result.package_info) as Record<string, unknown> | undefined;

  return {
    product_id: String(base.product_id ?? result.product_id ?? ""),
    subject: String(base.subject ?? result.subject ?? ""),
    detail: (base.detail ?? result.detail) as string | undefined,
    image_urls: (base.image_urls ?? result.image_urls) as string | undefined,
    category_id: base.category_id as number | undefined,
    currency_code: String(base.currency_code ?? result.currency_code ?? "USD"),
    ae_item_sku_info_dtos: (skuList as Record<string, unknown>[]).map((sku) => ({
      sku_id: String(sku.sku_id ?? ""),
      sku_price: String(sku.sku_price ?? sku.offer_sale_price ?? "0"),
      sku_available_stock: Number(sku.sku_available_stock ?? sku.ipm_sku_stock ?? 0),
      sku_code: sku.sku_code as string | undefined,
      currency_code: sku.currency_code as string | undefined,
      sku_properties: (sku.ae_sku_property_dtos as Record<string, unknown>[] | undefined)?.map((p) => ({
        sku_property_id: Number(p.sku_property_id ?? 0),
        property_value_id: Number(p.property_value_id ?? 0),
        property_value_definition_name: String(p.property_value_definition_name ?? ""),
      })),
    })),
    package_info: packageInfo
      ? {
          gross_weight: packageInfo.gross_weight as string | undefined,
          product_unit: packageInfo.product_unit as string | undefined,
        }
      : undefined,
  };
}

export function normalizeFreightOptions(raw: Record<string, unknown>): FreightOption[] {
  const result = unwrapResult(raw);
  const list =
    ((result.freight_calculate_result_for_buyer_dto_list as Record<string, unknown>)?.freight_calculate_result_for_buyer_d_t_o as unknown[]) ??
    (result.freight_list as unknown[]) ??
    [];
  return (list as Record<string, unknown>[]).map((option) => ({
    serviceName: String(option.service_name ?? option.logistics_service_name ?? ""),
    shippingFee: String(option.freight_amount ?? option.shipping_fee ?? "0"),
    estimatedDeliveryDays: String(option.estimated_delivery_time ?? option.delivery_days ?? ""),
    trackingAvailable: Boolean(option.tracking_available ?? true),
  }));
}

export function normalizeCreateOrderResult(raw: Record<string, unknown>, outOrderId: string): CreateOrderResult {
  const result = unwrapResult(raw);
  const orderList = (result.order_list as Record<string, unknown>)?.number as unknown[] | undefined;
  const orderId = orderList?.[0] ?? result.order_id;
  if (!orderId || result.is_success === false) {
    throw new AliExpressApiError(
      String(result.error_code ?? "order_create_failed"),
      String(result.error_msg ?? "AliExpress did not return an order id"),
      raw,
    );
  }
  return { orderId: String(orderId), outOrderId };
}

export function normalizeOrderDetail(raw: Record<string, unknown>): AliExpressOrderDetail {
  const result = unwrapResult(raw);
  const logisticsList =
    ((result.logistics_info_d_t_o_list as Record<string, unknown>)?.ae_order_logistics_info_d_t_o as unknown[]) ??
    (result.logistics_info_list as unknown[]) ??
    [];
  return {
    order_id: String(result.order_id ?? ""),
    order_status: String(result.order_status ?? "PLACE_ORDER_SUCCESS") as AliExpressOrderDetail["order_status"],
    logistics_status: result.logistics_status as string | undefined,
    logistics_info_list: (logisticsList as Record<string, unknown>[]).map((info) => ({
      logistics_no: String(info.logistics_no ?? info.tracking_number ?? ""),
      logistics_company: String(info.logistics_company_name ?? info.logistics_company ?? ""),
      tracking_url: info.tracking_url as string | undefined,
    })),
  };
}

export function normalizeTrackingInfo(raw: Record<string, unknown>): TrackingInfo {
  const result = unwrapResult(raw);
  const events =
    ((result.tracking_detail_line_list as Record<string, unknown>)?.tracking_detail as unknown[]) ??
    (result.events as unknown[]) ??
    [];
  return {
    logisticsNo: String(result.logistics_no ?? result.mail_no ?? ""),
    logisticsCompany: String(result.logistics_company ?? result.service_name ?? ""),
    status: String(result.logistics_status ?? result.status ?? "UNKNOWN"),
    events: (events as Record<string, unknown>[]).map((event) => ({
      eventDate: String(event.event_date ?? event.time ?? ""),
      eventDescription: String(event.event_description ?? event.description ?? ""),
      location: event.location as string | undefined,
    })),
  };
}
